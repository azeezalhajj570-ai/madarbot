# RAG-Powered AI Reply for Agent Messages (pgvector)

## Problem

When an agent receives a mention in a group, the AI Pilot replies using only conversation history (Redis). It has no knowledge of the group's context — FAQ entries, past decisions, extracted topics, or known entities stored in `group_knowledge`. Replies are generic and ignore the group's established knowledge base.

## Solution

Use **pgvector** for semantic search over `group_knowledge` entries. On each @mention, embed the user's message, find the top-K most semantically similar knowledge entries via cosine similarity, and inject them into the AI Pilot's system prompt.

---

## Architecture

```
                  ┌─────────────────────┐
                  │  Telegram Message    │
                  │  (@mention in group) │
                  └────────┬────────────┘
                           ▼
                  ┌─────────────────────┐
                  │  AgentListener      │
                  │  _handle_group_     │
                  │  mention()          │
                  └────────┬────────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
      ┌─────────────────┐   ┌──────────────────┐
      │ EmbeddingService │   │ AIPilotService   │
      │ (OpenAI API)     │   │ generate_reply() │
      └────────┬────────┘   └────────┬─────────┘
               │                     │
               ▼                     ▼
      ┌─────────────────┐   ┌──────────────────┐
      │ pgvector search  │   │ LLM Provider     │
      │ (cosine sim,     │   │ (chat completion) │
      │  top-K = 15)     │   └──────────────────┘
      └─────────────────┘
               │
               ▼
      ┌─────────────────┐
      │ group_knowledge  │
      │ (+ embedding     │
      │  column)         │
      └─────────────────┘
```

---

## Infrastructure Changes

### 1. PostgreSQL → pgvector

**docker-compose.yml:**

Replace `postgres:16` with `pgvector/pgvector:pg16`:

```yaml
postgres:
  image: pgvector/pgvector:pg16
  # all other config unchanged
```

Source: https://hub.docker.com/r/pgvector/pgvector

The `pgvector/pgvector:pg16` image is the official pgvector Docker image built on `postgres:16`. No schema or data changes — it's a drop-in replacement. The `vector` extension must be created in the database.

**Alembic migration (first step):**

```python
# revision: xxxx_add_pgvector_extension
def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
```

### 2. Python Dependency

Add to `requirements.txt`:

```
pgvector>=0.3.0
```

Source: https://github.com/pgvector/pgvector-python

Provides SQLAlchemy `Vector` type for ORM mappings and `distance_strategy` helpers.

---

## Data Model Changes

### `group_knowledge` Table — Add `embedding` Column

```python
from pgvector.sqlalchemy import Vector

class GroupKnowledge(Base):
    __tablename__ = "group_knowledge"
    # ...existing columns...

    embedding: Mapped[Optional[list[float]]] = mapped_column(
        Vector(1536), nullable=True, index=True
    )
```

- `Vector(1536)` matches OpenAI `text-embedding-3-small` output dimension
- Index: pgvector supports IVFFlat or HNSW indexes for fast ANN search
- Nullable: existing rows start with NULL; backfill script fills them

**Alembic migration:**

```python
from pgvector.sqlalchemy import Vector

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("group_knowledge", sa.Column("embedding", Vector(1536), nullable=True))
    op.create_index("ix_group_knowledge_embedding", "group_knowledge", ["embedding"], postgresql_using="ivfflat", postgresql_with={"lists": 100})
```

---

## New Components

### 1. `EmbeddingService` (new: `bot/plugins/ai_pilot/embeddings.py`)

```python
class EmbeddingService:
    def __init__(self, api_key: str | None = None, model: str = "text-embedding-3-small"):
        self._api_key = api_key or settings.openai_api_key
        self._model = model
        self._client = openai.AsyncOpenAI(api_key=self._api_key)

    async def embed(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(
            model=self._model,
            input=text,
        )
        return resp.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.embeddings.create(
            model=self._model,
            input=texts,
        )
        return [d.embedding for d in resp.data]
```

Source: https://platform.openai.com/docs/guides/embeddings

### 2. `GroupKnowledgeEmbedder` (new: `bot/plugins/ai_pilot/embeddings.py`)

Backfills embeddings for existing and newly created `GroupKnowledge` entries:

