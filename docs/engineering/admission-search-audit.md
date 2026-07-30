# Admission Search Audit

## Overview

Date: 2026-07-30
Database: `combot` on PostgreSQL 16 + pgvector 0.8.5
Table: `scraped_messages` — 1,106,048 rows

## Search Callers

| # | Service | File | Queries per Request | Page Size |
|---|---|---|---|---|
| 1 | `AdmissionSearchService.search()` | `admission_search_service.py:49` | 1 | 100 |
| 2 | `CutoffAnalyzer.analyze()` | `cutoff_analyzer.py:52` | 4 (1 per term) | 50 |
| 3 | `ConcernAnalyzer.analyze()` | `concern_analyzer.py:36` | 11 (3-4 per topic) | 20 |
| 4 | `AdmissionOverviewService._get_trending_universities()` | `admission_overview_service.py:315` | N terms × N groups | 50 |
| 5 | `AdmissionOverviewService.extract_admission_leads()` | `admission_overview_service.py:202` | N signals × N groups | 30 |

**Estimated total sequential scans per page load:** 15-25 queries

## Current SQL Pattern

All queries flow through `ScraperService.search_messages()` at `scraper_service.py:1246`:

```sql
SELECT *
FROM scraped_messages
WHERE tg_group_id = :gid
  AND message_text ILIKE '%query%'
ORDER BY message_date DESC
LIMIT :limit
```

Plus a `COUNT(*)` with the same filters.

## Existing Indexes (on `scraped_messages`)

| Index | Type | Columns |
|---|---|---|
| `scraped_messages_pkey` | UNIQUE BTREE | `id` |
| `ix_scraped_messages_tg_group_id` | BTREE | `tg_group_id` |
| `ix_scraped_messages_message_id` | UNIQUE BTREE | `tg_group_id, message_id` |
| `ix_scraped_messages_sender_id` | BTREE | `sender_user_id` |
| `ix_scraped_messages_date` | BTREE | `message_date` |

**No index on `message_text`.** No `pg_trgm` extension. No `tsvector` column. No GIN index.

## Baseline Performance

All queries against group `-1001499967735`. Measured with `EXPLAIN ANALYZE`.

| Query Term | Plan Type | Execution Time |
|---|---|---|
| `%نسبة القبول%` (cutoff term) | Parallel Seq Scan | **2,387 ms** |
| `%الحد الأدنى%` (cutoff term) | Parallel Seq Scan | **1,931 ms** |
| `%معدلي%` (concern term) | Parallel Seq Scan | **1,333 ms** |
| `%طب%` (short, selective) | Index Scan Backward (date) | 4 ms |

**Worst case:** 2.4s per query. **Total page impact:** 20-50s for all admission queries to complete.

## Available Extensions

| Extension | Version | Status |
|---|---|---|
| `plpgsql` | 1.0 | ✅ Installed |
| `vector` | 0.8.5 | ✅ Installed |
| `pg_trgm` | — | ❌ Not installed |

## Recommendations

1. **Enable `pg_trgm`** — GIN trigram index for Arabic fuzzy matching (handles spelling variants)
2. **Add `tsvector` column** — pre-computed search vector for full-text search
3. **Add GIN index** on `search_vector` — for `@@ tsquery` matching
4. **Add GIN index** with `gin_trgm_ops` — for fast `ILIKE` fallback on short/non-standard terms
5. **Rewrite `search_messages()`** — use `plainto_tsquery('arabic', query)` + `ts_rank()` instead of `ILIKE`
6. **Benchmark** — compare before/after on the same real admission questions
