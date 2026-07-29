# Spec: Dark Mode, RTL, & Translation for Browser Dashboard

## Objective

Add dark mode support, fix RTL layout issues, and complete Arabic translation for the admin dashboard SPA at `dashboard/`. The dashboard is used by a global audience — users must be able to work in their preferred theme (light/dark/system), read properly in Arabic (RTL), and see all UI text in their language.

## Tech Stack

- **Framework**: React 18, TypeScript 5.5
- **Routing**: react-router-dom 6
- **State/Data**: @tanstack/react-query 5
- **Styling**: CSS custom properties + inline styles (no Tailwind utility classes)
- **Components**: Custom primitives (no UI library), Radix UI (Dialog, DropdownMenu, Switch, Tabs), @tremor/react (charts)
- **Icons**: lucide-react
- **Build**: Vite 5
- **Test**: Vitest 2 + jsdom + @testing-library/react 16
- **i18n**: Custom React context (no i18next)

## Commands

All commands run from `dashboard/`:

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start dev server on port 5174 |
| `npm run build` | `tsc && vite build` — full type-check + production build |
| `npm test` | `vitest run` — single run |
| `npm run test:watch` | `vitest` — watch mode |
| `npm run preview` | `vite preview` — serve built output |

## Project Structure

```
dashboard/
├── index.html                           # SPA entry HTML
├── package.json
├── tsconfig.json
├── vite.config.ts                       # Vite config (base: /dashboard/)
├── vitest.config.ts                     # Vitest config (jsdom, @/ alias)
└── src/
    ├── main.tsx                         # React entry point
    ├── App.tsx                          # Root component (QueryClient, Router, routes)
    ├── index.css                        # ALL CSS (CSS vars, layout classes, animations)
    ├── components/
    │   ├── Layout.tsx                   # App shell: sidebar + mobile nav + content
    │   ├── Sidebar.tsx                  # Navigation sidebar
    │   └── ui/
    │       ├── primitives.tsx           # ~50 reusable UI components (Button, Card, Input, etc.)
    │       └── toast.tsx                # Toast notification system
    ├── lib/
    │   ├── api.ts                       # Axios API client
    │   ├── auth.ts                      # Auth helpers (storeAuth, getToken)
    │   ├── i18n.tsx                     # Custom i18n context (en/ar, useI18n, t())
    │   ├── page-shell.tsx               # Page wrapper: Header + Breadcrumb + Loading
    │   ├── types.ts                     # Shared TypeScript types
    │   └── use-dashboard-groups.ts      # Hook: group list query
    ├── pages/                           # ~25 page components
    │   ├── agents/                      # Agents CRUD pages
    │   ├── admin/                       # Admin panel pages
    │   └── *.tsx                        # Top-level pages (Dashboard, Settings, etc.)
    └── test/
        ├── setup.ts                     # Test setup (@testing-library/jest-dom)
        ├── LoginPage.test.tsx           # Login page smoke tests
        └── api.test.ts                  # API client tests

shared/ui-system/
└── tokens.ts                            # JS wrappers for --ui-* CSS vars (uiVars, spacing, radius)
```

## Current State

- **Dark mode**: absent — 24 `--ui-*` CSS vars defined only on `:root`
- **RTL**: partial — `dir` attribute switches to `rtl` for Arabic, but ~50+ inline styles use hardcoded `left`/`right`, `marginLeft`/`marginRight`, `paddingLeft`/`paddingRight`
- **Translation**: custom i18n context with `en`/`ar` dictionaries (~200 keys); many page components still use hardcoded English strings

## Code Style

All styling uses CSS custom properties via `uiVars` from `shared/ui-system/tokens.ts`. No Tailwind utility classes, no CSS modules, no styled-components.

```tsx
// ✅ Good — uses CSS vars, all colors via tokens
<button
  style={{
    background: uiVars.primary,
    color: uiVars.primaryText,
    borderRadius: radius.md,
    paddingInline: spacing.lg,
  }}
>
  {label}
</button>

// ❌ Bad — hardcoded color, no token
<button style={{ background: '#1a6b74', color: '#fff' }} />

// ✅ Good — logical properties for RTL
<div style={{ marginInlineStart: 12 }} />

// ❌ Bad — directional property
<div style={{ marginLeft: 12 }} />
```

Naming conventions:
- CSS vars: `--ui-{token}` (kebab-case)
- JS tokens: `uiVars.{token}` (camelCase)
- Translation keys: `page.{PageName}.{section}.{element}`
- Components: PascalCase files
- Utilities: camelCase files

## Testing Strategy

| Layer | Tool | Location | What to test |
|-------|------|----------|-------------|
| Unit | Vitest + jsdom | `src/test/*.test.tsx` | Component rendering, hook logic |
| Integration | Vitest + jsdom | `src/test/*.test.tsx` | Page-level behavior, form interactions |
| Types | `tsc` | — | Full type-check on build |

