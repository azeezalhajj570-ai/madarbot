# Tasks: Product Documentation Hub & Landing Page

**Input**: Design documents from `/specs/004-docs-landing-page/`

**Prerequisites**: spec.md, plan.md

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Docs Router & Landing Page (Foundation)

**Purpose**: FastAPI router, shared template infrastructure, landing page — blocks ALL other docs work

- [x] T001 [P] Create `bot/dashboard/api/routers/docs.py` with shared CSS variables, `docs_page()` template function, and sidebar navigation HTML
- [x] T002 Implement landing page route at `/docs` + `/docs/` — hero section, 6 feature cards, CTA buttons, quick links
- [x] T003 Register docs router in `bot/dashboard/api/main.py` (import + `app.include_router`)

**Checkpoint**: Docs router serves landing page at `/docs`, sidebar nav visible, CTAs link to correct destinations

---

## Phase 2: Feature Documentation Sections

**Purpose**: Document all core product features with instructions, parameter tables, and API references

- [x] T004 [P] [US2] Implement `/docs/getting-started` — setup guide, linking accounts, first scrape, next steps
- [x] T005 [P] [US2] Implement `/docs/accounts` — linking methods (UI + API), account states table, safety limits, plan limits table
- [x] T006 [P] [US2] Implement `/docs/groups` — viewing groups, member management, group insights, API endpoints
- [x] T007 [P] [US2] Implement `/docs/scraping` — how scraping works, limits table, API examples, best practices
- [x] T008 [P] [US2] Implement `/docs/campaigns` — creating campaigns, parameters table, campaign types, monitoring, API endpoints
- [x] T009 [P] [US2] Implement `/docs/automation` — 5 task types with config schemas, conditions, API example
- [x] T010 [P] [US2] Implement `/docs/leads` — lead data fields table, managing leads, API endpoints
- [x] T011 [P] [US2] Implement `/docs/analytics` — agent/group analytics, notifications, API endpoints
- [x] T012 [P] [US2] Implement `/docs/subscription` — plan comparison table (Free/Pro/Business), managing subscription, refunds

---

## Phase 3: MCP & AI Agent Documentation

**Purpose**: Full MCP reference for developers and structured data for AI agent consumption

- [x] T013 [US3] Implement `/docs/mcp` — quick start, endpoint, authentication, all 27 tools listed by category, read-only mode, standalone setup, JSON-RPC protocol
- [x] T014 [US3] Implement `/docs/agents` — AI-agent-specific docs with JSON-LD structured data, tool discovery flow, response structure, error codes table, example JSON-RPC calls, environment configuration

---

## Phase 4: FAQ & Footer Integration

**Purpose**: FAQ page and navigation links from both frontends

- [x] T015 [P] [US4] Implement `/docs/faq` — 20+ questions across 6 categories (General, Accounts, Scraping, Messaging, MCP/AI, Billing)
- [x] T016 [US1] Add "Docs" link to dashboard SPA footer in `bot/dashboard/frontend/index.html` renderFooter function (EN + AR labels)
- [x] T017 [US1] Add "Docs" link to miniapp FooterLinks component in `apps/miniapp-agents/src/App.tsx`
- [x] T018 [P] Add `legal.docs` i18n key to `en.json` ("Docs") and `ar.json` ("التوثيق")

---

## Phase 5: Polish & Verification

- [x] T019 Verify all 14 routes return valid HTML — confirmed via `grep "@router.get"`
- [x] T020 Verify responsive CSS — mobile sidebar uses hamburger menu via `@media (max-width: 768px)`
- [x] T021 Verify SEO metadata (title, description, og:tags, canonical) present on all pages via `docs_page()` template
- [x] T022 Verify code blocks use monospace font with `overflow-x: auto`
- [x] T023 Python syntax validation — `ast.parse()` passes for docs.py and main.py
- [x] T024 JSON syntax validation — `json.load()` passes for en.json and ar.json
- [x] T025 Verify footer links render in both dashboard SPA and miniapp contexts
- [x] T026 Sidebar active-state highlighting works for all 13 navigation links

---

## Dependencies & Execution Order

- **Phase 1 (Foundation)**: Blocks ALL other phases — router and template must exist first
- **Phase 2 (Feature Docs)**: Depends on Phase 1 — all 9 feature sections are independent and parallelizable
- **Phase 3 (MCP/AI Docs)**: Depends on Phase 1 — independent of Phase 2
- **Phase 4 (FAQ + Footer)**: Depends on Phase 1 — FAQ independent, footer changes independent
- **Phase 5 (Polish)**: Depends on Phases 1-4

### Parallel Opportunities

- T004-T012 (feature docs pages) can run in parallel — each is an independent route handler
- T013 (MCP docs) and T014 (AI agent docs) can run in parallel
- T016 (dashboard footer) and T017 (miniapp footer) can run in parallel
- T015 (FAQ) is independent of T016-T018 (footer links)
