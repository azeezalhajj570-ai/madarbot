# RAG-Powered AI Reply for Agent Messages (pgvector + HNSW)

## Problem

When an agent receives a mention in a group, the AI Pilot replies using only conversation history (Redis). It has no knowledge of the group's context — FAQ entries, past decisions, extracted topics, or known entities stored in `group_knowledge`. Replies are generic and ignore the group's established knowledge base.

## Solution

Use **pgvector** for semantic search over `group_knowledge` entries. On each @mention, embed the user's message, find the top-K most semantically similar knowledge entries via cosine similarity with an **HNSW index**, and inject them into the AI Pilot's system prompt.

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
      │ pgvector HNSW    │   │ LLM Provider     │
      │ (cosine sim,     │   │ (chat completion) │
      │  top-K = 15 →    │   └──────────────────┘
      │  token-capped)   │
      └─────────────────┘
               │
               ▼
      ┌─────────────────┐
      │ group_knowledge  │
      │ (+ embedding     │
      │  column, HNSW    │
      │  index)          │
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

**Alembic migration (step 1 — schema only, no ANN index yet):**

```python
def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
```

### 2. Python Dependency

Add to `requirements.txt`:

```
pgvector>=0.5.0
```

Source: https://github.com/pgvector/pgvector-python

HNSW index support was added in pgvector 0.5.0. Also provides SQLAlchemy `Vector` type.

---

## Data Model Changes

### `group_knowledge` Table — Add `embedding` Column

```python
from pgvector.sqlalchemy import Vector

class GroupKnowledge(Base):
    __tablename__ = "group_knowledge"
    # ...existing columns...

    embedding: Mapped[Optional[list[float]]] = mapped_column(
        Vector(512), nullable=True
    )
```

- `Vector(512)` — using 512 dimensions instead of 1536 via OpenAI's `dimensions` param. Cuts storage 3x, index builds faster, and `text-embedding-3-small` supports truncated embeddings with minimal recall loss.
- No column index — the HNSW index is created after backfill (step 4), not in the schema migration.

**Alembic migration (step 1):**

```python
from pgvector.sqlalchemy import Vector

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("group_knowledge", sa.Column("embedding", Vector(512), nullable=True))
```

**HNSW index is created separately after backfill (step 4):**

```sql
-- Run AFTER backfilling all embeddings
CREATE INDEX ix_group_knowledge_embedding_hnsw
ON group_knowledge
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);
```

- `m = 16` — default, good balance of recall vs. index size
- `ef_construction = 200` — higher = better recall but slower build
- Doesn't need representative training data — unlike IVFFlat, HNSW builds well on empty or partial data
- Supports incremental inserts without index degradation

Source: https://github.com/pgvector/pgvector?tab=readme-ov-file#hnsw

---

## Group Isolation

The vector search is scoped to a single group's knowledge entries. Without this, cross-group knowledge leaks into replies.

```sql
SELECT *, embedding <=> :query_vec AS distance
FROM group_knowledge
WHERE scraped_group_id = :group_internal_id       -- ← hard filter by group
  AND embedding IS NOT NULL
  AND confidence >= 0.5
  AND knowledge_type IN ('faq','topic','entity','decision','consensus')
ORDER BY distance ASC
LIMIT 15
```

**Performance note:** ANN indexes (HNSW included) don't combine cleanly with hard pre-filters. PostgreSQL can either:
- Scan the index (fast) then filter → may return fewer than 15 rows if the filtered set is small
- Scan all rows that match the filter then sort by distance (slow on large per-group tables)

This is acceptable for the expected scale:
- Each group typically has 50–500 knowledge entries
- HNSW with a small filtered set still beats brute-force
- If any single group exceeds 10K entries, consider partitioning `group_knowledge` by `scraped_group_id` using declarative partitioning to make the filter truly prune partitions

---

## Token Budget for Context Injection

Rather than a hard limit of 15 entries, cap by estimated token budget:

