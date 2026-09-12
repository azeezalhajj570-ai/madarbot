from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Self
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from bot.dashboard.api.routers.backup import _public_config
from bot.db.bootstrap import ensure_schema
from bot.db.models import SystemConfig  # noqa: F401  (registers the table in metadata)
from bot.services import db_backup_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def backup_session(tmp_path: Path):
    db_path = tmp_path / "backup_test.sqlite3"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    await ensure_schema(engine)
    maker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with maker() as session:
        session.info["backup_dir"] = str(tmp_path / "dumps")
        yield session
    await engine.dispose()


async def _configure(session) -> None:
    await db_backup_service.save_backup_config(
        session,
        {
            "db_backup_enabled": "true",
            "db_backup_interval_hours": "6",
            "db_backup_keep_days": "3",
            "db_backup_dir": session.info["backup_dir"],
        },
    )


async def test_save_and_load_backup_config_roundtrip(backup_session) -> None:
    await _configure(backup_session)

    cfg = await db_backup_service.load_backup_config(backup_session)
    assert cfg.enabled is True
    assert cfg.interval_hours == 6
    assert cfg.keep_days == 3
    assert cfg.gdrive_configured is False


async def test_run_backup_now_records_history_local_only(backup_session, monkeypatch) -> None:
    await _configure(backup_session)
    cfg = await db_backup_service.load_backup_config(backup_session)

    async def _fake_dump(_cfg, destination: str, _db_url: str) -> Path:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake-dump")
        return path

    monkeypatch.setattr(db_backup_service, "create_pg_dump", AsyncMock(side_effect=_fake_dump))

    result = await db_backup_service.run_backup_now(backup_session, cfg)

    assert result["local_path"]
    assert Path(result["local_path"]).exists()
    assert result["uploaded"] is False

    db_config = await db_backup_service.load_system_config(backup_session)
    history = db_backup_service.render_history(db_config)
    assert len(history) == 1
    assert history[0]["filename"] == result["filename"]
    assert history[0]["uploaded"] is False


async def test_run_backup_now_uploads_to_gdrive(backup_session, monkeypatch) -> None:
    await _configure(backup_session)
    await db_backup_service.save_backup_config(
        backup_session,
        {
            "db_backup_storage_type": "gdrive",
            "db_backup_gdrive_client_id": "cid",
            "db_backup_gdrive_client_secret": "csecret",
            "db_backup_gdrive_refresh_token": "rtoken",
        },
    )
    cfg = await db_backup_service.load_backup_config(backup_session)
    assert cfg.gdrive_configured is True

    async def _fake_dump(_cfg, destination: Path, _db_url: str) -> Path:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake-dump")
        return path

    monkeypatch.setattr(db_backup_service, "create_pg_dump", AsyncMock(side_effect=_fake_dump))
    monkeypatch.setattr(
        db_backup_service,
        "upload_to_gdrive",
        AsyncMock(return_value={"gdrive_id": "FILE123", "gdrive_name": "backup.dump"}),
    )

    result = await db_backup_service.run_backup_now(backup_session, cfg)

    assert result["uploaded"] is True
    assert result["gdrive_id"] == "FILE123"


async def test_gdrive_upload_skipped_when_storage_type_local(backup_session, monkeypatch) -> None:
    await _configure(backup_session)
    await db_backup_service.save_backup_config(
        backup_session,
        {
            "db_backup_storage_type": "local",
            "db_backup_gdrive_client_id": "cid",
            "db_backup_gdrive_client_secret": "csecret",
            "db_backup_gdrive_refresh_token": "rtoken",
        },
    )
    cfg = await db_backup_service.load_backup_config(backup_session)
    assert cfg.gdrive_configured is True
    assert cfg.should_upload_gdrive is False

    async def _fake_dump(_cfg, destination: str, _db_url: str) -> Path:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake-dump")
        return path

    monkeypatch.setattr(db_backup_service, "create_pg_dump", AsyncMock(side_effect=_fake_dump))
    upload_mock = AsyncMock()
    monkeypatch.setattr(db_backup_service, "upload_to_gdrive", upload_mock)

    result = await db_backup_service.run_backup_now(backup_session, cfg)
    assert result["uploaded"] is False
    upload_mock.assert_not_called()


