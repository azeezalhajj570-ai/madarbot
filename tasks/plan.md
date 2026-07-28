# Implementation Plan: Dark Mode, RTL & Translation

## Overview

Three sprints adding dark mode, fixing RTL, and completing Arabic translations for the admin dashboard SPA at `dashboard/`.

## Architecture Decisions

1. **CSS variables for theming** — Dark mode is a second set of `--ui-*` vars under `[data-theme='dark']`. No Tailwind, no CSS modules, no CSS-in-JS. All 24 tokens get dark values.
2. **Theme as `data-theme` attribute** — Set on `<html>` to avoid specificity battles. Anti-flash inline script reads `localStorage` + `prefers-color-scheme` before first paint.
3. **Logical CSS properties** — Replace hardcoded `marginLeft`/`marginRight`/`paddingLeft`/`paddingRight` with `marginInlineStart`/`marginInlineEnd`/`paddingInlineStart`/`paddingInlineEnd`. These are natively RTL-aware — no runtime logic needed.
4. **No RTL wrapper components** — Use a thin `useDirectional()` hook only where logical properties can't express the intent (e.g., `textAlign`, `translateX`).
5. **Single-file i18n dictionary** — The custom `i18n.tsx` context stays. No migration to i18next. Keys follow `page.<name>.<section>.<element>` convention.

## Dependency Graph

```
ThemeContext ──┬── App.tsx (wrap provider)
               ├── index.css (dark vars)
               ├── index.html (anti-flash script)
               └── Sidebar.tsx (toggle UI)

RTL utility ──┬── primitives.tsx (Sheet, Dialog, AutoComplete)
               ├── Layout.tsx (mobile nav, overlay)
               ├── Sidebar.tsx (slide animation)
               ├── LoginPage.tsx (decorative panel)
               └── all pages (sweep)

i18n audit ──┬── i18n.tsx (add missing keys)
              └── all pages (replace hardcoded strings)
```

## Sprints

### Sprint 1: Dark Mode (3 tasks)
Foundation: theme context → CSS vars → toggle UI. Sequential, no parallelization.

### Sprint 2: RTL Fixes (3 tasks)
Utility first, then primitives (biggest impact), then layout components, then remaining pages.

### Sprint 3: Translation Completion (3 tasks)
Audit first (read-only), then add keys, then replace strings across all pages.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Anti-flash script breaks on older browsers | Low | `localStorage` + `matchMedia` are well-supported |
| RTL fix misses some hardcoded styles | Medium | Systematic grep for `*(Left\|Right)` patterns |
| Translation keys conflict with existing keys | Medium | Use `page.` prefix convention to namespace |
| Inline script has wrong theme at paint time | High | Test: set localStorage, hard refresh, verify no flash |
| `useDirectional` hook causes re-renders | Low | Only re-renders when `dir` changes (on language toggle) |

## Verification Checkpoints

- **After Sprint 1**: `npm run build` succeeds, theme toggle works, dark mode renders correctly
- **After Sprint 2**: Dashboard looks correct in RTL, no hardcoded directional styles remain
- **After Sprint 3**: No hardcoded English strings, all strings use `t()`, Arabic translations present
- **Final**: `npm test` passes, `npm run build` succeeds