```python
MAX_CONTEXT_TOKENS = 1500  # roughly 1125 words

def format_context_block(entries: list[tuple[GroupKnowledge, float]]) -> str:
    lines = [f"## Group Context: {group_title}"]
    lines.append("")
    lines.append("The following information has been extracted from this group's messages:")

    token_estimate = 0
    for entry, distance in entries:
        addition = f"- [{entry.knowledge_type}] {entry.title}"
        if entry.content:
            addition += f"\n  {entry.content[:200]}"

        entry_tokens = len(addition) // 4  # rough char→token
        if token_estimate + entry_tokens > MAX_CONTEXT_TOKENS:
            break

        lines.append(addition)
        token_estimate += entry_tokens

    return "\n".join(lines)
```

If multiple entries are near-duplicates (e.g. three FAQ variants asking the same thing), the LLM will deduplicate them naturally given the context block — MMR reranking isn't needed at this scale.

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
            dimensions=512,
        )
        return resp.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.embeddings.create(
            model=self._model,
            input=texts,
            dimensions=512,
        )
        return [d.embedding for d in resp.data]
```

Source: https://platform.openai.com/docs/guides/embeddings#use-cases

The `dimensions=512` param is supported by `text-embedding-3-small` and newer models. It returns a truncated embedding that preserves more information than a naive slice of a 1536-dim vector.

### 2. `GroupKnowledgeEmbedder` (new: `bot/plugins/ai_pilot/embeddings.py`)

Same as previous spec — backfills existing entries and hooks into `KnowledgeExtractor._save_knowledge()` for incremental embedding.

### 3. `GroupContextService` — Semantic Retrieval (new: `bot/plugins/ai_pilot/context.py`)

Uses the token-budgeted context builder. Falls back to empty string on ANY error (embedding timeout, DB connection, etc.) — never blocks the reply.

```python
class GroupContextService:
    def __init__(self, session: AsyncSession, embedder: EmbeddingService):
        self._session = session
        self._embedder = embedder

    async def build_context_block(self, tg_group_id: int, query: str) -> str:
        try:
            group = await self._get_group(tg_group_id)
            if group is None:
                return ""

            query_emb = await self._embedder.embed(query)

            rows = await self._semantic_search(group.id, query_emb)
            if not rows:
                return ""

            return self._format_context(group.title or str(tg_group_id), rows)
        except Exception:
            return ""  # always fail soft — don't block replies

    async def _semantic_search(
        self, scraped_group_id: int, query_emb: list[float]
    ) -> list[tuple[GroupKnowledge, float]]:
        stmt = (
            select(GroupKnowledge, GroupKnowledge.embedding.cosine_distance(query_emb).label("dist"))
            .where(
                GroupKnowledge.scraped_group_id == scraped_group_id,
                GroupKnowledge.embedding.isnot(None),
                GroupKnowledge.confidence >= 0.5,
                GroupKnowledge.knowledge_type.in_(("faq", "topic", "entity", "decision", "consensus")),
            )
            .order_by("dist")
            .limit(15)
        )
        result = await self._session.execute(stmt)
        return [(row, dist) for row, dist in result.all()]
```

---

## AIPilotService Changes

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

## Listener Changes

In `_handle_group_mention()`, after creating `AIPilotService`:

```python
try:
    embedder = EmbeddingService()
    ctx_svc = GroupContextService(session, embedder)
    context_block = await ctx_svc.build_context_block(chat_id, text)
except Exception:
    context_block = ""  # always fail soft — don't block the reply

reply = await ai_service.generate_reply(
    sender_id or chat_id, text, context_block=context_block
)
```

---

## Data Flow

```
1. User @mentions agent in group
2. _handle_group_mention() runs
3. EmbeddingService.embed(user_text, dimensions=512) → 512-dim vector
4. pgvector HNSW cosine similarity search (scoped to scraped_group_id):
   SELECT *, embedding <=> :query_vec AS distance
   FROM group_knowledge
   WHERE scraped_group_id = :id AND embedding IS NOT NULL
     AND confidence >= 0.5
     AND knowledge_type IN ('faq','topic','entity',...)
   ORDER BY distance ASC
   LIMIT 15