@pytest.mark.parametrize("secret_field", ["db_backup_gdrive_client_secret", "db_backup_gdrive_refresh_token"])
async def test_public_config_masks_secret_fields(secret_field: str) -> None:
    out = _public_config({secret_field: "abc12345"})
    assert out[secret_field] == "****2345"


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, calls: list[tuple[str, dict]]) -> None:
        self.calls = calls

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc) -> bool:
        return False

    async def post(self, url: str, **kwargs):
        self.calls.append((url, kwargs))
        if url == db_backup_service.get_settings().gdrive_token_endpoint:
            return _FakeResponse({"access_token": "tok"})
        return _FakeResponse({"id": "FILE1", "name": "madarbot_x.dump"})


async def test_upload_to_gdrive_sends_multipart_related(tmp_path, monkeypatch) -> None:
    dump = tmp_path / "madarbot_x.dump"
    dump.write_bytes(b"dump-bytes")
    cfg = db_backup_service.BackupConfig(
        enabled=True,
        storage_type=db_backup_service.STORAGE_TYPE_GDRIVE,
        interval_hours=24,
        keep_days=7,
        backup_dir=str(tmp_path),
        gdrive_client_id="cid",
        gdrive_client_secret="csecret",
        gdrive_refresh_token="rtoken",
        gdrive_folder_id="FOLDER1",
    )

    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        db_backup_service.httpx, "AsyncClient", lambda **_kwargs: _FakeAsyncClient(calls)
    )

    result = await db_backup_service.upload_to_gdrive(cfg, dump)

    assert result == {"gdrive_id": "FILE1", "gdrive_name": "madarbot_x.dump"}

    _, kwargs = calls[1]
    assert kwargs["params"] == {"uploadType": "multipart"}
    boundary = kwargs["headers"]["Content-Type"].split("boundary=", 1)[1]
    body = b"".join([chunk async for chunk in kwargs["content"]])

    assert kwargs["headers"]["Content-Length"] == str(len(body))
    assert body.startswith(f"--{boundary}\r\n".encode())
    assert b"Content-Type: application/json; charset=UTF-8" in body
    assert b'"name": "madarbot_x.dump"' in body
    assert b'"parents": ["FOLDER1"]' in body
    assert dump.read_bytes() in body
    assert body.endswith(f"\r\n--{boundary}--\r\n".encode())


def _cfg(tmp_path: Path, *, keep_days: int = 1) -> db_backup_service.BackupConfig:
    return db_backup_service.BackupConfig(
        enabled=True,
        storage_type=db_backup_service.STORAGE_TYPE_LOCAL,
        interval_hours=24,
        keep_days=keep_days,
        backup_dir=str(tmp_path),
        gdrive_client_id=None,
        gdrive_client_secret=None,
        gdrive_refresh_token=None,
        gdrive_folder_id=None,
    )


def _age(path: Path, days: int) -> None:
    stamp = (datetime.now(UTC) - timedelta(days=days)).timestamp()
    os.utime(path, (stamp, stamp))


async def test_prune_old_backups_only_removes_own_dumps(tmp_path) -> None:
    old_dump = tmp_path / "madarbot_combot_20260101_000000.dump"
    fresh_dump = tmp_path / "madarbot_combot_20260102_000000.dump"
    unrelated = tmp_path / "important.sql"
    nested = tmp_path / "madarbot_/app/test-dev.sqlite3_20260101.dump"
    nested.parent.mkdir(parents=True)
    for path in (old_dump, fresh_dump, unrelated, nested):
        path.write_bytes(b"x")
    for path in (old_dump, unrelated, nested):
        _age(path, 5)

    removed = db_backup_service.prune_old_backups(_cfg(tmp_path), tmp_path)

    assert removed == [old_dump.name]
    assert not old_dump.exists()
    assert fresh_dump.exists()
    assert unrelated.exists()
    assert nested.exists()


