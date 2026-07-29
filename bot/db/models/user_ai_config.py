from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, BigInteger
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class UserAIConfig(Base):
    __tablename__ = "user_ai_config"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), default="heuristic")
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(64), default="text-embedding-3-small")
    pilot_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
