import requests
from config import GREEN_API_ID_INSTANCE, GREEN_API_TOKEN, GREEN_API_URL


def send_text_message(chat_id: str, message: str) -> dict:
    """
    Send a text message via Green API to a WhatsApp number.
    
    Args:
        chat_id: WhatsApp chat ID in format '91XXXXXXXXXX@c.us' (country code + number)
        message: The text message to send
    
    Returns:
        API response as dict
    """
    url = f"{GREEN_API_URL}/waInstance{GREEN_API_ID_INSTANCE}/sendMessage/{GREEN_API_TOKEN}"
    
    payload = {
        "chatId": chat_id,
        "message": message
    }
    
    response = requests.post(url, json=payload, timeout=30)
    response.raise_for_status()
    return response.json()
