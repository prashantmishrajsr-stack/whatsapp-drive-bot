import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from drive_search import search_files_by_code
from whatsapp import send_text_message

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="WhatsApp Drive Bot", version="1.0.0")


# ─── Health Check ─────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "WhatsApp Drive Bot is running ✅"}


# ─── Webhook ──────────────────────────────────────────────────────────────────
@app.post("/webhook")
async def webhook(request: Request):
    try:
        body = await request.json()
        logger.info(f"Incoming webhook payload: {body}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # ── Only process incoming messages ──────────────────────────────────
    webhook_type = body.get("typeWebhook")
    if webhook_type not in ["incomingMessageReceived", "outgoingAPIMessageReceived", "outgoingMessageReceived"]:
        logger.info(f"Ignored webhook type: {webhook_type}")
        return JSONResponse({"status": "ignored", "reason": f"type {webhook_type} ignored"})

    # ── Extract sender and message text ─────────────────────────────────────
    sender_data = body.get("senderData", {})
    chat_id = sender_data.get("chatId", "")

    message_data = body.get("messageData", {})
    
    # Try all possible places WhatsApp stores message text
    user_message = ""
    if "textMessageData" in message_data:
        user_message = message_data["textMessageData"].get("textMessage", "")
    if not user_message and "extendedTextMessageData" in message_data:
        user_message = message_data["extendedTextMessageData"].get("text", "")
    if not user_message and "extendedTextMessageData" in message_data:
        user_message = message_data["extendedTextMessageData"].get("textMessage", "")
    if not user_message and "fileMessageData" in message_data:
        user_message = message_data["fileMessageData"].get("caption", "")

    user_message = user_message.strip()

    if not chat_id or not user_message:
        logger.warning(f"Skipping: chatId='{chat_id}', message='{user_message}'")
        return JSONResponse({"status": "skipped"})

    logger.info(f"Message from {chat_id}: '{user_message}'")

    # ── Search Google Drive ──────────────────────────────────────────────────
    try:
        results = search_files_by_code(user_message)
    except Exception as e:
        logger.error(f"Drive search error: {e}")
        send_text_message(chat_id, "❌ An error occurred while searching Google Drive. Please try again later.")
        return JSONResponse({"status": "error", "detail": str(e)})

    # ── Build reply ──────────────────────────────────────────────────────────
    if not results:
        reply = (
            f"❌ No files found matching *{user_message}*\n\n"
            f"Please check the code and try again."
        )
    elif len(results) == 1:
        file = results[0]
        reply = (
            f"✅ File found!\n\n"
            f"📄 *{file['name']}*\n"
            f"🔗 {file['link']}"
        )
    else:
        # Multiple matches
        lines = [f"✅ Found *{len(results)}* file(s) matching *{user_message}*:\n"]
        for i, file in enumerate(results, start=1):
            lines.append(f"{i}. *{file['name']}*\n   🔗 {file['link']}")
        reply = "\n".join(lines)

    # ── Send reply ───────────────────────────────────────────────────────────
    try:
        send_text_message(chat_id, reply)
        logger.info(f"Reply sent to {chat_id}")
    except Exception as e:
        logger.error(f"Failed to send WhatsApp message: {e}")

    return JSONResponse({"status": "ok"})
