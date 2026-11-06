import io
import datetime
import logging
from typing import Optional, Tuple
import requests
import pandas as pd
from bs4 import BeautifulSoup  # Optional for parsing CSRF tokens, handled gracefully if absent

logger = logging.getLogger("portal_sync")

# Portal Configuration
BASE_URL = "https://to.najafkarbala.com"
LOGIN_PAGE_URL = f"{BASE_URL}/"
AUTH_FORM_URL = f"{BASE_URL}/authenticationForm"
MANAGE_ALLOCATION_URL = f"{BASE_URL}/manage-room-allocation"
DASHBOARD_URL = f"{BASE_URL}/dashboard"

DEFAULT_USERNAME = "40476311"
DEFAULT_PASSWORD = "Its52password*"
DEFAULT_ROLE = "Tour and accommodation Admin"
DEFAULT_VENUE = "Najaf"

COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": BASE_URL,
    "Referer": LOGIN_PAGE_URL,
}


def create_portal_session(
    username: str = DEFAULT_USERNAME,
    password: str = DEFAULT_PASSWORD,
    role: str = DEFAULT_ROLE,
    timeout: int = 25,
) -> Tuple[Optional[requests.Session], Optional[str]]:
    """
    Initializes a persistent HTTP session and performs authentication against
    the Najaf Karbala portal.
    
    Returns:
        (session, error_message): Tuple containing active session or error message.
    """
    session = requests.Session()
    session.headers.update(COMMON_HEADERS)

    try:
        # Step 1: GET login page to capture initial cookies & CSRF tokens if present
        resp_init = session.get(LOGIN_PAGE_URL, timeout=timeout)
        if resp_init.status_code != 200:
            return None, f"Failed to reach portal login page (HTTP {resp_init.status_code})"

        # Attempt to extract CSRF token if used in the form
        csrf_token = None
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp_init.text, "html.parser")
            token_input = soup.find("input", {"name": lambda x: x and ("csrf" in x.lower() or "token" in x.lower())})
            if token_input and token_input.get("value"):
                csrf_token = token_input["value"]
        except ImportError:
            pass

        # Step 2: POST credentials to authenticationForm
        login_payload = {
            "username": username,
            "its_id": username,
            "login": username,
            "password": password,
            "role": role,
            "user_type": role,
        }
        if csrf_token:
            login_payload["_token"] = csrf_token
            login_payload["csrf_token"] = csrf_token

        resp_auth = session.post(
            AUTH_FORM_URL,
            data=login_payload,
            headers={"Referer": LOGIN_PAGE_URL},
            allow_redirects=True,
            timeout=timeout,
        )

        # Basic verification: check for successful auth
        if resp_auth.status_code not in (200, 302):
            return None, f"Login authentication failed (HTTP {resp_auth.status_code})"

        if "invalid" in resp_auth.text.lower() and "password" in resp_auth.text.lower():
            return None, "Invalid portal credentials supplied."

        return session, None

    except requests.exceptions.Timeout:
        return None, "Connection timed out while logging into to.najafkarbala.com."
    except requests.exceptions.ConnectionError:
        return None, "Could not connect to to.najafkarbala.com. Check internet or portal status."
    except Exception as e:
        return None, f"Portal authentication exception: {str(e)}"


def fetch_room_allocation_excel(
    session: requests.Session,
    venue: str = DEFAULT_VENUE,
    arrival_date: Optional[str] = None,
    timeout: int = 30,
) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
    """
    Fetches the room allocation Excel export from the portal, loading it
    directly into a pandas DataFrame in memory via io.BytesIO (Vercel-safe).
    
    Args:
        session: Authenticated requests.Session
        venue: Default 'Najaf'
        arrival_date: YYYY-MM-DD string (defaults to today's date)
    
    Returns:
        (df, error_message): Tuple containing DataFrame or error string.
    """
    if not arrival_date:
        arrival_date = datetime.date.today().strftime("%Y-%m-%d")
    arrival_date_alt = datetime.date.today().strftime("%d/%m/%Y")

    # Common export endpoints used on the portal
    candidate_endpoints = [
        f"{BASE_URL}/manage-room-allocation/export",
        f"{BASE_URL}/manage-room-allocation/download",
        f"{BASE_URL}/manage-room-allocation?export=excel&venue={venue}&arrival_date={arrival_date}",
        f"{BASE_URL}/manage-room-allocation",
    ]

    export_params = {
        "venue": venue,
        "venue_name": venue,
        "arrival_date": arrival_date,
        "date": arrival_date,
        "export": "excel",
        "action": "export",
        "report_type": "room_allocation",
    }

    try:
        # First ensure the manage allocation page is accessible
        session.get(f"{BASE_URL}/manage-room-allocation", timeout=timeout)

        # Try POST/GET to obtain the Excel file
        excel_content = None
        content_type = ""

        # Attempt POST to export endpoint or query
        resp_export = session.post(
            f"{BASE_URL}/manage-room-allocation/export",
            data=export_params,
            headers={"Referer": f"{BASE_URL}/manage-room-allocation"},
            timeout=timeout,
        )

        if resp_export.status_code == 200 and len(resp_export.content) > 100:
            content_type = resp_export.headers.get("Content-Type", "").lower()
            if "spreadsheet" in content_type or "excel" in content_type or "octet-stream" in content_type or resp_export.content[:4] == b"PK\x03\x04":
                excel_content = resp_export.content

        # Fallback to GET query params if POST did not return an Excel binary
        if not excel_content:
            resp_get = session.get(
                f"{BASE_URL}/manage-room-allocation",
                params=export_params,
                timeout=timeout,
            )
            if resp_get.status_code == 200 and (
                resp_get.content[:4] == b"PK\x03\x04" or "spreadsheet" in resp_get.headers.get("Content-Type", "")
            ):
                excel_content = resp_get.content

        if not excel_content:
            return None, (
                f"Export endpoint did not return Excel content. Status: {resp_export.status_code}, "
                f"Content-Type: {content_type or 'unknown'}."
            )

        # Load directly into memory via BytesIO (no disk write, stateless Vercel compatible)
        excel_buffer = io.BytesIO(excel_content)
        df = pd.read_excel(excel_buffer)

        return df, None

    except requests.exceptions.Timeout:
        return None, "Connection timed out while downloading Excel file from portal."
    except requests.exceptions.ConnectionError:
        return None, "Connection lost while downloading room allocation file."
    except Exception as e:
        return None, f"Failed to parse downloaded Excel file: {str(e)}"
