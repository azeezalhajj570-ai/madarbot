from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sqlalchemy.pool import NullPool

from bot.config import get_settings

settings = get_settings()

_pool_kwargs: dict = {}
if settings.db_pool_size > 0:
    _pool_kwargs = {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_pool_size // 2,
        "pool_pre_ping": True,
    }
else:
    _pool_kwargs = {"poolclass": NullPool}

engine = create_async_engine(
    settings.database_url,
    **_pool_kwargs,
)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
