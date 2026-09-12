#!/usr/bin/env python3
"""One-time Google Drive OAuth consent flow -> refresh token.

Run this once on a machine with a browser, then paste the refresh token into the
dashboard backup settings (or GOOGLE_DRIVE_REFRESH_TOKEN in .env).

Usage:
    python scripts/generate_gdrive_token.py --client-id YOUR_ID --client-secret YOUR_SECRET

You must register the redirect URI below (http://localhost:8765/oauth-callback)
as an allowed redirect URI in the Google Cloud OAuth client.
"""

from __future__ import annotations

import argparse
import http.server
import threading
import urllib.parse
import webbrowser

import httpx

REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/oauth-callback"
SCOPE = "https://www.googleapis.com/auth/drive.file"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


class _Handler(http.server.BaseHTTPRequestHandler):
    """localhost callback server that captures the authorization code."""

    code: str | None = None

    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        self._finish("Connected. You can close this tab.")
        if "code" in params:
            type(self).code = params["code"][0]

    def _finish(self, message: str) -> None:
        body = (
            "<html><body style='font-family:system-ui;padding:40px'>"
            f"<h2>MadarBot - Google Drive</h2><p>{message}</p></body></html>"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Obtain a Google Drive OAuth refresh token.")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    args = parser.parse_args()

    server = http.server.HTTPServer(("127.0.0.1", REDIRECT_PORT), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    params = {
        "client_id": args.client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)

    print(f"Add this redirect URI to your Google Cloud OAuth client: {REDIRECT_URI}")
    print("Opening browser for Google consent...")
    print(f"If it does not open automatically, visit:\n{url}")
    webbrowser.open(url)

    import time

    while _Handler.code is None:
        time.sleep(0.5)
    code = _Handler.code
    server.shutdown()

    print("Authorization received, exchanging for a refresh token...")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "code": code,
            "redirect_uri": REDIRECT_URI,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    refresh = data.get("refresh_token")
    if not refresh:
        print("No refresh_token in response. Revoke access and run again with 'prompt=consent'.")
    else:
        print(
            "\nSUCCESS. Paste this into the dashboard backup settings "
            "(field: Google Drive refresh token):"
        )
        print(refresh)


if __name__ == "__main__":
    main()