- No coverage threshold currently
- Theme context should get unit tests (renders children, toggles theme, persists to localStorage)
- i18n changes: test that `t()` returns correct string for both `en` and `ar`
- Do NOT need visual regression tests for this work
- Run `npm test` after each phase

## Boundaries

### Always do
- Reference colors via CSS vars (`uiVars.*`), never hardcode hex/rgba
- Use logical CSS properties (`marginInlineStart` not `marginLeft`, `paddingInline` not `paddingLeft`)
- Wrap every user-visible string in `t('key')`
- Add both `en` and `ar` entries for every new translation key
- Run `npm run build` to verify type-check before committing
- Run `npm test` to verify no regressions

### Ask first
- Adding new dependencies
- Changing the translation key naming convention
- Refactoring the i18n context API (`useI18n`, `t()` signature)
- Changing the CSS variable naming convention (`--ui-*`)
- Adding CSS files beyond `index.css`

### Never do
- Hardcode directional CSS properties (`left`, `right`, `marginLeft`, `marginRight`, `paddingLeft`, `paddingRight`)
- Hardcode color values in components
- Remove translation keys that are used elsewhere
- Change `index.html` structure (lang/dir attributes are managed by i18n context)
- Commit with TypeScript errors

---

## Phase 1 — Dark Mode

### 1.1 Theme Context

Create `dashboard/src/lib/theme.tsx`:

```tsx
type Theme = 'light' | 'dark' | 'system'

interface ThemeCtx {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (t: Theme) => void
}
```

- Default to `'system'`
- Persist to `localStorage` key `'theme'`
- `resolved` is computed: if `'system'`, read `prefers-color-scheme`; else the chosen value
- On change, toggle `data-theme` attribute on `<html>` and set `color-scheme`
- Listen for `change` on `prefers-color-scheme` media query when in `system` mode

### 1.2 Dark Theme CSS Variables

Add to `dashboard/src/index.css`:

```css
:root,
[data-theme='light'] {
  color-scheme: light;
  /* existing light variables (unchanged) */
}

[data-theme='dark'] {
  color-scheme: dark;
  --ui-bg: #121212;
  --ui-bg-muted: #1e1e1e;
  --ui-surface: #252525;
  --ui-surface-alt: #2a2a2a;
  --ui-surface-strong: #333333;
  --ui-text: #e8e8e8;
  --ui-text-muted: #a0a0a0;
  --ui-text-subtle: #808080;
  --ui-border: rgba(255, 255, 255, 0.08);
  --ui-border-strong: rgba(255, 255, 255, 0.14);
  --ui-primary: #4fc3c3;
  --ui-primary-hover: #45b3b3;
  --ui-primary-text: #121212;
  --ui-primary-soft: rgba(79, 195, 195, 0.15);
  --ui-success: #4caf78;
  --ui-success-soft: rgba(76, 175, 120, 0.15);
  --ui-warning: #d4a847;
  --ui-warning-soft: rgba(212, 168, 71, 0.15);
  --ui-danger: #e57373;
  --ui-danger-soft: rgba(229, 115, 115, 0.15);
  --ui-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  --ui-shadow-strong: 0 4px 12px rgba(0, 0, 0, 0.4);
}
```

### 1.3 Theme Toggle UI

Add a theme toggle button in `Sidebar.tsx`:
- Sun/Moon icon (lucide-react `Sun`/`Moon`)
- Place it near the language toggle (bottom of sidebar)
- Cycles: light → dark → system → light
- Show a tooltip/badge indicating current mode

### 1.4 Integration

- Wrap App in `<ThemeProvider>` in `App.tsx`
- Inline `<script>` in `index.html` to read `localStorage` + `prefers-color-scheme` and set `data-theme` before first paint (prevents flash)

---

## Phase 2 — RTL Fixes

### 2.1 Audit & Fix Hardcoded Directional Styles

Search `dashboard/src/` for these and replace with logical equivalents:

| Hardcoded | Logical Replacement |
|-----------|-------------------|
| `left: X` / `right: X` | Use `insetInlineStart` / `insetInlineEnd` |
| `marginLeft` / `marginRight` | `marginInlineStart` / `marginInlineEnd` |
| `paddingLeft` / `paddingRight` | `paddingInlineStart` / `paddingInlineEnd` |
| `borderLeft` / `borderRight` | `borderInlineStart` / `borderInlineEnd` |
| `textAlign: 'left'` | `textAlign: dir === 'rtl' ? 'right' : 'left'` |
| `textAlign: 'right'` | `textAlign: dir === 'rtl' ? 'left' : 'right'` |
| `translateX(Npx)` | multiply by -1 in RTL |

