# Implementation Plan: Product Documentation Hub & Landing Page

**Branch**: `feat/issue-44-legal-pages` | **Date**: 2026-06-16 | **Spec**: `specs/004-docs-landing-page/spec.md`

**Input**: Feature specification from specs/004-docs-landing-page/spec.md + GitHub issue #54

## Summary

Add a comprehensive documentation hub and landing page to MadarBot, served as server-rendered HTML pages via FastAPI. Covers product overview, 11 feature documentation sections, full MCP tool reference, AI-agent-targeted structured data, FAQ, and footer navigation links across both the dashboard SPA and miniapp React SPA.

## Technical Context

**Language/Version**: Python 3.11 (FastAPI), TypeScript 5.5 (miniapp), vanilla JavaScript (dashboard SPA)

**Primary Dependencies**: FastAPI, Pydantic (existing); no new dependencies required

**Storage**: None — all docs content is static/inline

**Testing**: Manual browser verification + Python syntax check (`ast.parse`)

**Target Platform**: Web (desktop + mobile) served via nginx → FastAPI

**Project Type**: Server-rendered HTML pages + SPA footer integration

**Constraints**: Must match existing dark theme design system; no client-side JS framework for docs pages; no authentication required; SEO-friendly

**Scale/Scope**: 14 docs routes, ~11 documentation sections, 27 MCP tools documented, 2 frontend footer integrations

## Constitution Check

No constitution violations. This feature adds server-rendered HTML pages served by FastAPI and adds footer links to existing SPAs. No database changes, no API contract changes, no breaking changes to existing routes.

## Project Structure

```
bot/dashboard/api/routers/
└── docs.py                        # NEW — FastAPI router with all /docs routes
specs/004-docs-landing-page/
├── spec.md                        # NEW — Feature specification
├── plan.md                        # NEW — This file
└── tasks.md                       # NEW — Task breakdown

Modified files (no new directories):
bot/dashboard/api/main.py           # Import + register docs_router
bot/dashboard/frontend/index.html   # Add Docs link to footer
apps/miniapp-agents/src/App.tsx     # Add Docs link to FooterLinks
apps/miniapp-agents/src/i18n/locales/en.json  # Add legal.docs key
apps/miniapp-agents/src/i18n/locales/ar.json  # Add legal.docs key
```

**Structure Decision**: Follow the same pattern as `legal.py` (issue #44) — a single FastAPI router module with inline route handlers that return `docs_page()` with a shared HTML template. This avoids multiple files and keeps all docs content centralized. The template function handles sidebar rendering, SEO metadata, and responsive CSS.

## Phases

### Phase 1: Docs Router & Landing Page (Foundation)
- Create `bot/dashboard/api/routers/docs.py` with shared CSS, template function, and sidebar nav
- Implement landing page at `/docs` with hero, feature cards, CTAs
- Register router in `bot/dashboard/api/main.py`
- Verify all routes return valid HTML and sidebar nav works

### Phase 2: Feature Documentation Sections
- Implement all 10 feature docs routes:
  - Getting Started, Accounts, Groups, Scraping, Campaigns, Automation, Leads, Analytics, Subscription
- Each section includes: feature overview, step-by-step instructions, parameter tables, API endpoint references, code examples
- Subscription section includes plan comparison table

### Phase 3: MCP & AI Agent Docs
- Implement `/docs/mcp` — full MCP server reference with all 27 tools across 8 categories
- Implement `/docs/agents` — AI-agent-specific docs with JSON-LD structured data, error codes, example JSON-RPC calls, environment configuration
- Document authentication flow (scoped tokens + static token)
- Include tool discovery flow and response structure

### Phase 4: FAQ & Footer Integration
- Implement `/docs/faq` with 20+ questions across 6 categories
- Add "Docs" link to dashboard SPA footer (`bot/dashboard/frontend/index.html`)
- Add "Docs" link to miniapp footer (`apps/miniapp-agents/src/App.tsx`)
- Add `legal.docs` i18n keys to en.json and ar.json

### Phase 5: Polish & Verification
- Verify all 14 routes return 200 with valid HTML
- Verify responsive behavior on mobile viewports (sidebar → hamburger menu)
- Verify SEO metadata on all pages
- Verify footer links work in both SPAs
- Python syntax validation
- JSON syntax validation for i18n files