```python
class GroupKnowledgeEmbedder:
    def __init__(self, session: AsyncSession, embedder: EmbeddingService):
        self._session = session
        self._embedder = embedder

    async def embed_entry(self, entry: GroupKnowledge) -> None:
        text = f"{entry.title or ''} {entry.content or ''}".strip()
        if not text:
            return
        entry.embedding = await self._embedder.embed(text)
        await self._session.commit()

    async def backfill(self, batch_size: int = 20) -> int:
        """Embed all entries that have NULL embedding. Returns count."""
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
            texts = [
                f"{e.title or ''} {e.content or ''}".strip()
                for e in entries
            ]
            embeddings = await self._embedder.embed_batch(texts)
            for entry, emb in zip(entries, embeddings):
                entry.embedding = emb
            await self._session.commit()
            count += len(entries)
        return count
```

**Trigger points for embedding:**
1. When `KnowledgeExtractor._save_knowledge()` creates a new entry → immediately embed it
2. Backfill script for existing entries (run once after migration)

### 3. `GroupContextService` — Semantic Retrieval (new: `bot/plugins/ai_pilot/context.py`)

```python
from pgvector.sqlalchemy import Vector

class GroupContextService:
    def __init__(self, session: AsyncSession, embedder: EmbeddingService):
        self._session = session
        self._embedder = embedder

    async def build_context_block(self, tg_group_id: int, query: str) -> str:
        # 1. Resolve scraped_group_id
        group = await self._get_group(tg_group_id)
        if group is None:
            return ""

        # 2. Embed the user's message
        query_emb = await self._embedder.embed(query)

        # 3. Semantic search: cosine similarity
        stmt = (
            select(GroupKnowledge, GroupKnowledge.embedding.cosine_distance(query_emb).label("distance"))
            .where(
                GroupKnowledge.scraped_group_id == group.id,
                GroupKnowledge.embedding.isnot(None),
                GroupKnowledge.confidence >= 0.5,
                GroupKnowledge.knowledge_type.in_(("faq", "topic", "entity", "decision", "consensus")),
            )
            .order_by("distance")
            .limit(15)
        )
        result = await self._session.execute(stmt)
        rows = result.all()

        if not rows:
            return ""

        # 4. Format into markdown
        lines = [f"## Group Context: {group.title or tg_group_id}"]
        lines.append("")
        lines.append("The following information has been extracted from this group's messages:")
        for row, _ in rows:
            lines.append(f"- [{row.knowledge_type}] {row.title}")
            if row.content and len(row.content) < 500:
                lines.append(f"  {row.content[:300]}")

        return "\n".join(lines)

    async def _get_group(self, tg_group_id: int) -> ScrapedGroup | None:
        from bot.services.group_service import canonical_tg_group_id
        canonical = canonical_tg_group_id(tg_group_id)
        result = await self._session.execute(
            select(ScrapedGroup).where(ScrapedGroup.tg_group_id == canonical)
        )
        return result.scalar_one_or_none()
```

**Hybrid search fallback:** If `embedding` is NULL for a row (not yet embedded), fall back to the SQL keyword query (confidence + type filter, limit 15). This ensures no rows are missed during backfill.

---

## AIPilotService Changes (`bot/plugins/ai_pilot/service.py`)

Same as Phase 1 — minimal:

```python
async def generate_reply(
    self, user_id: int, text: str, *, context_block: str = ""
) -> str | None:
```

When `context_block` is non-empty:
```python
system_prompt = self._system_prompt
if context_block:
    system_prompt = f"{system_prompt}\n\n{context_block}"
```

---

## Listener Changes (`bot/agents/listener.py`)

In `_handle_group_mention()`, after creating `AIPilotService`:

```python
from bot.plugins.ai_pilot.context import GroupContextService
from bot.plugins.ai_pilot.embeddings import EmbeddingService

try:
    embedder = EmbeddingService()
    ctx_svc = GroupContextService(session, embedder)
    context_block = await ctx_svc.build_context_block(chat_id, text)
except Exception:
    context_block = ""  # fallback to no context on error

reply = await ai_service.generate_reply(
    sender_id or chat_id, text, context_block=context_block
)
```

---

## Data Flow

