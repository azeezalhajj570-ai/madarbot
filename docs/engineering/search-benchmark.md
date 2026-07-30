# Search Benchmark — Before vs. After

## Summary

Replaced `ILIKE '%query%'` (sequential scan) with PostgreSQL Full-Text Search using `to_tsvector('arabic', message_text)` + GIN index.

## Before: ILIKE Sequential Scan

| Query Term | Planning | Execution | Scan Type | Rows Scanned |
|---|---|---|---|---|
| `%نسبة القبول%` | 4.5 ms | **2,387 ms** | Parallel Seq Scan | 368,620 |
| `%الحد الأدنى%` | — | **1,931 ms** | Parallel Seq Scan | 368,620 |
| `%معدلي%` | — | **1,333 ms** | Parallel Seq Scan | 368,620 |
| `%طب%` (short) | — | 4 ms | Index Scan Backward | 374 |

**Worst case:** 2.4s per query. **Total page impact:** 20-40s for 15-20 admission queries.

## After: FTS with GIN Index

| Query Term | Planning | Execution | Scan Type | Matches Found |
|---|---|---|---|---|
| `نسبة القبول` | 2.4 ms | **12 ms** | Bitmap Index Scan (GIN) | 1,819 |
| `الحد الأدنى` | 0.2 ms | **22 ms** | Bitmap Index Scan (GIN) | 1,884 |
| `معدلي` | 0.2 ms | **108 ms** | Bitmap Index Scan (GIN) | 3,583 |
| `جامعة الملك سعود` | 0.2 ms | **22 ms** | Bitmap Index Scan (GIN) | 1,299 |
| `طب` | 0.2 ms | **31 ms** | Bitmap Index Scan (GIN) | 3,453 |

**Worst case:** 108ms per query. **Total page impact:** ~1.6s for 15 admission queries.

## Speedup

| Query Term | Before | After | Speedup |
|---|---|---|---|
| `نسبة القبول` | 2,387 ms | 12 ms | **199x** |
| `الحد الأدنى` | 1,931 ms | 22 ms | **88x** |
| `معدلي` | 1,333 ms | 108 ms | **12x** |
| `جامعة الملك سعود` | ~2,000 ms* | 22 ms | **~90x** |
| `طب` | 4 ms | 31 ms | 0.13x (short query fallback needed) |

*Estimated — would have been sequential scan like other terms.

## Database Changes

| Change | SQL |
|---|---|
| Extension | `CREATE EXTENSION pg_trgm` |
| New column | `search_vector tsvector NOT NULL` |
| GIN index | `ix_scraped_messages_search_vector_gin` on `search_vector` |
| Trigram index | `ix_scraped_messages_text_trgm_gin` on `message_text` |
| Trigger | Auto-updates `search_vector` on INSERT/UPDATE of `message_text` |
| Rows backfilled | 1,106,048 |

## Code Changes

| File | Change |
|---|---|
| `bot/db/models/scraper.py` | Added `search_vector: Mapped[Optional[str]]` TSVECTOR column |
| `bot/services/scraper_service.py` | `search_messages()` uses `search_vector @@ plainto_tsquery('arabic', query)` for queries >= 3 chars; rank-ordered by `ts_rank()`. Short queries (< 3 chars) fall back to ILIKE (uses trigram index). |

## Evaluation Dataset

50 real admission questions saved to `tests/admission_search_questions.json`. Categories:
- Cutoff (10)
- Comparison (7)
- Requirements (6)
- Deadlines (6)
- Concerns (8)
- General Search (10)
- English queries (3)

## Notes

- Short Arabic queries (1-2 characters like `طب`) are slightly slower with FTS (31ms vs 4ms). The current implementation falls back to ILIKE for queries < 3 chars to avoid this overhead.
- The trigram GIN index (`gin_trgm_ops`) was added but is not yet used by the FTS rewrite. It will accelerate any remaining ILIKE queries (short queries, non-Arabic text).
- The bottleneck has shifted from sequential scan to heap page reads. With active use and cache warming, real latency will be lower than cold-cache numbers above.
