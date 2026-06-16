# Feature Specification: Product Documentation Hub & Landing Page

**Feature Branch**: `004-docs-landing-page`

**Created**: 2026-06-16

**Status**: Draft

**Input**: GitHub issue #54 — Create product documentation hub and landing page for humans and AI agents

## User Scenarios & Testing

### User Story 1 — New visitor discovers MadarBot through landing page (Priority: P1)

A community manager or Telegram group admin finds MadarBot via search or link. They land on the docs/landing page and immediately understand what the product does, its key features, and how to get started.

**Why this priority**: The landing page is the public face of the product. Without it, new users have no entry point to understand the product before authenticating.

**Independent Test**: Open `/docs` in a browser. Verify the hero section clearly communicates the value proposition, feature cards cover all major capabilities, and CTAs link to the WebApp and Getting Started guide.

**Acceptance Scenarios**:

1. **Given** a new visitor navigates to `/docs` **When** the page loads **Then** they see a hero section with product name, tagline, description, and launch CTA
2. **Given** the page is scrolled **When** the visitor views the features section **Then** all 6 core features are displayed with icons and descriptions
3. **Given** the visitor clicks "Launch WebApp" **When** the CTA is clicked **Then** they are redirected to `/webapp/agents`

---

### User Story 2 — Administrator reads documentation to learn a feature (Priority: P1)

An existing user wants to understand how bulk campaigns work. They navigate to the docs, browse the sidebar, and read the campaign documentation.

**Why this priority**: Documentation is the primary self-service support channel. Every feature must be documented.

**Independent Test**: Navigate to `/docs/campaigns` from the sidebar. Verify the page explains campaign creation, parameters, scheduling, and API endpoints with code examples.

**Acceptance Scenarios**:

1. **Given** the user is on the docs home page **When** they click "Bulk Campaigns" in the sidebar **Then** the campaigns documentation page loads
2. **Given** the user is reading a docs page **When** they view the API endpoints section **Then** endpoints are displayed with method badges, paths, and descriptions
3. **Given** the user is on mobile **When** they tap the hamburger menu **Then** the sidebar slides in from the left

---

### User Story 3 — AI agent discovers MCP tools via structured documentation (Priority: P2)

An AI agent (Claude, ChatGPT, Cursor) or a developer setting up an MCP client reads the structured documentation to understand available tools, their schemas, and how to authenticate.

**Why this priority**: MCP is a key differentiator. AI-targeted docs enable programmatic discovery and integration.

**Independent Test**: Navigate to `/docs/agents`. Verify JSON-LD structured data is present. Verify all 27 tools are listed with their input parameters. Navigate to `/docs/mcp` and verify the full MCP reference.

**Acceptance Scenarios**:

1. **Given** an AI agent fetches `/docs/agents` **When** it parses the page **Then** it finds JSON-LD structured data with application metadata and feature list
2. **Given** a developer visits `/docs/mcp` **When** they scroll through the tools **Then** all 8 tool categories and 27 tools are documented with their parameters
3. **Given** a developer wants auth info **When** they view the MCP page **Then** both scoped token and static token auth methods are explained with code examples

---

### User Story 4 — User finds answers via FAQ (Priority: P2)

A user has a common question about account limits or scraping. They go to the FAQ page and find the answer without contacting support.

**Why this priority**: FAQ reduces support burden and provides quick answers for common questions.

**Independent Test**: Navigate to `/docs/faq`. Verify common questions across General, Accounts, Scraping, Messaging, MCP/AI, and Billing categories are present with clear answers.

**Acceptance Scenarios**:

1. **Given** a user visits `/docs/faq` **When** they read the Accounts section **Then** questions about linked account limits and session expiry are answered
2. **Given** a user visits `/docs/faq` **When** they read the MCP section **Then** questions about setup, read-only mode, and capabilities are answered

---

### Edge Cases

- What happens when a docs route doesn't exist? — FastAPI returns 404 for unmatched `/docs/{path}` routes
- What happens on mobile screen sizes? — Sidebar collapses into a hamburger menu overlay
- What happens when visiting `/docs` without trailing slash? — Both `/docs` and `/docs/` routes are handled
- What happens with very long code blocks? — `<pre>` elements have `overflow-x: auto`
- What about RTL users (Arabic)? — The docs are currently English-only; Arabic translations are deferred
- What about search? — No search index is implemented in V1; browser Ctrl+F works for text search

## Requirements

### Functional Requirements

- **FR-001**: System MUST serve a landing page at `/docs` with hero section, feature highlights, and CTAs
- **FR-002**: System MUST serve documentation pages at `/docs/{section}` for: getting-started, accounts, groups, scraping, campaigns, automation, leads, analytics, subscription, mcp, agents, faq
- **FR-003**: System MUST provide a persistent sidebar navigation linking to all documentation sections
- **FR-004**: System MUST highlight the active page in the sidebar navigation
- **FR-005**: System MUST include SEO metadata (title, description, og:tags, canonical) on every docs page
- **FR-006**: System MUST render code snippets with monospace font and syntax-highlighted appearance
- **FR-007**: System MUST display API endpoints with method badges (GET/POST/PATCH/DELETE) and paths
- **FR-008**: System MUST document all 27 MCP tools across 8 functional areas with their parameters
- **FR-009**: System MUST include JSON-LD structured data on the AI agents docs page for machine readability
- **FR-010**: System MUST provide an FAQ page covering General, Accounts, Scraping, Messaging, MCP/AI, and Billing questions
- **FR-011**: System MUST be responsive — sidebar collapses to hamburger menu on mobile, content reflows
- **FR-012**: System MUST use the existing dark theme CSS variables matching the dashboard
- **FR-013**: System MUST NOT require authentication to access documentation pages
- **FR-014**: System MUST add documentation links to the dashboard SPA footer and miniapp footer

### Key Entities

- **Docs Page**: Standalone HTML page served by FastAPI at a `/docs/{section}` route, rendered with a shared template including sidebar navigation, SEO metadata, and content area
- **Docs Sidebar**: Persistent navigation panel listing all documentation sections with active-state highlighting
- **AI Agent Structured Data**: JSON-LD `<script>` block on the agents page describing the MCP server for programmatic consumption

## Success Criteria

- **SC-001**: All 14 documentation routes return 200 with valid HTML
- **SC-002**: Sidebar navigation is present on every docs page and highlights the active section
- **SC-003**: All 8 legal footer links plus a Docs link are visible in both the dashboard SPA and miniapp
- **SC-004**: Landing page hero communicates the product value proposition within 5 seconds of viewing
- **SC-005**: MCP tools documentation covers all 27 tools with correct parameter names and descriptions
- **SC-006**: The AI agents page contains valid JSON-LD structured data
- **SC-007**: Docs pages render correctly on viewport widths from 320px to 1920px
- **SC-008**: SEO metadata (title, description, og:title, og:description, canonical) is present on every page
- **SC-009**: Code blocks use monospace font and are scrollable on overflow

## Assumptions

- Docs are served as static-like HTML from FastAPI using the same pattern as legal pages (`bot/dashboard/api/routers/`)
- No client-side JavaScript framework is needed for docs — server-rendered HTML is sufficient for SEO and simplicity
- Docs content is primarily English; Arabic translations may be added later
- The docs sidebar links match the route names defined in the FastAPI router
- The nginx proxy at `madar.hamedco.com` routes all `/docs/*` paths to the FastAPI backend
- No database or authentication is required for docs pages
- This spec does not include a search feature or dynamic content loading
