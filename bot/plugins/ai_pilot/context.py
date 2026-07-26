from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models.scraper import GroupKnowledge, ScrapedGroup
from bot.plugins.ai_pilot.embeddings import EmbeddingService
from bot.services.group_service import canonical_tg_group_id

logger = logging.getLogger(__name__)

KNOWLEDGE_TYPES = ("faq", "topic", "entity", "decision", "consensus")
MIN_CONFIDENCE = 0.5
MAX_CONTEXT_TOKENS = 1500
MAX_RESULTS = 15


class GroupContextService:
    def __init__(
        self, session: AsyncSession, embedder: EmbeddingService
    ) -> None:
        self._session = session
        self._embedder = embedder

    async def build_context_block(
        self, tg_group_id: int, query: str
    ) -> str:
        try:
            group = await self._get_group(tg_group_id)
            if group is None:
                return ""

            query_emb = await self._embedder.embed(query)

            rows = await self._semantic_search(group.id, query_emb)
            if not rows:
                return ""

            return self._format_context(
                group.title or str(tg_group_id), rows
            )
        except Exception as exc:
            logger.warning("group_context_failed", tg_group_id=tg_group_id, error=str(exc))
            return ""

    async def _get_group(self, tg_group_id: int) -> ScrapedGroup | None:
        canonical = canonical_tg_group_id(tg_group_id)
        result = await self._session.execute(
            select(ScrapedGroup).where(ScrapedGroup.tg_group_id == canonical)
        )
        return result.scalar_one_or_none()

    async def _semantic_search(
        self, scraped_group_id: int, query_emb: list[float]
    ) -> list[tuple[GroupKnowledge, float]]:
        stmt = (
            select(
                GroupKnowledge,
                GroupKnowledge.embedding.cosine_distance(query_emb).label("dist"),
            )
            .where(
                GroupKnowledge.scraped_group_id == scraped_group_id,
                GroupKnowledge.embedding.isnot(None),
                GroupKnowledge.confidence >= MIN_CONFIDENCE,
                GroupKnowledge.knowledge_type.in_(KNOWLEDGE_TYPES),
            )
            .order_by("dist")
            .limit(MAX_RESULTS)
        )
        result = await self._session.execute(stmt)
        return [(row, dist) for row, dist in result.all()]

    def _format_context(
        self,
        group_title: str,
        entries: list[tuple[GroupKnowledge, float]],
    ) -> str:
        lines = [
            f"## Group Context: {group_title}",
            "",
            "The following information has been extracted from this group's messages:",
        ]
        token_estimate = 0
        for entry, _dist in entries:
            addition = f"- [{entry.knowledge_type}] {entry.title}"
            if entry.content and len(entry.content) < 500:
                addition += f"\n  {entry.content[:300]}"

            entry_tokens = len(addition) // 4
            if token_estimate + entry_tokens > MAX_CONTEXT_TOKENS:
                break

            lines.append(addition)
            token_estimate += entry_tokens

        return "\n".join(lines)
