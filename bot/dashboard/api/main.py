from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from bot.config import get_settings
from bot.dashboard.api.owner import router as owner_router
from bot.dashboard.api.scraper import router as scraper_router
from bot.dashboard.api.routers import auth_router
from bot.dashboard.api.routers.admin import router as admin_router
from bot.dashboard.api.routers.admin_automation import router as admin_automation_router
from bot.dashboard.api.routers.admin_summaries import router as admin_summaries_router
from bot.dashboard.api.routers.agents import router as agents_router
from bot.dashboard.api.routers.campaigns import router as campaigns_router
from bot.dashboard.api.routers.faq import router as faq_router
from bot.dashboard.api.routers.messaging import router as messaging_router
from bot.dashboard.api.routers.subscription import router as subscription_router
from bot.dashboard.api.routers.group_subscriptions import router as group_subscription_router
from bot.dashboard.api.routers.auth_boundary import router as auth_boundary_router
from bot.dashboard.api.routers.internal import router as internal_router
from bot.dashboard.api.routers.mcp_tokens import router as mcp_tokens_router
from bot.dashboard.api.routers.legal import router as legal_router
from bot.dashboard.api.routers.docs import router as docs_router
from bot.dashboard.api.middleware.rate_limit import RateLimitMiddleware
from bot.db.bootstrap import ensure_schema
from bot.db.session import engine
from bot.agents.session import shutdown_client_pool


async def _backfill_lead_group_titles() -> None:
    try:
        from sqlalchemy import select, update
        from bot.db.models import AgentLead, Group

        async with engine.begin() as conn:
            result = await conn.execute(
                select(AgentLead.id, AgentLead.source_group_tg_id, AgentLead.source_group_title)
                .where(AgentLead.source_group_tg_id.isnot(None))
                .where(AgentLead.source_group_tg_id != 0)
            )
            rows = result.all()
            if not rows:
                return

            updates = 0
            for lead_id, tg_group_id, current_title in rows:
                group_title = (
                    await conn.execute(select(Group.title).where(Group.tg_group_id == tg_group_id))
                ).scalar_one_or_none()
                if not group_title:
                    group_title = (
                        await conn.execute(
                            select(Group.title).where(Group.tg_group_id == -tg_group_id)
                        )
                    ).scalar_one_or_none()
                if group_title and group_title != current_title:
                    await conn.execute(
                        update(AgentLead)
                        .where(AgentLead.id == lead_id)
                        .values(source_group_title=group_title)
                    )
                    updates += 1

            if updates:
                logger.info(
                    "backfilled_lead_group_titles", updates=updates, total_checked=len(rows)
                )
    except Exception:
        logger.exception("lead_group_title_backfill_failed")


from bot.mcp.auth import verify_mcp_auth, verify_mcp_auth_async
from bot.mcp.context import set_mcp_actor_user_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.run_schema_bootstrap:
        await ensure_schema(engine)
    await _backfill_lead_group_titles()

    scheduler_task = None
    if settings.scheduler_enabled:
        from bot.services.scheduler import scheduler_loop

        scheduler_task = asyncio.create_task(scheduler_loop())
        logger.info("scheduler_loop_task_created")

    reconcile_task = None
    if settings.reconcile_enabled:
        from bot.services.scheduler import reconcile_loop

        reconcile_task = asyncio.create_task(reconcile_loop())
        logger.info("reconcile_loop_task_created")

    yield

    if reconcile_task:
        reconcile_task.cancel()
        try:
            await reconcile_task
        except asyncio.CancelledError:
            pass
    if scheduler_task:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
    await shutdown_client_pool()
    await engine.dispose()
    redis = getattr(app.state, "redis", None)
    if redis is not None:
        await redis.aclose()


app = FastAPI(
    title="MadarBot Dashboard API",
    version="1.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

settings = get_settings()
app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
cors_origins = [
    origin
    for origin in [
        settings.dashboard_url,
        settings.webapp_url,
        settings.admin_webapp_url,
        settings.agents_webapp_url,
    ]
    if origin
] or [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://localhost:5177",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
    "http://127.0.0.1:5177",
    "http://127.0.0.1:8000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    RateLimitMiddleware,
    redis=app.state.redis,
    requests_per_minute=settings.rate_limit_requests_per_minute,
    burst=settings.rate_limit_burst,
)

logger = logging.getLogger(__name__)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "request_validation_error method=%s path=%s errors=%s",
        request.method,
        request.url.path,
        exc.errors(),
    )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