```
1. User @mentions agent in group
2. _handle_group_mention() runs
3. EmbeddingService.embed(user_text) → 1536-dim vector
4. pgvector cosine similarity search:
   SELECT *, embedding <=> :query_vec AS distance
   FROM group_knowledge
   WHERE scraped_group_id = :id
     AND embedding IS NOT NULL
     AND confidence >= 0.5
     AND knowledge_type IN ('faq','topic','entity',...)
   ORDER BY distance ASC
   LIMIT 15
5. Format results into context_block markdown
6. AIPilotService.generate_reply(..., context_block=context_block)
7. LLM receives: [system prompt] + [context block] + [conversation history] + [user message]
8. Reply sent to Telegram
```

---

## Embedding Costs and Latency

| Operation | Cost (OpenAI text-embedding-3-small) | Latency |
|-----------|--------------------------------------|---------|
| Per query embed | $0.00000013 (128 tokens × $0.00002/1K tokens) | ~200ms |
| Batch backfill (20 entries) | ~$0.00002 | ~2s |
| Full backfill (10K entries) | ~$0.05 | ~15min |

The per-reply latency adds ~200ms for embedding the user's message. The pgvector search itself adds <10ms.

---

## Indexing Strategy

For the vector column, use **IVFFlat** with `lists = 100` (good for up to ~100K entries):

```sql
CREATE INDEX ix_group_knowledge_embedding
ON group_knowledge
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

- `lists = sqrt(n)` rule: for ~10K entries, lists = 100
- `vector_cosine_ops` enables `<=>` cosine distance operator
- Requires rebuilding (`REINDEX`) after significant data changes

For larger datasets (>100K), upgrade to **HNSW** index (faster, more accurate, higher build cost):

```sql
CREATE INDEX ix_group_knowledge_embedding_hnsw
ON group_knowledge
USING hnsw (embedding vector_cosine_ops);
```

---

## Files Changed

| File | Change |
|------|--------|
| `docker-compose.yml` | `postgres:16` → `pgvector/pgvector:pg16` |
| `requirements.txt` | Add `pgvector>=0.3.0` |
| `alembic/versions/` | New migration: CREATE EXTENSION vector + add embedding column |
| `bot/db/models/scraper.py` | Add `embedding: Vector(1536)` to `GroupKnowledge` |
| `bot/plugins/ai_pilot/embeddings.py` | **NEW** — `EmbeddingService` + `GroupKnowledgeEmbedder` |
| `bot/plugins/ai_pilot/context.py` | **NEW** — `GroupContextService` (semantic search) |
| `bot/plugins/ai_pilot/service.py` | Add `context_block` param to `generate_reply()` |
| `bot/agents/listener.py` | Inject context in `_handle_group_mention()` |
| `bot/services/knowledge_extractor.py` | Embed new entries on save (trigger) |

---

## Rollout

1. Switch postgres image, add pgvector to requirements, rebuild
2. Run migration: `CREATE EXTENSION vector`, add `embedding` column, create IVFFlat index
3. Create `EmbeddingService` + `GroupKnowledgeEmbedder`
4. Backfill existing `group_knowledge` entries (run once)
5. Create `GroupContextService` with semantic search
6. Modify `AIPilotService` to accept `context_block`
7. Modify listener to call context service on @mention
8. Hook into `KnowledgeExtractor._save_knowledge()` to embed new entries automatically
9. Test: @mention agent in a group with knowledge → verify context-aware reply
10. Test: @mention agent with no knowledge → verify unchanged behavior
11. Monitor: `ai_pilot_reply_generated` logs for latency

---

## Future: Hybrid Search

Combine semantic (pgvector) + keyword (SQL ILIKE on title/content) for better relevance:

```sql
SELECT * FROM (
  -- Semantic
  SELECT *, embedding <=> :query_vec AS distance, 1.0 AS keyword_score
  FROM group_knowledge WHERE scraped_group_id = :id AND embedding IS NOT NULL
  UNION ALL
  -- Keyword fallback for NULL-embedding rows
  SELECT *, 0 AS distance,
    ts_rank(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')), plainto_tsquery('simple', :query)) AS keyword_score
  FROM group_knowledge WHERE scraped_group_id = :id AND embedding IS NULL
) ORDER BY distance ASC, keyword_score DESC LIMIT 15;
```
