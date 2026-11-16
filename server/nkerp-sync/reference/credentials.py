"""Where the NKERP login and the Google service-account key come from.

Both live inside this skill (user, Nov 16 2026: "copy the credentials into the skill itself"), so the skill
runs the same on this Mac, in Claude Code, and as a claude.ai skill in the cloud. Optional overrides first:

  NKERP login
    1. environment variables NKERP_LOGIN_ID and NKERP_PASSWORD
    2. this skill's references/access.md ("Login ID: ..." and "Password: ..." lines)
  Google service account
    1. environment variable GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON text)
    2. environment variable GOOGLE_SERVICE_ACCOUNT_FILE (a path to the key file)
    3. this skill's references/google-service-account.json

Nothing here ever prints a value. Missing credentials raise MissingCredentials.
"""
import json
import os
from pathlib import Path

REFERENCES = Path(__file__).resolve().parent.parent / 'references'


class MissingCredentials(RuntimeError):
    pass


def _labeled(text, label):
    for line in text.splitlines():
        if label.lower() + ':' in line.lower():
            return line.split(':', 1)[1].strip().strip('`* ')
    return None


def nkerp_login():
    """(login_id, password). Never logged or written anywhere."""
    login, password = os.environ.get('NKERP_LOGIN_ID'), os.environ.get('NKERP_PASSWORD')
    if login and password:
        return login, password
    path = REFERENCES / 'access.md'
    if not path.exists():
        raise MissingCredentials('NKERP login not found: references/access.md is missing from this skill')
    text = path.read_text()
    login, password = _labeled(text, 'Login ID'), _labeled(text, 'Password')
    if not (login and password):
        raise MissingCredentials("references/access.md lacks 'Login ID:' or 'Password:' lines")
    return login, password


def google_key():
    """Service-account key as a dict."""
    text = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if text:
        try:
            return json.loads(text)
        except ValueError:
            raise MissingCredentials('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON') from None
    for path in (os.environ.get('GOOGLE_SERVICE_ACCOUNT_FILE'), REFERENCES / 'google-service-account.json'):
        if path and Path(path).exists():
            return json.loads(Path(path).read_text())
    raise MissingCredentials('Google key not found: references/google-service-account.json is missing from this skill')
