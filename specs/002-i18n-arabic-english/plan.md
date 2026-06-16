# Implementation Plan: Arabic and English Language Support (i18n)

**Branch**: `002-i18n-arabic-english` | **Date**: 2026-06-16 | **Spec**: `specs/002-i18n-arabic-english/spec.md`

**Input**: Feature specification from specs/002-i18n-arabic-english/spec.md + GitHub issue #40

## Summary

Add a client-side i18n system to the miniapp SPA with centralized JSON translation dictionaries for English and Arabic. Implement a `useTranslation` hook/provider, language persistence via localStorage, a language switcher on the Settings page, RTL layout support for Arabic, and locale-aware date/number formatting. No backend changes required.

## Technical Context

**Language/Version**: TypeScript 5.5, React 18.3

**Primary Dependencies**: `i18next` + `react-i18next` (to be added), existing: React, Vite, `@miniapp/shared`

**Storage**: localStorage for language preference (no backend persistence for V1)

**Testing**: Manual verification + `tsc --noEmit` for type safety

**Target Platform**: Telegram miniapp WebView (mobile + desktop)

**Project Type**: SPA (React + Vite)

**Constraints**: Must work inside Telegram WebView; no backend API changes; only display text is translated

**Scale/Scope**: 2 languages (en, ar), ~5 pages, ~15 components, ~300 translatable strings

## Constitution Check

No constitution violations identified. This feature adds a new client-side capability without modifying backend APIs, routes, or data models.

## Project Structure

```
apps/miniapp-agents/
├── src/
│   ├── i18n/
│   │   ├── index.ts              # i18next init & export
│   │   ├── locales/
│   │   │   ├── en.json            # English translation dictionary
│   │   │   └── ar.json            # Arabic translation dictionary
│   │   └── useLanguage.ts         # React hook for language state + switcher
│   ├── components/
│   │   └── LanguageSwitcher.tsx   # Dropdown/select for language selection
│   ├── App.tsx                    # Wrap with TranslationProvider, add dir=rtl/ltr
│   └── main.tsx                   # Initialize i18n before React render
packages/
└── miniapp-shared/
    └── src/
        └── ui/
            └── index.tsx          # Shared components unchanged; translations passed via props
```

**Structure Decision**: Single frontend project (`apps/miniapp-agents`) with a new `i18n/` module. Shared UI components in `@miniapp/shared` receive translated strings as props rather than adding i18n dependency to the shared package.

## Phases

### Phase 1: i18n Infrastructure (Foundation)
- Add `i18next` + `react-i18next` dependencies
- Create translation dictionaries (`en.json`, `ar.json`) with all app strings
- Initialize i18next in `src/i18n/index.ts`
- Create `useLanguage` hook for language state and persistence
- Wire i18n init into `main.tsx`

### Phase 2: RTL Support + Language Switcher
- Add RTL CSS utilities (mirrored margins/padding/icons via CSS variables or `[dir="rtl"]` selectors)
- Set `<html dir="rtl|ltr">` based on active language
- Create `LanguageSwitcher` component
- Add language switcher to Settings page
- Persist language choice to localStorage; restore on load

### Phase 3: Translate Page-by-Page
- Replace hardcoded strings with `t()` calls in:
  - Navigation / BottomNav tab labels
  - Dashboard / analytics page
  - Leads page (LeadsAcquisitionSection)
  - Campaigns page (CampaignsPage)
  - Tasks page (AutomationTasksSection)
  - Settings page (account cards, MCP tokens, notifications)
  - Shared components (Button, Card, InputField labels passed as props)
  - Status/enum labels (pending, queued, running, completed, failed, cancelled, scheduled)
  - Empty states, error messages, success toasts
  - Form labels, placeholders, validation messages

### Phase 4: Locale-aware Formatting
- Localize date/time display using `toLocaleString(locale)`
- Localize number/count formatting using `toLocaleString(locale)`
- Ensure RTL dates display numbers LTR within RTL context

### Phase 5: Polish & Edge Cases
- Add missing key detection (console.warn in dev mode)
- Test all pages in both languages
- Verify RTL layout on all pages
- Verify Telegram language detection for initial locale
- Handle edge cases: missing keys, rapid language switching, unsaved form state
