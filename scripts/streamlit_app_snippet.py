"""
Streamlit Web App Component for Zaereen Accommodation (Vercel Deployed)
Automates fetching the Room Allocation Excel file directly from to.najafkarbala.com
into an in-memory pandas DataFrame via io.BytesIO, with robust error handling
and fallback to manual st.file_uploader.
"""

import io
import datetime
import requests
import pandas as pd
import streamlit as st


# ==============================================================================
# 1. CORE PORTAL FETCHER FUNCTION
# ==============================================================================
def fetch_portal_room_allocation_df(
    username: str = "40476311",
    password: str = "Its52password*",
    role: str = "Tour and accommodation Admin",
    venue: str = "Najaf",
    arrival_date: str = None,
    timeout: int = 30,
) -> tuple[pd.DataFrame | None, str | None]:
    """
    Logs into to.najafkarbala.com using a persistent requests.Session,
    navigates to MANAGE ROOM ALLOCATION with venue='Najaf' & arrival_date=today,
    and downloads the Excel report directly into an in-memory pandas DataFrame
    via io.BytesIO (no disk writes, 100% Vercel stateless friendly).
    """
    if not arrival_date:
        arrival_date = datetime.date.today().strftime("%Y-%m-%d")

    base_url = "https://to.najafkarbala.com"
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Origin": base_url,
        "Referer": f"{base_url}/",
    })

    try:
        # Step 1: Initial GET to capture cookies & CSRF tokens if present
        resp_init = session.get(f"{base_url}/", timeout=timeout)
        if resp_init.status_code != 200:
            return None, f"Unable to reach portal homepage (Status {resp_init.status_code})"

        # Attempt to grab CSRF token from HTML form if present
        csrf_token = None
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp_init.text, "html.parser")
            tag = soup.find("input", {"name": lambda x: x and ("csrf" in x.lower() or "token" in x.lower())})
            if tag and tag.get("value"):
                csrf_token = tag["value"]
        except Exception:
            pass

        # Step 2: Authenticate via POST to authenticationForm
        login_data = {
            "username": username,
            "its_id": username,
            "login": username,
            "password": password,
            "role": role,
            "user_type": role,
        }
        if csrf_token:
            login_data["_token"] = csrf_token
            login_data["csrf_token"] = csrf_token

        resp_auth = session.post(
            f"{base_url}/authenticationForm",
            data=login_data,
            headers={"Referer": f"{base_url}/"},
            allow_redirects=True,
            timeout=timeout,
        )

        if resp_auth.status_code not in (200, 302):
            return None, f"Login authentication failed (HTTP {resp_auth.status_code}). Please verify portal credentials."

        # Step 3: Access Manage Room Allocation & Trigger Export
        export_params = {
            "venue": venue,
            "venue_name": venue,
            "arrival_date": arrival_date,
            "date": arrival_date,
            "export": "excel",
            "action": "export",
        }

        # Try POST to export endpoint
        resp_export = session.post(
            f"{base_url}/manage-room-allocation/export",
            data=export_params,
            headers={"Referer": f"{base_url}/manage-room-allocation"},
            timeout=timeout,
        )

        excel_bytes = None
        # Check if response is valid Excel binary (PK zip signature or mime-type)
        if resp_export.status_code == 200 and (
            resp_export.content[:4] == b"PK\x03\x04"
            or "spreadsheet" in resp_export.headers.get("Content-Type", "").lower()
            or "excel" in resp_export.headers.get("Content-Type", "").lower()
        ):
            excel_bytes = resp_export.content
        else:
            # Fallback to GET query params
            resp_get = session.get(
                f"{base_url}/manage-room-allocation",
                params=export_params,
                timeout=timeout,
            )
            if resp_get.status_code == 200 and resp_get.content[:4] == b"PK\x03\x04":
                excel_bytes = resp_get.content

        if not excel_bytes:
            return None, "Portal did not return a valid Excel spreadsheet. The allocation report may be empty for today or format changed."

        # Step 4: Load into pandas in-memory via io.BytesIO (Zero disk writes)
        buffer = io.BytesIO(excel_bytes)
        df = pd.read_excel(buffer)
        return df, None

    except requests.exceptions.Timeout:
        return None, "Connection to to.najafkarbala.com timed out after 30 seconds."
    except requests.exceptions.ConnectionError:
        return None, "Network connection error: Failed to establish connection to to.najafkarbala.com."
    except requests.exceptions.HTTPError as http_err:
        return None, f"Portal returned HTTP Error: {http_err}"
    except Exception as e:
        return None, f"An unexpected error occurred while reading the Excel file: {str(e)}"


# ==============================================================================
# 2. STREAMLIT UI IMPLEMENTATION
# ==============================================================================
def render_room_allocation_section():
    st.subheader("🏢 Najaf Room Allocation & Zaereen Manifest")

    today_str = datetime.date.today().strftime("%Y-%m-%d")
    
    # Action buttons and status controls
    col1, col2 = st.columns([2, 1])
    with col1:
        fetch_clicked = st.button("🔄 Auto-Fetch Today's Excel from Portal", type="primary", use_container_width=True)
    with col2:
        st.caption(f"Portal: to.najafkarbala.com | Venue: Najaf | Date: {today_str}")

    df_data = None

    # Auto-fetch branch
    if fetch_clicked:
        with st.spinner("Connecting to Najaf Karbala portal, authenticating, and downloading today's room allocation report..."):
            df, error = fetch_portal_room_allocation_df(
                venue="Najaf",
                arrival_date=today_str,
            )
            if error:
                st.error(f"⚠️ Portal Sync Failed: {error}")
                st.info("💡 You can manually upload the Excel file below as a fallback.")
            elif df is not None and not df.empty:
                st.success(f"✓ Successfully fetched and loaded {len(df)} records directly from portal!")
                st.session_state["room_allocation_df"] = df
            else:
                st.warning("Portal returned 0 records for today's arrival date.")

    # Check session state for loaded data
    if "room_allocation_df" in st.session_state and st.session_state["room_allocation_df"] is not None:
        df_data = st.session_state["room_allocation_df"]

    # Fallback manual file uploader (so the app never halts if portal is offline)
    with st.expander("📁 Manual Excel Upload (Fallback)", expanded=(df_data is None)):
        uploaded_file = st.file_uploader(
            "Upload Room Allocation Excel (.xlsx / .xls)",
            type=["xlsx", "xls"],
            help="Use this if the secondary portal is down for maintenance.",
        )
        if uploaded_file is not None:
            try:
                df_manual = pd.read_excel(uploaded_file)
                st.session_state["room_allocation_df"] = df_manual
                df_data = df_manual
                st.success(f"✓ Loaded {len(df_manual)} records from uploaded file.")
            except Exception as e:
                st.error(f"Failed to read uploaded Excel file: {e}")

    # Render DataFrame & Stats if data is available
    if df_data is not None:
        st.divider()
        st.write(f"### Current Room Allocation Data ({len(df_data)} rows)")
        st.dataframe(df_data, use_container_width=True)


if __name__ == "__main__":
    st.set_page_config(page_title="Zaereen Accommodation Portal Sync", layout="wide")
    render_room_allocation_section()
