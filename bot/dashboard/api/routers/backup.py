from __future__ import annotations

import asyncio
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models import SystemConfig
from bot.db.session import SessionLocal, get_session
from bot.services import db_backup_service as backup_service

from ..dependencies import require_bot_owner

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["backup"])

_SECRET_SUFFIX_FIELDS = ("secret", "token")


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    return f"****{value[-4:]}"


def _public_config(db_config: dict[str, str]) -> dict[str, Any]:
    public: dict[str, Any] = {}
    for key in backup_service.BACKUP_KEYS:
        value = db_config.get(key)
        if value is None:
            public[key] = None
        elif key.endswith(_SECRET_SUFFIX_FIELDS):
            public[key] = _mask(value)
        else:
            public[key] = value
    public["config_gdrive_connected"] = (
        db_config.get("db_backup_gdrive_client_id")
        and db_config.get("db_backup_gdrive_client_secret")
        and db_config.get("db_backup_gdrive_refresh_token")
    )
    return public


@router.get(
    "/api/backup/config",
    dependencies=[Depends(require_bot_owner)],
)
@router.get(
    "/webapp/owner/backup/config",
    dependencies=[Depends(require_bot_owner)],
)
async def get_backup_config(
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    db_config = await backup_service.load_system_config(session)
    return _public_config(db_config)


@router.put(
    "/api/backup/config",
    dependencies=[Depends(require_bot_owner)],
)
@router.put(
    "/webapp/owner/backup/config",
    dependencies=[Depends(require_bot_owner)],
)
async def update_backup_config(
    payload: dict[str, Any],
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if not payload:
        raise HTTPException(status_code=400, detail="Empty payload")
    try:
        changed = await backup_service.save_backup_config(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "ok", "changed": changed}


@router.post(
    "/api/backup/run",
    dependencies=[Depends(require_bot_owner)],
)
@router.post(
    "/webapp/owner/backup/run",
    dependencies=[Depends(require_bot_owner)],
)
async def run_backup(
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    cfg = await backup_service.load_backup_config(session)

    async def _do() -> None:
        async with SessionLocal() as worker_session:
            try:
                await backup_service.run_backup_now(worker_session, cfg)
            except Exception:
                logger.exception("backup_run_background_failed")

    asyncio.create_task(_do())
    return {"status": "started"}


@router.get(
    "/api/backup/history",
    dependencies=[Depends(require_bot_owner)],
)
@router.get(
    "/webapp/owner/backup/history",
    dependencies=[Depends(require_bot_owner)],
)
async def get_backup_history(
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    db_config = await backup_service.load_system_config(session)
    return backup_service.render_history(db_config)


async def _store_oauth_state(session: AsyncSession, state: str) -> None:
    await backup_service.upsert_system_value(session, "db_backup_gdrive_oauth_state", state)


async def _clear_oauth_state(session: AsyncSession) -> None:
    await session.execute(
        delete(SystemConfig).where(SystemConfig.key == "db_backup_gdrive_oauth_state")
    )
    await session.commit()


@router.post(
    "/api/backup/drive/auth-url",
    dependencies=[Depends(require_bot_owner)],
)
async def get_drive_auth_url(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    cfg = await backup_service.load_backup_config(session)
    if not cfg.gdrive_client_id or not cfg.gdrive_client_secret:
        raise HTTPException(status_code=400, detail="Google Drive client id/secret not configured")

    host = request.url.netloc
    redirect_uri = f"https://{host}/webapp/backup/gdrive/callback"
    state = secrets.token_hex(16)
    await _store_oauth_state(session, state)

    params = {
        "client_id": cfg.gdrive_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.file",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return {"url": url, "redirect_uri": redirect_uri}


@router.get("/webapp/backup/gdrive/callback")
@router.get("/api/backup/drive/callback")
async def drive_callback(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> str:
    code = request.query_params.get("code")
    error = request.query_params.get("error")
    state = request.query_params.get("state")

    if error:
        await _clear_oauth_state(session)
        return _html("Google Drive authorization failed", error)

    db_config = await backup_service.load_system_config(session)
    expected_state = db_config.get("db_backup_gdrive_oauth_state")
    if expected_state != state:
        return _html("State mismatch", "Please retry connecting Google Drive.")
    if not code:
        return _html("Missing code", "No authorization code returned.")

    cfg = await backup_service.load_backup_config(session, db_config)
    if not cfg.gdrive_client_id or not cfg.gdrive_client_secret:
        return _html(
            "Configuration missing",
            "Save a Google Drive client id and secret and try again.",
        )

    redirect_uri = f"https://{request.url.netloc}/webapp/backup/gdrive/callback"
    payload = {
        "grant_type": "authorization_code",
        "client_id": cfg.gdrive_client_id,
        "client_secret": cfg.gdrive_client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(get_settings().gdrive_token_endpoint, data=payload)
            resp.raise_for_status()
            refresh_token = resp.json().get("refresh_token")
    except Exception as exc:
        logger.exception("gdrive_token_exchange_failed")
        raise HTTPException(status_code=502, detail="Token exchange failed") from exc

    if not refresh_token:
        return _html(
            "No refresh token",
            "Google returned no refresh_token. Grant access again from the dashboard.",
        )

    await backup_service.save_backup_config(
        session, {"db_backup_gdrive_refresh_token": refresh_token}
    )
    await _clear_oauth_state(session)
    return RedirectResponse("/dashboard/admin/backup", status_code=303)


def _html(title: str, message: str) -> str:
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<title>MadarBot - Google Drive</title></head>"
        f"<body style='font-family:system-ui;max-width:520px;margin:80px auto;padding:0 16px'>"
        f"<h2>Google Drive</h2><p><strong>{title}</strong></p><p>{message}</p></body></html>"
    )
