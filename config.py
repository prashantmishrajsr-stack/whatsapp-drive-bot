import os
from dotenv import load_dotenv

load_dotenv()

# Google Drive
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
GOOGLE_DRIVE_FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "17SvLM5vKApbhD7AeSuThRa_awPIfkJvN")

# Green API (WhatsApp)
GREEN_API_ID_INSTANCE = os.getenv("GREEN_API_ID_INSTANCE")
GREEN_API_TOKEN = os.getenv("GREEN_API_TOKEN")
GREEN_API_URL = os.getenv("GREEN_API_URL", "https://api.green-api.com")
