const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

let latestQR = null;
let isConnected = false;
let currentSock = null;

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
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON formatting: ${e.message}`);
  }

  const privateKey = credentials.private_key 
    ? credentials.private_key.replace(/\\n/g, '\n') 
    : '';

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: privateKey,
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

  console.log(`🔍 Searching ${allFiles.length} files in Drive folder for: "${normalizedQuery}"`);

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

// ─── Function to clear auth session and force new QR ─────────────────────
async function logoutAndReset() {
  console.log('🔄 Resetting session and generating new QR Code...');
  isConnected = false;
  latestQR = null;
  if (currentSock) {
    try { currentSock.logout(); } catch (e) {}
    try { currentSock.end(); } catch (e) {}
  }
  const authPath = path.join(__dirname, 'auth_info');
  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
  }
  setTimeout(startBot, 2000);
}

// ─── Web Server for Displaying Clean QR Code ──────────────────────────────
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  if (req.url === '/reset' || req.url === '/logout') {
    logoutAndReset();
    return res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Resetting WhatsApp...</title>
        <meta http-equiv="refresh" content="5;url=/">
      </head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white;">
        <h2>🔄 Resetting WhatsApp session... Please wait 5 seconds.</h2>
      </body>
      </html>
    `);
  }

  if (isConnected) {
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Bot</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; }
          .card { background: #1e293b; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          h1 { color: #22c55e; }
          a.btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #ef4444; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
          a.btn:hover { background: #dc2626; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ WhatsApp Bot Connected & Active!</h1>
          <p>Your bot is logged in and ready to receive messages.</p>
          <a href="/reset" class="btn">🔄 Disconnect & Scan New QR Code</a>
        </div>
      </body>
      </html>
    `);
  } else if (latestQR) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Scan WhatsApp QR Code</title>
        <meta http-equiv="refresh" content="15">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: white; }
          .card { background: #1e293b; padding: 30px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          img { border-radius: 12px; margin: 20px 0; padding: 10px; background: white; }
          p { color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>📱 Scan QR Code with WhatsApp</h2>
          <p>Open WhatsApp on your phone → Linked Devices → Link a Device</p>
          <img src="${qrImageUrl}" alt="WhatsApp QR Code" />
          <p><small>Page auto-refreshes every 15 seconds</small></p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Bot</title>
        <meta http-equiv="refresh" content="3">
      </head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white;">
        <h2>⏳ Starting WhatsApp Bot... Generating QR Code...</h2>
      </body>
      </html>
    `);
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ─── Baileys WhatsApp Bot ──────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Mac OS', 'Chrome', '121.0.0'],
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      isConnected = false;
      console.log('📱 New QR code generated. Open Railway Web URL to scan!');
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      latestQR = null;
      isConnected = true;
      console.log('==================================================');
      console.log('✅ WHATSAPP BOT IS CONNECTED & READY TO RECEIVE MESSAGES!');
      console.log('==================================================');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      const queryCode = text.trim();
      if (!queryCode) continue;

      console.log(`📩 Received message from ${remoteJid}: "${queryCode}"`);

      try {
        // Mark message as read
        try { await sock.readMessages([msg.key]); } catch (e) {}

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

        // Send reply directly to the chat remoteJid
        console.log(`📤 Sending message to: ${remoteJid}`);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        console.log(`✅ Successfully delivered reply to ${remoteJid}`);
      } catch (err) {
        console.error('❌ Drive Search / Send Error:', err);
      }
    }
  });
}

startBot().catch(console.error);
