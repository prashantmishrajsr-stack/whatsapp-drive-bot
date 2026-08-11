import json
import re
from google.oauth2 import service_account
from googleapiclient.discovery import build
from config import GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_FOLDER_ID

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


def get_drive_service():
    """Create and return an authenticated Google Drive service."""
    if not GOOGLE_SERVICE_ACCOUNT_JSON:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.")
    
    service_account_info = json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
    credentials = service_account.Credentials.from_service_account_info(
        service_account_info, scopes=SCOPES
    )
    service = build("drive", "v3", credentials=credentials)
    return service


def list_all_files_in_folder(service, folder_id: str) -> list[dict]:
    """
    Recursively list all files in a Google Drive folder and its subfolders.
    Returns a list of dicts with 'name', 'id', 'mimeType'.
    """
    all_files = []
    page_token = None

    while True:
        query = f"'{folder_id}' in parents and trashed = false"
        response = service.files().list(
            q=query,
            spaces="drive",
            fields="nextPageToken, files(id, name, mimeType)",
            pageToken=page_token,
        ).execute()

        items = response.get("files", [])
        for item in items:
            if item["mimeType"] == "application/vnd.google-apps.folder":
                # Recurse into subfolders
                sub_files = list_all_files_in_folder(service, item["id"])
                all_files.extend(sub_files)
            else:
                all_files.append(item)

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return all_files


def search_files_by_code(query_code: str) -> list[dict]:
    """
    Search Google Drive folder for files whose names contain the query_code (case-insensitive).
    
    Example:
        query_code = "P205402"
        matches: "MEC862HCFTP205402_AP", "XYZ_P205402_DOC", etc.

    Returns a list of matched files with name, id, and a shareable web link.
    """
    service = get_drive_service()
    all_files = list_all_files_in_folder(service, GOOGLE_DRIVE_FOLDER_ID)

    # Normalize query to uppercase for case-insensitive matching
    normalized_query = query_code.strip().upper()

    matches = []
    for file in all_files:
        filename_upper = file["name"].upper()
        if normalized_query in filename_upper:
            matches.append({
                "name": file["name"],
                "id": file["id"],
                "link": f"https://drive.google.com/file/d/{file['id']}/view?usp=sharing"
            })

    return matches