dashboard_root_dir = Path(__file__).resolve().parent.parent
webapp_frontend_dir = dashboard_root_dir / "frontend"
webapp_assets_dir = webapp_frontend_dir / "assets"
webapp_admin_dir = webapp_frontend_dir / "admin"
webapp_admin_assets_dir = webapp_admin_dir / "assets"
webapp_agents_dir = webapp_frontend_dir / "agents"
webapp_agents_assets_dir = webapp_agents_dir / "assets"
UPLOADS_DIR = Path("/app/uploads")

webapp_channels_dir = webapp_frontend_dir / "channels"
webapp_channels_assets_dir = webapp_channels_dir / "assets"
webapp_modbot_dir = webapp_frontend_dir / "modbot"
webapp_modbot_assets_dir = webapp_modbot_dir / "assets"
browser_frontend_dir = dashboard_root_dir / "browser"
browser_assets_dir = browser_frontend_dir / "assets"

if webapp_assets_dir.exists():
    app.mount("/webapp/assets", StaticFiles(directory=str(webapp_assets_dir)), name="webapp-assets")
if webapp_admin_assets_dir.exists():
    app.mount(
        "/webapp/admin/assets",
        StaticFiles(directory=str(webapp_admin_assets_dir)),
        name="webapp-admin-assets",
    )
if webapp_agents_assets_dir.exists():
    app.mount(
        "/webapp/agents/assets",
        StaticFiles(directory=str(webapp_agents_assets_dir)),
        name="webapp-agents-assets",
    )
if webapp_channels_assets_dir.exists():
    app.mount(
        "/webapp/channels/assets",
        StaticFiles(directory=str(webapp_channels_assets_dir)),
        name="webapp-channels-assets",
    )
if webapp_modbot_assets_dir.exists():
    app.mount(
        "/webapp/modbot/assets",
        StaticFiles(directory=str(webapp_modbot_assets_dir)),
        name="webapp-modbot-assets",
    )
if browser_assets_dir.exists():
    app.mount(
        "/dashboard/assets", StaticFiles(directory=str(browser_assets_dir)), name="dashboard-assets"
    )

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="media-uploads"
)

app.include_router(owner_router)
app.include_router(scraper_router)
app.include_router(auth_router)
app.include_router(auth_boundary_router)
app.include_router(admin_router)
app.include_router(admin_automation_router)
app.include_router(admin_summaries_router)
app.include_router(faq_router)
app.include_router(agents_router)
app.include_router(campaigns_router)
app.include_router(messaging_router)
app.include_router(subscription_router)
app.include_router(group_subscription_router)
app.include_router(internal_router)
app.include_router(internal_router, prefix="/api/internal")
app.include_router(mcp_tokens_router)
app.include_router(legal_router)
app.include_router(docs_router)

