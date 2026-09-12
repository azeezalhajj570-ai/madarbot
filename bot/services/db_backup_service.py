"""Database PostgreSQL backup with local retention and Google Drive upload.

Config is stored in the ``system_config`` table (group 0) and edited from the
dashboard, mirroring the Odoo auto-backup module (a schedule + cloud provider).
Google Drive uses an OAuth2 refresh token.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models import SystemConfig
from bot.db.session import SessionLocal

logger = structlog.get_logger(__name__)

BACKUP_KEYS = frozenset(
    {
        "db_backup_enabled",
        "db_backup_storage_type",
        "db_backup_interval_hours",
        "db_backup_keep_days",
        "db_backup_dir",
        "db_backup_gdrive_client_id",
        "db_backup_gdrive_client_secret",
        "db_backup_gdrive_refresh_token",
        "db_backup_gdrive_folder_id",
    }
)

STORAGE_TYPE_LOCAL = "local"
STORAGE_TYPE_GDRIVE = "gdrive"
VALID_STORAGE_TYPES = frozenset({STORAGE_TYPE_LOCAL, STORAGE_TYPE_GDRIVE})

HISTORY_KEY = "db_backup_history"
HISTORY_CAP = 30
MIN_INTERVAL_HOURS = 0.5
BACKUP_FILE_PREFIX = "madarbot_"
BACKUP_FILE_SUFFIX = ".dump"


@dataclass
class BackupConfig:
    enabled: bool
    storage_type: str
    interval_hours: float
    keep_days: int
    backup_dir: str
    gdrive_client_id: str | None
    gdrive_client_secret: str | None
    gdrive_refresh_token: str | None
    gdrive_folder_id: str | None

    @property
    def gdrive_configured(self) -> bool:
        return all(
            [self.gdrive_client_id, self.gdrive_client_secret, self.gdrive_refresh_token]
        )

    @property
    def should_upload_gdrive(self) -> bool:
        return self.storage_type == STORAGE_TYPE_GDRIVE and self.gdrive_configured


def _parse_bool(value: Any, default: bool) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(value: Any, default: int) -> int:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_float(value: Any, default: float) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def load_system_config(session: AsyncSession) -> dict[str, str]:
    result = await session.execute(select(SystemConfig.key, SystemConfig.value))
    return {row.key: row.value for row in result.all()}


async def load_backup_config(
    session: AsyncSession | None = None,
    db_config: dict[str, str] | None = None,
) -> BackupConfig:
    """Load backup settings, favouring dashboard-stored values over env defaults."""
    if db_config is None:
        if session is None:
            async with SessionLocal() as own_session:
                db_config = await load_system_config(own_session)
        else:
            db_config = await load_system_config(session)
    settings = get_settings()

    raw_storage = db_config.get("db_backup_storage_type") or STORAGE_TYPE_LOCAL
    storage_type = raw_storage if raw_storage in VALID_STORAGE_TYPES else STORAGE_TYPE_LOCAL

    return BackupConfig(
        enabled=_parse_bool(db_config.get("db_backup_enabled"), False),
        storage_type=storage_type,
        interval_hours=_parse_float(
            db_config.get("db_backup_interval_hours"), settings.backup_interval_hours
        ),
        keep_days=_parse_int(db_config.get("db_backup_keep_days"), settings.backup_keep_days),
        backup_dir=db_config.get("db_backup_dir") or settings.backup_dir,
        gdrive_client_id=db_config.get("db_backup_gdrive_client_id") or settings.gdrive_client_id,
        gdrive_client_secret=db_config.get("db_backup_gdrive_client_secret")
        or settings.gdrive_client_secret,
        gdrive_refresh_token=db_config.get("db_backup_gdrive_refresh_token")
        or settings.gdrive_refresh_token,
        gdrive_folder_id=db_config.get("db_backup_gdrive_folder_id") or settings.gdrive_folder_id,
    )


async def upsert_system_value(session: AsyncSession, key: str, value: str) -> None:
    stmt = select(SystemConfig).where(SystemConfig.key == key)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        existing.value = value
    else:
        session.add(SystemConfig(key=key, value=value))
    await session.commit()


async def save_backup_config(session: AsyncSession, values: dict[str, Any]) -> dict[str, Any]:
    changed: dict[str, Any] = {}
    for key, value in values.items():
        if key not in BACKUP_KEYS:
            continue
        if isinstance(value, str) and len(value) > 2_000:
            raise ValueError(f"Field {key} is too long")
        if value is not None and isinstance(value, (bool, int, float, str)):
            await upsert_system_value(session, key, str(value))
            changed[key] = value
    return changed


def _pg_dump_args_and_env(
    cfg: BackupConfig, destination: str, db_url: str
) -> tuple[list[str], dict[str, str]]:
    """Build the pg_dump argv and process env for a custom-format dump."""
    url = make_url(db_url)
    host = url.host or "localhost"
    port = url.port or 5432
    database = url.database or ""
    user = url.username or os.environ.get("PGUSER", "postgres")
    password = url.password or ""

    argv = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        destination,
        "--host",
        host,
        "--port",
        str(port),
        "--username",
        user,
        database,
    ]
    env = dict(os.environ)
    if password:
        env["PGPASSWORD"] = password
    return argv, env


async def create_pg_dump(cfg: BackupConfig, destination: str, db_url: str) -> Path:
    """Run pg_dump asynchronously, writing a custom-format dump to ``destination``."""
    argv, env = _pg_dump_args_and_env(cfg, destination, db_url)
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    process = await asyncio.create_subprocess_exec(
        *argv,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        error = (stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError(f"pg_dump failed (exit {process.returncode}): {error}")
    return path


def _multipart_related_body(
    filepath: Path, metadata: dict[str, Any], boundary: str, prefix: bytes, suffix: bytes
) -> AsyncIterator[bytes]:
    """Stream a Drive ``multipart/related`` body without loading the dump into memory."""

    async def _iterate() -> AsyncIterator[bytes]:
        yield prefix
        with filepath.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                yield chunk
        yield suffix

    return _iterate()


async def _gdrive_access_token(client: httpx.AsyncClient, cfg: BackupConfig) -> str:
    """Exchange the stored refresh token for a short-lived Drive access token."""
    response = await client.post(
        get_settings().gdrive_token_endpoint,
        data={
            "grant_type": "refresh_token",
            "client_id": cfg.gdrive_client_id,
            "client_secret": cfg.gdrive_client_secret,
            "refresh_token": cfg.gdrive_refresh_token,
        },
    )
    response.raise_for_status()
    access_token = response.json().get("access_token")
    if not access_token:
        raise RuntimeError("Google token response missing access_token")
    return access_token


async def upload_to_gdrive(cfg: BackupConfig, filepath: Path) -> dict[str, Any]:
    """Upload a local dump to Google Drive using a short-lived OAuth access token.

    Drive's ``uploadType=multipart`` requires a ``multipart/related`` body whose
    first part is the JSON metadata, so the body is built by hand rather than
    letting httpx encode it as ``multipart/form-data``.
    """
    settings = get_settings()
    async with httpx.AsyncClient(timeout=300) as client:
        access_token = await _gdrive_access_token(client, cfg)

        metadata: dict[str, Any] = {"name": filepath.name}
        if cfg.gdrive_folder_id:
            metadata["parents"] = [cfg.gdrive_folder_id]

        boundary = f"madarbot{secrets.token_hex(16)}"
        prefix = (
            f"--{boundary}\r\n"
            "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(metadata)}\r\n"
            f"--{boundary}\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        content_length = len(prefix) + filepath.stat().st_size + len(suffix)

        upload = await client.post(
            settings.gdrive_upload_endpoint,
            params={"uploadType": "multipart"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": f"multipart/related; boundary={boundary}",
                "Content-Length": str(content_length),
            },
            content=_multipart_related_body(filepath, metadata, boundary, prefix, suffix),
        )
        upload.raise_for_status()
        body = upload.json()
        return {"gdrive_id": body.get("id"), "gdrive_name": body.get("name", filepath.name)}


async def prune_gdrive_backups(cfg: BackupConfig) -> list[str]:
    """Delete Drive dumps older than ``keep_days`` (<=0 keeps everything).

    Relies on the ``drive.file`` scope, so only files this app created are
    visible and eligible — never unrelated files in the account.
    """
    if cfg.keep_days <= 0 or not cfg.gdrive_configured:
        return []

    settings = get_settings()
    cutoff = datetime.now(UTC) - timedelta(days=cfg.keep_days)
    query = f"name contains '{BACKUP_FILE_PREFIX}' and trashed = false"
    if cfg.gdrive_folder_id:
        query += f" and '{cfg.gdrive_folder_id}' in parents"

    removed: list[str] = []
    async with httpx.AsyncClient(timeout=120) as client:
        headers = {"Authorization": f"Bearer {await _gdrive_access_token(client, cfg)}"}
        params: dict[str, str] = {
            "q": query,
            "fields": "nextPageToken, files(id, name, createdTime)",
            "pageSize": "1000",
        }
        while True:
            response = await client.get(
                settings.gdrive_files_endpoint, headers=headers, params=params
            )
            response.raise_for_status()
            body = response.json()
            for item in body.get("files", []):
                if not _is_backup_dump(Path(item.get("name", ""))):
                    continue
                created = item.get("createdTime")
                if not created:
                    continue
                created_at = datetime.fromisoformat(created)
                if created_at >= cutoff:
                    continue
                deletion = await client.delete(
                    f"{settings.gdrive_files_endpoint}/{item['id']}", headers=headers
                )
                deletion.raise_for_status()
                removed.append(item["name"])
            page_token = body.get("nextPageToken")
            if not page_token:
                break
            params["pageToken"] = page_token
    return removed


def _is_backup_dump(path: Path) -> bool:
    return path.name.startswith(BACKUP_FILE_PREFIX) and path.name.endswith(BACKUP_FILE_SUFFIX)


def prune_old_backups(cfg: BackupConfig, backup_dir: Path) -> list[str]:
    """Delete local dumps older than ``keep_days`` (<=0 keeps everything).

    Only files matching this service's own dump naming are eligible, so a
    misconfigured ``db_backup_dir`` cannot delete unrelated files.
    """
    if cfg.keep_days <= 0 or not backup_dir.is_dir():
        return []
    cutoff = datetime.now(UTC) - timedelta(days=cfg.keep_days)
    removed: list[str] = []
    for entry in backup_dir.iterdir():
        try:
            if not entry.is_file() or not _is_backup_dump(entry):
                continue
            mtime = datetime.fromtimestamp(entry.stat().st_mtime, tz=UTC)
            if mtime < cutoff:
                entry.unlink()
                removed.append(entry.name)
        except OSError as exc:
            logger.warning("backup_prune_failed", file=entry.name, error=str(exc))
    return removed


def _load_history(db_config: dict[str, str]) -> list[dict[str, Any]]:
    raw = db_config.get(HISTORY_KEY, "[]")
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def render_history(db_config: dict[str, str]) -> list[dict[str, Any]]:
    return _load_history(db_config)


async def record_backup(
    session: AsyncSession, db_config: dict[str, str], entry: dict[str, Any]
) -> None:
    history = _load_history(db_config)
    moment = entry.get("time") or datetime.now(UTC).isoformat()
    cleaned = {
        "time": moment,
        "filename": entry.get("filename"),
        "size": entry.get("size"),
        "local_path": entry.get("local_path"),
        "gdrive_id": entry.get("gdrive_id"),
        "gdrive_name": entry.get("gdrive_name"),
        "uploaded": entry.get("uploaded"),
        "error": entry.get("error"),
    }
    history.insert(0, cleaned)
    del history[HISTORY_CAP:]
    existing = await session.get(SystemConfig, HISTORY_KEY)
    if existing:
        existing.value = json.dumps(history)
    else:
        session.add(SystemConfig(key=HISTORY_KEY, value=json.dumps(history)))


async def run_backup_now(session: AsyncSession, cfg: BackupConfig) -> dict[str, Any]:
    """Perform one dump + optional Google Drive upload and record the result."""
    settings = get_settings()
    db_config = await load_system_config(session)
    raw_database = make_url(settings.database_url).database or "madarbot"
    database = re.sub(r"[^A-Za-z0-9_.-]", "_", Path(raw_database).name) or "madarbot"
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_dir = Path(cfg.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{BACKUP_FILE_PREFIX}{database}_{timestamp}{BACKUP_FILE_SUFFIX}"
    filepath = backup_dir / filename

    result: dict[str, Any] = {"filename": filename, "uploaded": False}

    try:
        await create_pg_dump(cfg, str(filepath), settings.database_url)
        result["size"] = filepath.stat().st_size
        result["local_path"] = str(filepath)

        removed = prune_old_backups(cfg, backup_dir)
        if removed:
            logger.info("backup_pruned", removed=removed)

        if cfg.should_upload_gdrive:
            gdrive = await upload_to_gdrive(cfg, filepath)
            result.update(gdrive)
            result["uploaded"] = True
            try:
                gdrive_removed = await prune_gdrive_backups(cfg)
            except Exception:
                logger.exception("backup_gdrive_prune_failed")
            else:
                if gdrive_removed:
                    logger.info("backup_gdrive_pruned", removed=gdrive_removed)
        else:
            logger.info("backup_gdrive_skipped_unconfigured")

        await record_backup(session, db_config, result)
        await session.commit()
        logger.info("backup_completed", **result)
        return result
    except Exception as exc:
        logger.exception("backup_failed")
        result["error"] = (str(exc).strip() or type(exc).__name__)[:500]
        await record_backup(session, db_config, result)
        await session.commit()
        raise


async def run_backup_now_standalone() -> dict[str, Any]:
    async with SessionLocal() as session:
        cfg = await load_backup_config(session)
        return await run_backup_now(session, cfg)


async def db_backup_loop() -> None:
    """Periodically run backups when dashboard-configured backup is enabled."""
    logger.info("db_backup_loop_started")
    cfg: BackupConfig | None = None
    while True:
        try:
            async with SessionLocal() as session:
                cfg = await load_backup_config(session)
                if cfg.enabled:
                    await run_backup_now(session, cfg)
                else:
                    logger.info("db_backup_skipped_disabled")
        except Exception:
            logger.exception("db_backup_tick_failed")
        interval = max((cfg.interval_hours if cfg else 24.0), MIN_INTERVAL_HOURS)
        await asyncio.sleep(interval * 3600)