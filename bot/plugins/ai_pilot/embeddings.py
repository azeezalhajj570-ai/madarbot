from __future__ import annotations

import logging

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models.scraper import GroupKnowledge

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 512
BACKFILL_BATCH_SIZE = 20


class EmbeddingService:
    def __init__(self, api_key: str | None = None) -> None:
        settings = get_settings()
        self._api_key = api_key or settings.openai_api_key
        self._client = AsyncOpenAI(api_key=self._api_key)

    async def embed(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        return resp.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        return [d.embedding for d in resp.data]


class GroupKnowledgeEmbedder:
    def __init__(self, session: AsyncSession, embedder: EmbeddingService) -> None:
        self._session = session
        self._embedder = embedder

    async def embed_entry(self, entry: GroupKnowledge) -> list[float] | None:
        text = f"{entry.title or ''} {entry.content or ''}".strip()
        if not text:
            return None
        vec = await self._embedder.embed(text)
        entry.embedding = vec
        await self._session.commit()
        return vec

    async def backfill(
        self, batch_size: int = BACKFILL_BATCH_SIZE
    ) -> int:
        count = 0
        while True:
            result = await self._session.execute(
                select(GroupKnowledge)
                .where(GroupKnowledge.embedding.is_(None))
                .limit(batch_size)
            )
            entries = list(result.scalars().all())
            if not entries:
                break

            texts: list[str] = []
            for e in entries:
                text = f"{e.title or ''} {e.content or ''}".strip()
                texts.append(text)

            embeddings = await self._embedder.embed_batch(texts)
            for entry, emb in zip(entries, embeddings):
                entry.embedding = emb
            await self._session.commit()
            count += len(entries)
            logger.info("group_knowledge_backfill_progress", count=count)

        return count