async def test_prune_old_backups_keep_days_zero_keeps_everything(tmp_path) -> None:
    dump = tmp_path / "madarbot_combot_20260101_000000.dump"
    dump.write_bytes(b"x")
    _age(dump, 5)

    assert db_backup_service.prune_old_backups(_cfg(tmp_path, keep_days=0), tmp_path) == []
    assert dump.exists()


class _FakeDriveClient:
    def __init__(self, calls: list[tuple[str, str, dict]], files: list[dict]) -> None:
        self.calls = calls
        self._files = files

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc) -> bool:
        return False

    async def post(self, url: str, **kwargs):
        self.calls.append(("post", url, kwargs))
        return _FakeResponse({"access_token": "tok"})

    async def get(self, url: str, **kwargs):
        self.calls.append(("get", url, kwargs))
        return _FakeResponse({"files": self._files})

    async def delete(self, url: str, **kwargs):
        self.calls.append(("delete", url, kwargs))
        return _FakeResponse({})


def _gdrive_cfg(**overrides) -> db_backup_service.BackupConfig:
    values: dict = {
        "enabled": True,
        "storage_type": db_backup_service.STORAGE_TYPE_GDRIVE,
        "interval_hours": 24,
        "keep_days": 7,
        "backup_dir": "backups",
        "gdrive_client_id": "cid",
        "gdrive_client_secret": "csecret",
        "gdrive_refresh_token": "rtoken",
        "gdrive_folder_id": None,
    }
    values.update(overrides)
    return db_backup_service.BackupConfig(**values)


def _drive_time(days_ago: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


async def test_prune_gdrive_backups_deletes_only_expired_dumps(monkeypatch) -> None:
    files = [
        {"id": "OLD1", "name": "madarbot_combot_20260101_000000.dump", "createdTime": _drive_time(30)},
        {"id": "NEW1", "name": "madarbot_combot_20260102_000000.dump", "createdTime": _drive_time(1)},
        {"id": "OTHER", "name": "notes.txt", "createdTime": _drive_time(30)},
    ]
    calls: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        db_backup_service.httpx, "AsyncClient", lambda **_kwargs: _FakeDriveClient(calls, files)
    )

    removed = await db_backup_service.prune_gdrive_backups(_gdrive_cfg())

    assert removed == ["madarbot_combot_20260101_000000.dump"]
    deletes = [call for call in calls if call[0] == "delete"]
    assert len(deletes) == 1
    assert deletes[0][1].endswith("/OLD1")

    query = next(call for call in calls if call[0] == "get")[2]["params"]["q"]
    assert f"name contains '{db_backup_service.BACKUP_FILE_PREFIX}'" in query


async def test_prune_gdrive_backups_scopes_query_to_folder(monkeypatch) -> None:
    calls: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        db_backup_service.httpx, "AsyncClient", lambda **_kwargs: _FakeDriveClient(calls, [])
    )

    await db_backup_service.prune_gdrive_backups(_gdrive_cfg(gdrive_folder_id="FOLDER9"))

    query = next(call for call in calls if call[0] == "get")[2]["params"]["q"]
    assert "'FOLDER9' in parents" in query


async def test_prune_gdrive_backups_skips_when_keep_days_zero(monkeypatch) -> None:
    calls: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        db_backup_service.httpx, "AsyncClient", lambda **_kwargs: _FakeDriveClient(calls, [])
    )

    assert await db_backup_service.prune_gdrive_backups(_gdrive_cfg(keep_days=0)) == []
    assert calls == []