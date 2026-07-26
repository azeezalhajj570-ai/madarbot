from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from bot.config import get_settings
from bot.db.session import SessionLocal
from bot.services.mcp_token_service import MCPTokenService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp/auth", tags=["mcp-oauth"])

_DEFAULT_CLIENT_ID = "madarbot"

AUTHORIZE_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Access — MadarBot</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,-apple-system,sans-serif;background:#0e0e10;color:#e4e4e7;display:grid;place-items:center;min-height:100vh;margin:0}}
.card{{background:#1a1a1e;border:1px solid #27272a;border-radius:16px;padding:40px;max-width:420px;width:90%;text-align:center}}
h1{{font-size:22px;margin-bottom:4px}}
.subtitle{{color:#a1a1aa;font-size:14px;margin-bottom:20px}}
.user-badge{{display:inline-flex;align-items:center;gap:8px;background:#27272a;border-radius:20px;padding:6px 16px;margin-bottom:24px;font-size:13px;color:#e4e4e7}}
.user-badge .dot{{width:8px;height:8px;background:#22c55e;border-radius:50%}}
.scopes{{background:#27272a;border-radius:8px;padding:12px 16px;margin-bottom:24px;text-align:left;font-size:13px}}
.scopes li{{list-style:none;padding:4px 0;color:#a1a1aa}}
.scopes li::before{{content:"\\2713";color:#22c55e;margin-right:8px}}
.buttons{{display:flex;gap:12px;justify-content:center}}
.btn{{padding:10px 28px;border-radius:8px;border:none;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-block}}
.btn-cancel{{background:#27272a;color:#a1a1aa}}
.btn-authorize{{background:#22c55e;color:#09090b}}
.btn-authorize:hover{{background:#16a34a}}
.loader{{width:32px;height:32px;border:3px solid #27272a;border-top-color:#22c55e;border-radius:50%;animation:spin .8s linear infinite;margin:24px auto}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
.error-msg{{color:#ef4444;font-size:13px;margin-top:12px}}
</style>
</head>
<body>
<div id="loading" class="card"><div class="loader"></div><p style="color:#a1a1aa;font-size:14px">Checking authentication…</p></div>
<div id="permission" class="card" style="display:none">
<h1>Authorize Access</h1>
<p class="subtitle">{client_name} wants to connect to MadarBot</p>
<div class="user-badge"><span class="dot"></span> Signed in as <span id="user-name"></span> (ID: <span id="user-id"></span>)</div>
<div class="scopes">
<ul>
<li>View and manage Telegram groups</li>
<li>View and export leads</li>
<li>Send messages</li>
<li>View analytics</li>
</ul>
</div>
<form method="POST" action="{action}" id="auth-form">
<input type="hidden" name="step" value="confirm">
<input type="hidden" name="client_id" value="{client_id_esc}">
<input type="hidden" name="redirect_uri" value="{redirect_uri_esc}">
<input type="hidden" name="state" value="{state_esc}">
<input type="hidden" name="code_challenge" value="{code_challenge_esc}">
<input type="hidden" name="code_challenge_method" value="{code_challenge_method_esc}">
<input type="hidden" name="dashboard_token" id="dashboard-token" value="">
<div class="buttons">
<a href="{cancel_url}" class="btn btn-cancel">Cancel</a>
<button type="submit" class="btn btn-authorize">Authorize</button>
</div>
</form>
<div class="error-msg" id="error-msg" style="display:none"></div>
</div>
<script>
(function() {{
  var authPageUrl = window.location.pathname + window.location.search;
  var authToken = localStorage.getItem('auth_token');
  var authUser  = localStorage.getItem('auth_user');

  if (!authToken) {{
    window.location.href = '/dashboard/login?redirect=' + encodeURIComponent(authPageUrl);
    return;
  }}

  fetch('/api/auth/me', {{ headers: {{ 'Authorization': 'Bearer ' + authToken }} }})
    .then(function(r) {{
      if (!r.ok) throw new Error('Auth failed');
      return r.json();
    }})
    .then(function(data) {{
      if (!data.user) throw new Error('No user');
      document.getElementById('loading').style.display = 'none';
      document.getElementById('permission').style.display = 'block';
      document.getElementById('user-name').textContent = data.user.username || data.user.first_name || 'User';
      document.getElementById('user-id').textContent = data.user.id;
      document.getElementById('dashboard-token').value = authToken;
    }})
    .catch(function() {{
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/dashboard/login?redirect=' + encodeURIComponent(authPageUrl);
    }});
}})();
</script>
</body>
</html>"""


def _redis(request: Request):
    return request.app.state.redis


async def _store_code(redis, code: str, data: dict, ttl: int):
    await redis.set(f"mcp_oauth_code:{code}", json.dumps(data), ex=ttl)


async def _consume_code(redis, code: str) -> dict | None:
    raw = await redis.get(f"mcp_oauth_code:{code}")
    if raw is None:
        return None
    await redis.delete(f"mcp_oauth_code:{code}")
    return json.loads(raw)


def _generate_code() -> str:
    return secrets.token_urlsafe(32)


def _verify_pkce(verifier: str, challenge: str, method: str) -> bool:
    if method == "S256":
        expected = hashlib.sha256(verifier.encode()).digest()
        expected_b64 = base64.urlsafe_b64encode(expected).decode().rstrip("=")
        return expected_b64 == challenge
    elif method == "plain":
        return verifier == challenge
    return False


def _form_val(data, key: str, default: str = "") -> str:
    if isinstance(data, dict):
        return str(data.get(key, default))
    return data.get(key, default)


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def _verify_dashboard_jwt(token: str) -> tuple[int, str] | None:
    try:
        from bot.dashboard.api.auth import decode_dashboard_jwt
        identity = decode_dashboard_jwt(token)
        return identity.user_id, identity.username or identity.first_name or f"User {identity.user_id}"
    except Exception:
        return None


@router.get("/")
@router.get("/authorize")
async def authorize_form(
    request: Request,
    client_id: str = Query(default=""),
    redirect_uri: str = Query(default=""),
    state: str = Query(default=""),
    response_type: str = Query(default=""),
    code_challenge: str = Query(default=""),
    code_challenge_method: str = Query(default=""),
):
    settings = get_settings()
    if not settings.mcp_oauth_enabled:
        return HTMLResponse("OAuth is not enabled", status_code=404)

    if not client_id:
        client_id = _DEFAULT_CLIENT_ID
    if response_type and response_type != "code":
        return _redirect_error(redirect_uri, state, "unsupported_response_type")

    cancel_url = redirect_uri
    if state:
        cancel_url += "?" if "?" not in redirect_uri else "&"
        cancel_url += urlencode({"error": "access_denied", "state": state})

    return HTMLResponse(
        AUTHORIZE_PAGE.format(
            action="/mcp/auth/authorize",
            client_name=client_id,
            client_id_esc=_html_escape(client_id),
            redirect_uri_esc=_html_escape(redirect_uri),
            state_esc=_html_escape(state),
            code_challenge_esc=_html_escape(code_challenge),
            code_challenge_method_esc=_html_escape(code_challenge_method),
            cancel_url=cancel_url,
        )
    )


@router.post("/authorize")
async def authorize_confirm(request: Request):
    settings = get_settings()
    if not settings.mcp_oauth_enabled:
        return HTMLResponse("OAuth is not enabled", status_code=404)

    form = await request.form()
    step = form.get("step", "")
    client_id = form.get("client_id", "") or _DEFAULT_CLIENT_ID
    redirect_uri = form.get("redirect_uri", "")
    state = form.get("state", "")
    code_challenge = form.get("code_challenge", "")
    code_challenge_method = form.get("code_challenge_method", "")

    if code_challenge and code_challenge_method not in ("S256", "plain"):
        return _redirect_error(redirect_uri, state, "invalid_request")

    if step == "confirm":
        dashboard_token = form.get("dashboard_token", "").strip()
        if not dashboard_token:
            return _redirect_error(redirect_uri, state, "invalid_request")

        result = _verify_dashboard_jwt(dashboard_token)
        if result is None:
            return HTMLResponse(
                content="Authentication expired. Please <a href='/dashboard/login'>sign in</a> again.",
                status_code=401,
            )

        tg_user_id, user_name = result
        code = _generate_code()
        await _store_code(
            _redis(request),
            code,
            dict(
                tg_user_id=tg_user_id,
                client_id=client_id,
                redirect_uri=redirect_uri,
                code_challenge=code_challenge,
                code_challenge_method=code_challenge_method,
            ),
            settings.mcp_oauth_code_ttl_seconds,
        )

        logger.info("mcp_oauth_code_issued client_id=%s tg_user_id=%s", client_id, tg_user_id)

        params = {"code": code}
        if state:
            params["state"] = state
        sep = "&" if "?" in redirect_uri else "?"
        return RedirectResponse(url=f"{redirect_uri}{sep}{urlencode(params)}", status_code=302)

    return _redirect_error(redirect_uri, state, "invalid_request")


@router.post("/token")
async def token_endpoint(request: Request):
    settings = get_settings()
    if not settings.mcp_oauth_enabled:
        return JSONResponse(status_code=404, content={"error": "oauth_disabled"})

    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        raw = await request.json()
    else:
        raw = await request.form()

    grant_type = _form_val(raw, "grant_type", "")
    code = _form_val(raw, "code", "")
    redirect_uri = _form_val(raw, "redirect_uri", "")
    client_id = _form_val(raw, "client_id", "")
    code_verifier = _form_val(raw, "code_verifier", "")

    if grant_type != "authorization_code":
        return JSONResponse(status_code=400, content={"error": "unsupported_grant_type"})

    code_data = await _consume_code(_redis(request), code)
    if code_data is None:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_grant", "error_description": "Code expired or invalid"},
        )

    if client_id and code_data.get("client_id") and code_data["client_id"] != client_id:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_grant", "error_description": "Client ID mismatch"},
        )
    if redirect_uri and code_data.get("redirect_uri"):
        stored = code_data["redirect_uri"].rstrip("/")
        incoming = redirect_uri.rstrip("/")
        if stored and incoming and stored != incoming:
            if not incoming.startswith(stored):
                return JSONResponse(
                    status_code=400,
                    content={"error": "invalid_grant",
                             "error_description": "Redirect URI mismatch"},
                )

    challenge = code_data.get("code_challenge")
    if challenge:
        if not code_verifier:
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_grant", "error_description": "code_verifier required"},
            )
        method = code_data.get("code_challenge_method", "S256")
        if not _verify_pkce(code_verifier, challenge, method):
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_grant",
                         "error_description": "PKCE verification failed"},
            )

    tg_user_id = code_data["tg_user_id"]
    expires_at = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + settings.mcp_oauth_token_ttl_seconds,
        tz=timezone.utc,
    )

    async with SessionLocal() as session:
        service = MCPTokenService(session)
        token, _ = await service.create_token(
            tg_user_id=tg_user_id,
            name=f"OAuth: {client_id}",
            expires_at=expires_at,
        )

    logger.info("mcp_oauth_token_issued client_id=%s tg_user_id=%s", client_id, tg_user_id)

    return JSONResponse(content={
        "access_token": token,
        "token_type": "bearer",
        "expires_in": settings.mcp_oauth_token_ttl_seconds,
        "scope": "tools",
    })


def _redirect_error(redirect_uri: str, state: str, error: str, description: str = ""):
    params = {"error": error}
    if state:
        params["state"] = state
    if description:
        params["error_description"] = description
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(url=f"{redirect_uri}{sep}{urlencode(params)}", status_code=302)