if settings.mcp_enabled:
    from bot.dashboard.api.mcp_router import router as mcp_router
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse as StarletteJSONResponse

    if not settings.mcp_auth_token:
        logger.critical(
            "MCP_ENABLED=true but MCP_AUTH_TOKEN is not configured. "
            "Set MCP_AUTH_TOKEN in your .env file or set MCP_ENABLED=false."
        )
        raise SystemExit(1)

    class McpAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            path = request.url.path
            if path.startswith("/mcp") and ".well-known" not in path:
                token = None
                auth_header = request.headers.get("authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header[7:]
                _, tg_user_id = await verify_mcp_auth_async(token)
                if tg_user_id is None:
                    ok, _ = verify_mcp_auth(token)
                    if not ok:
                        return StarletteJSONResponse(
                            status_code=401,
                            content={
                                "error": "Invalid or missing MCP auth token. Pass via Authorization: Bearer header"
                            },
                        )
                if tg_user_id is not None:
                    set_mcp_actor_user_id(tg_user_id)
            response = await call_next(request)
            if path.startswith("/mcp"):
                response.headers["Content-Security-Policy"] = (
                    "default-src 'self'; "
                    "connect-src 'self' https://api.telegram.org https://api.openai.com https://generativelanguage.googleapis.com; "
                    "script-src 'self'; "
                    "style-src 'self' 'unsafe-inline'; "
                    "img-src 'self' data:; "
                    "frame-ancestors 'none'; "
                    "base-uri 'self'"
                )
            return response

    app.add_middleware(McpAuthMiddleware)
    app.include_router(mcp_router)
    logger.info("MCP endpoint mounted at /mcp")


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "madarbot-dashboard-api",
        "status": "ok",
        "health": "/health",
        "webapp_admin": "/webapp/admin",
        "webapp_agents": "/webapp/agents",
        "webapp_modbot": "/webapp/modbot",
        "dashboard": "/dashboard",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon_ico():
    return Response(status_code=204)


@app.get("/api/stripe/publishable-key")
async def stripe_publishable_key() -> dict[str, str | None]:
    settings = get_settings()
    return {"publishable_key": settings.stripe_publishable_key}


@app.get("/madarbot-dashboard-api")
async def service_root() -> dict[str, str]:
    return await root()


@app.get("/webapp")
async def webapp_shell(init_data: str | None = Query(default=None)) -> Response:
    location = "/webapp/admin"
    if init_data:
        location = f"{location}?init_data={init_data}"
    return RedirectResponse(location, status_code=307)


def _frontend_shell(frontend_dir: Path, missing_label: str) -> Response:
    index_file = frontend_dir / "index.html"
    if not index_file.exists():
        return HTMLResponse(f"<h3>{missing_label} frontend not found</h3>", status_code=404)
    return FileResponse(index_file)


@app.get("/webapp/admin")
async def webapp_admin_shell() -> Response:
    return _frontend_shell(webapp_admin_dir, "WebApp admin")


@app.get("/webapp/admin/{path:path}")
async def webapp_admin_shell_path(path: str) -> Response:
    _ = path
    return _frontend_shell(webapp_admin_dir, "WebApp admin")


@app.get("/webapp/agents")
async def webapp_agents_shell() -> Response:
    return _frontend_shell(webapp_agents_dir, "WebApp agents")


@app.get("/webapp/agents/{path:path}")
async def webapp_agents_shell_path(path: str) -> Response:
    _ = path
    return _frontend_shell(webapp_agents_dir, "WebApp agents")


@app.get("/webapp/agents-app")
async def webapp_agents_legacy_shell() -> Response:
    return RedirectResponse("/webapp/agents", status_code=307)


@app.get("/webapp/agents-app/{path:path}")
async def webapp_agents_legacy_shell_path(path: str) -> Response:
    return RedirectResponse(f"/webapp/agents/{path}", status_code=307)


@app.get("/webapp/channels")
async def webapp_channels_shell() -> Response:
    return _frontend_shell(webapp_channels_dir, "Channels")


@app.get("/webapp/channels/{path:path}")
async def webapp_channels_shell_path(path: str) -> Response:
    _ = path
    return _frontend_shell(webapp_channels_dir, "Channels")


@app.get("/webapp/modbot")
async def webapp_modbot_shell() -> Response:
    return _frontend_shell(webapp_modbot_dir, "Modbot")


@app.get("/webapp/modbot/{path:path}")
async def webapp_modbot_shell_path(path: str) -> Response:
    _ = path
    return _frontend_shell(webapp_modbot_dir, "Modbot")


@app.get("/payment/success")
async def payment_success() -> HTMLResponse:
    return HTMLResponse("""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Successful</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0e0e10;color:#e4e4e7;text-align:center">
<div><div style="font-size:64px">✅</div><h1 style="margin:16px 0 0">Payment Successful</h1><p style="color:#a1a1aa;margin:8px 0 24px">Your subscription has been activated. You can close this page.</p></div></body></html>""")


def _dashboard_shell() -> Response:
    index_file = browser_frontend_dir / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h3>Browser dashboard frontend not found</h3>", status_code=404)
    return FileResponse(index_file)


@app.get("/dashboard")
async def dashboard_shell() -> Response:
    return _dashboard_shell()


@app.get("/dashboard/{path:path}")
async def dashboard_shell_path(path: str) -> Response:
    _ = path
    return _dashboard_shell()
