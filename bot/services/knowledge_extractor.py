from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

import aiohttp
import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models import ScrapedDailySummary, ScrapedMessage
from bot.db.models.scraper import GroupKnowledge

logger = structlog.get_logger(__name__)

KNOWLEDGE_EXTRACTION_PROMPT = """Analyze these Telegram group messages and extract structured knowledge.
Return a valid JSON object. The outermost value MUST be a JSON object wrapped in curly braces { }. Do NOT return just an array or a bare key.

Expected format:
{
  "faqs": [{"question": "...", "answer": "...", "category": "...", "keywords": ["..."]}],
  "topics": [{"topic": "...", "description": "...", "message_count": 0, "sentiment": "neutral"}],
  "entities": [{"name": "...", "type": "person", "mentions": 0, "context": "..."}],
  "decisions": [{"decision": "...", "rationale": "...", "participants": [], "confidence": 0.0}],
  "trends": [{"trend": "...", "direction": "stable", "evidence": "..."}],
  "insights": [{"insight": "...", "importance": "medium", "actionable": false}]
}

Only include items with confidence >= 0.6. Be concise. Focus on actionable knowledge.

Messages:
{chunk_text}"""

DAILY_SUMMARY_PROMPT = """Summarize this day's Telegram group activity into a concise JSON:

{
  "summary": "1-2 paragraph summary of key discussions, decisions, and notable events",
  "top_topics": {"topic_name": message_count, ...},
  "active_users": [user_id1, user_id2, ...],  (most active, top 10)
  "highlights": ["highlight 1", "highlight 2", ...],
  "decisions_made": ["decision 1", "decision 2", ...],
  "sentiment": {"positive": N, "neutral": N, "negative": N}
}

Messages for date {date}:
{messages_text}"""


def _format_prompt(template: str, chunk_text: str, **extra) -> str:
    """Format prompt template safely without interpreting JSON curly braces."""
    result = template.replace("{chunk_text}", chunk_text)
    for key, value in extra.items():
        result = result.replace(f"{{{key}}}", str(value))
    return result


