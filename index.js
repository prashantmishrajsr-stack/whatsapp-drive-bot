const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// ─── Google Drive Helper ───────────────────────────────────────────────────
function getDriveService() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }

  let credentials;
  try {
    credentials = typeof serviceAccountJson === 'string' 
      ? JSON.parse(serviceAccountJson) 
      : serviceAccountJson;
  } catch (e) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON formatting.');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

async function listFilesRecursive(drive, folderId) {
  let allFiles = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageToken: pageToken
    });

    const items = res.data.files || [];
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const subFiles = await listFilesRecursive(drive, item.id);
        allFiles.push(...subFiles);
      } else {
        allFiles.push(item);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

async function searchFilesByCode(queryCode) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '17SvLM5vKApbhD7AeSuThRa_awPIfkJvN';
  const drive = getDriveService();
  const allFiles = await listFilesRecursive(drive, folderId);
  const normalizedQuery = queryCode.trim().toUpperCase();

  const matches = [];
  for (const file of allFiles) {
    if (file.name.toUpperCase().includes(normalizedQuery)) {
      matches.push({
        name: file.name,
        id: file.id,
        link: `https://drive.google.com/file/d/${file.id}/view?usp=sharing`
      });
    }
  }
  return matches;
}

// ─── Baileys WhatsApp Bot ──────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==================================================');
      console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP (LINKED DEVICES):');
      console.log('==================================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n==================================================\n');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      console.log('==================================================');
      console.log('✅ WHATSAPP BOT IS CONNECTED & READY TO RECEIVE MESSAGES!');
      console.log('==================================================');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      // Extract message text from all formats
      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      const queryCode = text.trim();
      if (!queryCode) continue;

      console.log(`📩 Received message from ${remoteJid}: "${queryCode}"`);

      try {
        const results = await searchFilesByCode(queryCode);
        let reply = '';

        if (results.length === 0) {
          reply = `❌ No files found matching *${queryCode}*\n\nPlease check the code and try again.`;
        } else if (results.length === 1) {
          const file = results[0];
          reply = `✅ File found!\n\n📄 *${file.name}*\n🔗 ${file.link}`;
        } else {
          const lines = [`✅ Found *${results.length}* file(s) matching *${queryCode}*:\n`];
          results.forEach((file, index) => {
            lines.push(`${index + 1}. *${file.name}*\n   🔗 ${file.link}`);
          });
          reply = lines.join('\n');
        }

        await sock.sendMessage(remoteJid, { text: reply });
        console.log(`📤 Replied to ${remoteJid}`);
      } catch (err) {
        console.error('Drive Search Error:', err);
        await sock.sendMessage(remoteJid, {
          text: '❌ An error occurred while searching Google Drive. Please try again later.'
        });
      }
    }
  });
}

// Start the bot
startBot().catch(console.error);