5. Format into context_block (capped at ~1500 tokens)
6. AIPilotService.generate_reply(..., context_block=context_block)
7. LLM receives: [system prompt] + [context block] + [history] + [user message]
8. Reply sent to Telegram
```

---

## Embedding Costs and Latency (512-dim)

| Operation | Cost | Latency |
|-----------|------|---------|
| Per query embed | ~$0.00000006 (64 tokens × $0.00002/1K) | ~150ms |
| Batch backfill (20 entries) | ~$0.00001 | ~1.5s |
| Full backfill (10K entries) | ~$0.025 | ~10min |

512-dim halves storage and index size vs 1536, with minimal recall loss for a small knowledge base.

---

## Rollout Order

```
Step 1: Infra
  ├── Switch postgres image → pgvector/pgvector:pg16
  ├── Add pgvector>=0.5.0 to requirements.txt
  └── Rebuild + deploy (docker compose up -d postgres)

Step 2: Schema migration (no index yet)
  ├── alembic revision: CREATE EXTENSION vector
  └── alembic revision: ADD COLUMN embedding Vector(512) NULL

Step 3: Code
  ├── Create EmbeddingService
  ├── Create GroupKnowledgeEmbedder
  ├── Create GroupContextService (with token budget)
  ├── Modify AIPilotService (context_block param)
  └── Deploy code (backfill still pending, so service returns "" → no behavior change)

Step 4: Backfill
  ├── Run GroupKnowledgeEmbedder.backfill() via management command or one-off
  └── This requires EmbeddingService to be deployed (step 3)

Step 5: HNSW index
  ├── CREATE INDEX ix_group_knowledge_embedding_hnsw USING hnsw (...)
  ├── Builds on the now-populated embedding column
  ├── Run after backfill so the index is trained on actual data
  └── m = 16, ef_construction = 200

Step 6: Wire into AgentListener
  ├── Modify _handle_group_mention() to call GroupContextService
  └── Deploy

Step 7: Test
  ├── @mention agent in group WITH knowledge → verify context-aware reply
  ├── @mention agent in group WITHOUT knowledge → verify unchanged behavior
  ├── Simulate OpenAI embed timeout → verify reply still goes through (no context)
  └── Monitor ai_pilot_reply_generated logs for latency shift

Step 8: Hook KnowledgeExtractor._save_knowledge()
  └── New entries get embedded immediately on creation
```

---

## Files Changed

| File | Change |
|------|--------|
| `docker-compose.yml` | `postgres:16` → `pgvector/pgvector:pg16` |
| `requirements.txt` | Add `pgvector>=0.5.0` |
| `alembic/versions/` | 2 migrations: CREATE EXTENSION vector + add embedding column |
| `bot/db/models/scraper.py` | Add `embedding: Vector(512)` to `GroupKnowledge` |
| `bot/plugins/ai_pilot/embeddings.py` | **NEW** — `EmbeddingService` + `GroupKnowledgeEmbedder` |
| `bot/plugins/ai_pilot/context.py` | **NEW** — `GroupContextService` (semantic HNSW search, token-budgeted) |
| `bot/plugins/ai_pilot/service.py` | Add `context_block` param to `generate_reply()` |
| `bot/agents/listener.py` | Inject context in `_handle_group_mention()` (fail soft) |
| `bot/services/knowledge_extractor.py` | Embed new entries on save |

---

## Future

**1. Partitioning by group:** If any single group exceeds 10K knowledge entries, partition `group_knowledge` by `scraped_group_id`:
```sql
CREATE TABLE group_knowledge (...) PARTITION BY HASH (scraped_group_id);
```
This makes the `WHERE scraped_group_id = :id` filter prune partitions, so HNSW scans only the relevant partition.

**2. Hybrid search:** Combine semantic + keyword for better coverage during backfill:
- pgvector handles the semantic path
- `to_tsvector` + `plainto_tsquery` handles keyword path for NULL-embedding rows
- Union both results, weighted or deduplicated

**3. MMR reranking:** If token budget becomes tight with diverse results, add Maximal Marginal Relevance to deduplicate similar entries before injection.