class KnowledgeExtractor:
    def __init__(self, session: AsyncSession, config_override: dict[str, str] | None = None) -> None:
        self.session = session
        self._settings = get_settings()
        self._config_override = config_override or {}
        self._system_config: dict[str, str] = {}

    async def load_system_config(self) -> None:
        """Load AI provider settings from system_config table."""
        try:
            from bot.db.models.system_config import SystemConfig
            rows = (await self.session.execute(
                select(SystemConfig).where(SystemConfig.key.like('ai_%'))
            )).scalars().all()
            self._system_config = {r.key: r.value for r in rows}
        except Exception:
            self._system_config = {}

    def _cfg(self, key: str, default: str = "") -> str:
        # Priority: config_override > system_config > env default
        if key in self._config_override and self._config_override[key]:
            return self._config_override[key]
        system_key = key.replace("ai_provider", "ai_provider")
        if key == "ai_provider" and self._system_config.get("ai_provider"):
            return self._system_config["ai_provider"]
        if key == "ai_provider_api_key" and self._system_config.get("ai_provider_api_key"):
            return self._system_config["ai_provider_api_key"]
        if key == "ai_provider_model" and self._system_config.get("ai_provider_model"):
            return self._system_config["ai_provider_model"]
        if key == "ai_provider_base_url" and self._system_config.get("ai_provider_base_url"):
            return self._system_config["ai_provider_base_url"]
        return default or ""

    async def extract_knowledge(
        self, *, scraped_group_id: int, max_messages: int = 2000
    ) -> dict[str, Any]:
        messages = await self._fetch_message_texts(scraped_group_id, max_messages)
        if not messages:
            return {"status": "no_messages", "saved": 0, "message_count": 0, "cost_estimate": 0.0}

        # Use 8000-char chunks. Larger chunks cause cheap/free models (e.g.
        # openrouter/free) to ignore JSON instructions and return safety text.
        # 8000 chars keeps prompts within reliable token limits for most models.
        chunks = self._chunk_messages(messages, max_chars=8000)
        max_chunks = 10
        if len(chunks) > max_chunks:
            chunks = chunks[:max_chunks]
        all_results: dict[str, list[dict[str, Any]]] = {
            "faqs": [],
            "topics": [],
            "entities": [],
            "decisions": [],
            "trends": [],
            "insights": [],
        }
        total_cost = 0.0
        empty_chunks = 0

        # Give each chunk up to 120s; free/slow providers can take 20-30s.
        chunk_timeout = max(self._settings.ai_request_timeout_seconds, 120.0)
        for i, chunk in enumerate(chunks):
            if i > 0:
                await asyncio.sleep(1.5)
            result, cost = await self._call_ai(
                KNOWLEDGE_EXTRACTION_PROMPT,
                chunk_text=chunk,
                phase="bulk",
                timeout_seconds=chunk_timeout,
            )
            total_cost += cost
            if result:
                for key in all_results:
                    items = result.get(key, [])
                    if isinstance(items, list):
                        all_results[key].extend(items)
            else:
                empty_chunks += 1
                logger.warning(
                    "knowledge_extraction_chunk_empty scraped_group_id=%s chunk_index=%s total_chunks=%s",
                    scraped_group_id,
                    i,
                    len(chunks),
                )

        if empty_chunks and empty_chunks == len(chunks):
            logger.error(
                "knowledge_extraction_all_chunks_empty scraped_group_id=%s total_chunks=%s provider=%s model=%s",
                scraped_group_id,
                len(chunks),
                self._cfg("ai_provider", self._settings.ai_provider),
                self._cfg("ai_provider_model", ""),
            )
            return {
                "status": "failed",
                "saved": 0,
                "message_count": len(messages),
                "cost_estimate": round(total_cost, 4),
                "error": "AI returned no parseable JSON for any chunk. Try a different model in AI Settings.",
            }

        refined_results, refine_cost = await self._refine_knowledge(all_results)
        total_cost += refine_cost

        saved_count = await self._save_knowledge(scraped_group_id, refined_results)
        logger.info(
            "knowledge_extraction_done scraped_group_id=%s saved=%s cost_estimate=%s",
            scraped_group_id,
            saved_count,
            round(total_cost, 4),
        )
        return {
            "saved": saved_count,
            "items_saved": saved_count,
            "message_count": len(messages),
            "cost_estimate": round(total_cost, 4),
        }

    async def generate_daily_summary(
        self, *, scraped_group_id: int, date: datetime
    ) -> ScrapedDailySummary | None:
        messages = await self._fetch_message_texts(scraped_group_id, 500, date=date)
        if not messages:
            return None

        chunk_text = " ".join(text for _, text in messages)
        if len(chunk_text) < 100:
            return None

        result, cost = await self._call_ai(
            DAILY_SUMMARY_PROMPT,
            chunk_text="",
            messages_text=chunk_text[:12000],
            date=date.strftime("%Y-%m-%d"),
            phase="summary",
        )
        if not result:
            return None

        user_ids = sorted({uid for uid, _ in messages if uid is not None})[:10]

        summary = ScrapedDailySummary(
            scraped_group_id=scraped_group_id,
            date=date,
            message_count=len(messages),
            active_users=user_ids,
            top_topics=result.get("top_topics"),
            summary=result.get("summary"),
        )
        self.session.add(summary)
        await self.session.commit()
        return summary

    async def _fetch_message_texts(
        self, scraped_group_id: int, max_messages: int, date: datetime | None = None
    ) -> list[tuple[int | None, str]]:
        stmt = select(ScrapedMessage.sender_user_id, ScrapedMessage.message_text).where(
            ScrapedMessage.scraped_group_id == scraped_group_id,
            ScrapedMessage.message_text.isnot(None),
            func.length(ScrapedMessage.message_text) >= 10,
        )
        if date is not None:
            start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_of_day = start_of_day + timedelta(days=1)
            stmt = stmt.where(
                ScrapedMessage.message_date >= start_of_day,
                ScrapedMessage.message_date < end_of_day,
            )
        stmt = stmt.order_by(ScrapedMessage.message_date.desc()).limit(max_messages)
        result = await self.session.execute(stmt)
        return [(row[0], str(row[1])) for row in result.all() if row[1] is not None]

    def _chunk_messages(
        self, messages: list[tuple[int | None, str]], max_chars: int = 8000
    ) -> list[str]:
        chunks: list[str] = []
        current: list[str] = []
        current_len = 0
        for uid, text in messages:
            prefix = f"[u{uid}] " if uid else ""
            line = prefix + text
            if current_len + len(line) > max_chars and current:
                chunks.append(" ".join(current))
                current = []
                current_len = 0
            current.append(line)
            current_len += len(line)
        if current:
            chunks.append(" ".join(current))
        return chunks

    async def _call_ai(
        self, prompt_template: str, *, chunk_text: str = "", timeout_seconds: float | None = None, **extra
    ) -> tuple[dict[str, Any] | None, float]:
        provider = self._cfg("ai_provider", self._settings.ai_provider).lower()

        if provider == "openai":
            return await self._call_openai(prompt_template, chunk_text, timeout_seconds=timeout_seconds, **extra)
        elif provider == "gemini":
            return await self._call_gemini(prompt_template, chunk_text, timeout_seconds=timeout_seconds, **extra)
        elif provider == "openrouter":
            return await self._call_openrouter(prompt_template, chunk_text, timeout_seconds=timeout_seconds, **extra)
        else:
            logger.warning("knowledge_extraction_unknown_provider provider=%s", provider)
            return None, 0.0

    async def _call_openai(
        self, prompt_template: str, chunk_text: str, *, timeout_seconds: float | None = None, **extra
    ) -> tuple[dict[str, Any] | None, float]:
        api_key = self._cfg("ai_provider_api_key", self._settings.openai_api_key or "")
        if not api_key:
            return None, 0.0

        prompt = _format_prompt(prompt_template, chunk_text, **extra)
        model = self._cfg("ai_provider_model", self._settings.openai_model)
        base_url = self._cfg("ai_provider_base_url", "https://api.openai.com/v1").rstrip("/")
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a knowledge extraction engine. Return only valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 4096,
        }

        timeout = timeout_seconds or self._settings.ai_request_timeout_seconds
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    data = await resp.json()
                    content = (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "")
                    usage = data.get("usage", {})
                    cost = (
                        usage.get("prompt_tokens", 0) * 0.00015
                        + usage.get("completion_tokens", 0) * 0.0006
                    ) / 1000
                    return self._parse_json_response(content), cost
        except Exception as exc:
            logger.warning("openai_extract_failed error=%s", str(exc))
            return None, 0.0

    async def _call_gemini(
        self, prompt_template: str, chunk_text: str, *, timeout_seconds: float | None = None, **extra
    ) -> tuple[dict[str, Any] | None, float]:
        api_key = self._cfg("ai_provider_api_key", self._settings.gemini_api_key or "")
        if not api_key:
            return None, 0.0

        prompt = _format_prompt(prompt_template, chunk_text, **extra)
        model = self._cfg("ai_provider_model", self._settings.gemini_model)
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096},
        }

        timeout = timeout_seconds or self._settings.ai_request_timeout_seconds
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    params={"key": api_key},
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    data = await resp.json()
                    text = (
                        data.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [{}])[0]
                        .get("text", "") or ""
                    )
                    usage = data.get("usageMetadata", {})
                    cost = (
                        usage.get("promptTokenCount", 0) * 0.0000375
                        + usage.get("candidatesTokenCount", 0) * 0.00015
                    ) / 1000
                    return self._parse_json_response(text), cost
        except Exception as exc:
            logger.warning("gemini_extract_failed error=%s", str(exc))
            return None, 0.0

    async def _call_openrouter(
        self, prompt_template: str, chunk_text: str, *, phase: str = "bulk", timeout_seconds: float | None = None, **extra
    ) -> tuple[dict[str, Any] | None, float]:
        api_key = self._cfg("ai_provider_api_key", self._settings.openrouter_api_key or "")
        if not api_key:
            return None, 0.0

        override_model = self._cfg("ai_provider_model")
        if override_model:
            model = override_model
        elif phase == "bulk":
            model = self._settings.openrouter_model_bulk or self._settings.openrouter_model
        elif phase == "premium":
            model = self._settings.openrouter_model_premium or self._settings.openrouter_model
        else:
            model = self._settings.openrouter_model

        prompt = _format_prompt(prompt_template, chunk_text, **extra)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if self._settings.openrouter_app_url:
            headers["HTTP-Referer"] = self._settings.openrouter_app_url
        headers["X-Title"] = self._settings.openrouter_app_title

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a knowledge extraction engine. Return only valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 4096,
        }

        timeout = timeout_seconds or self._settings.ai_request_timeout_seconds
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    data = await resp.json()
                    content = (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "")
                    usage = data.get("usage", {})
                    pricing = (
                        float(usage.get("prompt_tokens", 0)) * 0.0000001
                        + float(usage.get("completion_tokens", 0)) * 0.0000004
                    )
                    cost = (
                        pricing
                        if data.get("total_cost", 0) == 0
                        else data.get("total_cost", pricing)
                    )
                    parsed = self._parse_json_response(content)
                    if not parsed and content.strip():
                        logger.warning(
                            "openrouter_extract_non_json content_preview=%s content_length=%s model=%s",
                            content[:200],
                            len(content),
                            model,
                        )
                    return parsed, cost
        except Exception as exc:
            logger.warning("openrouter_extract_failed error=%s", str(exc))
            return None, 0.0

    async def _refine_knowledge(
        self, raw_results: dict[str, list[dict[str, Any]]]
    ) -> tuple[dict[str, list[dict[str, Any]]], float]:
        refined: dict[str, list[dict[str, Any]]] = {}
        total_cost = 0.0
        for key, items in raw_results.items():
            if not items:
                refined[key] = []
                continue
            seen = set()
            deduped: list[dict[str, Any]] = []
            for item in items:
                fingerprint = json.dumps(item, sort_keys=True, default=str)
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    conf = item.get("confidence", 0.0)
                    if isinstance(conf, (int, float)) and conf >= 0.5:
                        deduped.append(item)
            refined[key] = deduped
        return refined, total_cost

    async def _save_knowledge(
        self, scraped_group_id: int, results: dict[str, list[dict[str, Any]]]
    ) -> int:
        saved = 0
        fresh_entries: list[GroupKnowledge] = []
        for knowledge_type, items in results.items():
            for item in items:
                entry = GroupKnowledge(
                    scraped_group_id=scraped_group_id,
                    knowledge_type=knowledge_type,
                    title=str(
                        item.get("question")
                        or item.get("topic")
                        or item.get("name")
                        or item.get("decision")
                        or item.get("trend")
                        or item.get("insight", "")
                    )[:500],
                    content=json.dumps(item, default=str),
                    source_message_ids=item.get("source_message_ids"),
                    confidence=float(item.get("confidence", 0.5)),
                    first_seen=datetime.utcnow(),
                    last_updated=datetime.utcnow(),
                )
                self.session.add(entry)
                fresh_entries.append(entry)
                saved += 1
        if saved:
            await self.session.commit()

            for entry in fresh_entries:
                text = f"{entry.title or ''} {entry.content or ''}".strip()
                if not text:
                    continue
                try:
                    from bot.plugins.ai_pilot.embeddings import EmbeddingService

                    emb_model = self._cfg("ai_embedding_model", "text-embedding-3-small")
                    emb_api_key = self._cfg("ai_embedding_api_key")
                    emb_base_url = self._cfg("ai_embedding_base_url")
                    svc = EmbeddingService(
                        api_key=emb_api_key or None,
                        model=emb_model,
                        base_url=emb_base_url or None,
                    )
                    vec = await svc.embed(text)
                    entry.embedding = vec
                except Exception as exc:
                    logger.warning(
                        "knowledge_embed_failed entry_id=%s error=%s",
                        entry.id,
                        str(exc),
                    )

            if fresh_entries:
                await self.session.commit()

        return saved

    @staticmethod
    def _parse_json_response(text: str) -> dict[str, Any] | None:
        if not text:
            return None
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
            text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            try:
                start = text.find("{")
                end = text.rfind("}") + 1
                if start >= 0 and end > start:
                    return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
            # Some models return unwrapped JSON: "key": [...] instead of {"key": [...]}
            try:
                if text.startswith('"') or text.startswith("'"):
                    wrapped = "{" + text + "}"
                    return json.loads(wrapped)
            except json.JSONDecodeError:
                pass
            return None
        return None