### 2.2 Create RTL Utility

`dashboard/src/lib/rtl.tsx`:

```tsx
import { useI18n } from './i18n'

export function useDirectional<T>(ltr: T, rtl: T): T {
  const { dir } = useI18n()
  return dir === 'rtl' ? rtl : ltr
}
```

### 2.3 Files to Fix (by priority)

1. `primitives.tsx` — Sheet positioning (`right` → `insetInlineEnd`), AutoComplete dropdown
2. `Sidebar.tsx` — sidebar slide direction
3. `Layout.tsx` — mobile hamburger, overlay positioning
4. `LoginPage.tsx` — left decorative panel (hide in RTL or swap sides)
5. `SettingsPage.tsx` — any hardcoded directional styles
6. All other pages — sweep for `*(Left|Right)` in style props

### 2.4 Update Sidebar Animation CSS

- LTR: `translateX(-100%)` hidden → `translateX(0)` visible
- RTL: `translateX(100%)` hidden → `translateX(0)` visible

---

## Phase 3 — Translation Completion

### 3.1 Key Naming Convention

```
page.<pageName>.<section>.<element>
common.<element>
nav.<item>
```

### 3.2 Audit Pages

Every page in `src/pages/` and `src/components/` must use `t('key')` for all user-visible strings. Pages to audit:

- `Sidebar.tsx`, `Layout.tsx` (navigation, actions)
- `LoginPage.tsx` (form labels, placeholders, errors)
- `DashboardPage.tsx`, `AgentsPage.tsx`, `ScraperPage.tsx`
- `RulesPage.tsx`, `MembersPage.tsx`, `ActivityPage.tsx`
- `AutomationPage.tsx`, `FAQPage.tsx`, `SummariesPage.tsx`
- `SettingsPage.tsx`, `SubscriptionsPage.tsx`, `BulkJobsPage.tsx`
- `OwnerPage.tsx`
- `admin/*.tsx` (Health, Agents, Jobs, Subscriptions, PromoCodes, Audit, BulkAdd, AISettings, AdmissionIntelligence, Knowledge)

### 3.3 Add Missing Arabic Translations

For every new key, add Arabic equivalent in the `ar` dictionary section of `i18n.tsx`.

### 3.4 Replacement Process

One file at a time:
1. Find all hardcoded strings (quoted text in JSX)
2. Add keys to both `en` and `ar` dicts
3. Replace strings with `t('key')`

---

## Implementation Order

| Step | Description | Files | Depends On |
|------|-------------|-------|------------|
| 1 | Theme context + provider | `theme.tsx`, `App.tsx` | — |
| 2 | Dark CSS variables | `index.css` | Step 1 |
| 3 | Anti-flash script | `index.html` | Step 1 |
| 4 | Theme toggle UI | `Sidebar.tsx` | Step 1 |
| 5 | RTL utility | `rtl.tsx` | — |
| 6 | RTL fixes: primitives | `primitives.tsx` | Step 5 |
| 7 | RTL fixes: layout | `Layout.tsx`, `Sidebar.tsx`, `LoginPage.tsx` | Step 5 |
| 8 | RTL fixes: sidebar CSS | `index.css` | Step 7 |
| 9 | RTL sweep: all pages | All pages | Step 5 |
| 10 | Translation audit | All pages | — |
| 11 | Add missing keys | `i18n.tsx` | Step 10 |
| 12 | Replace hardcoded strings | All pages | Step 11 |

---

## Verification

- [ ] Theme toggle cycles light → dark → system
- [ ] All `--ui-*` variables have dark values — no invisible text or missing contrast
- [ ] `prefers-color-scheme: dark` auto-selects dark mode on first visit
- [ ] No flash of wrong theme on page load
- [ ] Theme preference persists across page reloads
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] `npm test` passes
- [ ] RTL: sidebar slides from the right
- [ ] RTL: dialog/sheet positioning is correct
- [ ] RTL: text alignment in tables is correct
- [ ] RTL: no `marginLeft`/`marginRight` without RTL equivalent
- [ ] All user-visible strings use `t()` calls
- [ ] Arabic translations exist for all English keys
- [ ] Language toggle still works and switches both lang + dir

## Open Questions

1. Should the dark theme be restricted to only `light`/`dark` (drop `system` mode) to keep it simpler?
2. The `--ui-shadow` / `--ui-shadow-strong` values in dark mode — should shadows be more subtle (currently all `rgba(0,0,0,0.3-0.4)`) or more pronounced?
3. LoginPage has a decorative left panel with hardcoded color `#1a5c63` — should this be replaced with `var(--ui-primary)` or a custom var?
4. Should translation audit include toast/notification messages that are generated dynamically?
