# Admission Overview Dashboard — Aggregate Data Research

## Data Sources Available

| Source | Table | What It Has | Use Case |
|--------|-------|-------------|----------|
| Daily summaries | `scraped_daily_summaries` | Per-group daily message count, active users, top topics | Volume metrics, activity charts |
| Group knowledge | `group_knowledge` | AI-extracted entities, trends, topics per group | Trending topics, entity mentions |
| Scraped messages | `scraped_messages` | Full message text with sender info and dates | Raw admission keyword search |
| Scraped groups | `scraped_groups` | Group metadata (title, member count, type) | Group classification, admission group detection |
| Scraped leads | `scraped_leads` | Extracted leads from messages | Lead volume (future) |

## Key Constraint

All current admission operations are **single-group** — every endpoint requires `tg_group_id`. The overview dashboard needs **cross-group aggregation** to show trending universities and hot topics at a glance.

## Proposed Endpoints

### 1. `GET /api/admissions/overview`

The main overview snapshot. Lightweight, cacheable, returns everything needed for the top section of the dashboard.

```json
{
  "stats": {
    "total_messages_today": 1240,
    "messages_this_week": 8450,
    "active_groups": 5,
    "groups_being_monitored": 8
  },
  "trending_universities": [
    {"name": "جامعة القاهرة", "mention_count_7d": 340, "mention_count_1d": 82, "trend": "rising"},
    {"name": "جامعة عين شمس", "mention_count_7d": 210, "mention_count_1d": 35, "trend": "stable"}
  ],
  "hot_topics": [
    {"topic": "نسبة القبول", "mention_count": 520, "trend": "rising"},
    {"topic": "التسجيل", "mention_count": 380, "trend": "stable"}
  ],
  "last_updated": "2026-07-29T10:30:00Z"
}
```

**Implementation strategy (2 options):**

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A — Pre-computed** | Background job scans messages hourly, extracts university mentions by keyword, stores counts in Redis or a new `admission_trending` table | Fast reads, no heavy queries | Needs new table + job, university list must be maintained |
| **B — On-demand + cache** | First request triggers aggregation queries across groups, cached in Redis (TTL: 10 min) | No schema changes, always fresh-ish | First request is slow (ILIVE scans), cache stampede risk |

**Recommendation: Option B for MVP, graduate to Option A if data volume grows.**

**Query design (Option B):**
- Trending universities: search `scraped_messages.message_text` for known university name patterns (`جامعة`, `University of`) grouped by group, count per time window
- Hot topics: query `group_knowledge` where `knowledge_type IN ('topic', 'trend')` and `last_updated > 7 days ago`
- Volume: query `scraped_daily_summaries` with `date > now - 7d`, sum `message_count`

### 2. `GET /api/admissions/trending-universities`

Heavier endpoint for drill-down when user clicks "trending universities" card.

```json
{
  "universities": [
    {
      "name": "جامعة القاهرة",
      "mention_count_7d": 340,
      "mention_count_30d": 1250,
      "daily_counts": [
        {"date": "2026-07-22", "count": 45},
        {"date": "2026-07-23", "count": 52}
      ]
    }
  ],
  "method": "keyword_match",
  "cached_until": "2026-07-29T11:00:00Z"
}
```

### 3. `GET /api/admissions/activity`

Lightweight endpoint for the message activity chart (sparkline).

```json
{
  "daily": [
    {"date": "2026-07-22", "message_count": 450, "active_users": 38},
    {"date": "2026-07-23", "message_count": 520, "active_users": 42}
  ]
}
```

Implementation: Straightforward query of `scraped_daily_summaries` for admission-related groups.

## Which Groups Are "Admission-Related"?

Current frontend filter (from `AdmissionIntelligencePage.tsx`):
```typescript
g.title?.includes('قبول') || g.title?.includes('admission') || g.title?.includes('جامعة')
```

This should be extracted to a backend helper so the API can filter groups server-side.

## Caching Strategy

Use Redis (already available via `settings.redis_url`):
- **Overview**: TTL 10 min
- **Trending universities**: TTL 15 min
- **Activity**: TTL 30 min (daily data doesn't change fast)

Cache key pattern: `admission:overview:{lang}`, `admission:trending:{lang}`, `admission:activity`

## Query Complexity Estimates

| Query | Table | Scan Type | Complexity |
|-------|-------|-----------|------------|
| Daily message volume | `scraped_daily_summaries` | Index scan by date | Fast (indexed) |
| University mentions (7d) | `scraped_messages` | Sequential scan + ILIKE | **Slow** on large datasets (no full-text index) |
| Hot topics | `group_knowledge` | Index scan by type | Fast (indexed) |
| Active groups | `scraped_daily_summaries` | Distinct count on group | Fast (indexed) |

**University mention detection is the bottleneck** — it requires text pattern matching. For MVP scale it's acceptable, but for production with millions of messages, a full-text search index (`GIN` on `tsvector`) or pre-computation is recommended.

## Next Step After Implementation

Once the backend endpoints exist, ticket #166 (dashboard layout prototype) can proceed — the frontend will consume these endpoints to render:
- Stats bar (4 metric cards)
- Trending universities list
- Hot topics cards
- Activity sparkline chart
- AI query bar below the overview
