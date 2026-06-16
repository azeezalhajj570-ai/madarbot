# Tasks: Arabic and English Language Support (i18n)

**Input**: Design documents from `/specs/002-i18n-arabic-english/`

**Prerequisites**: spec.md, plan.md

## Format: `[ID] [P?] [Story] Description`

## Phase 1: i18n Infrastructure (Foundation)

**Purpose**: i18n engine, translation dictionaries, React integration — blocks ALL user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T001 [P] Add `i18next` + `react-i18next` npm dependencies in `apps/miniapp-agents/package.json`
- [ ] T002 Create English translation dictionary at `apps/miniapp-agents/src/i18n/locales/en.json` with all user-facing strings
- [ ] T003 Create Arabic translation dictionary at `apps/miniapp-agents/src/i18n/locales/ar.json` with all user-facing strings
- [ ] T004 Initialize i18next in `apps/miniapp-agents/src/i18n/index.ts` with en/ar resources, fallback to en, and detection for missing keys in dev mode
- [ ] T005 Create `useLanguage` hook at `apps/miniapp-agents/src/i18n/useLanguage.ts` that wraps i18next `changeLanguage`, persists to localStorage, and reads initial locale from Telegram `language_code`
- [ ] T006 Wire i18n initialization into `apps/miniapp-agents/src/main.tsx` before React render

**Checkpoint**: Foundation ready — i18n engine works, both dictionaries exist, `useLanguage` hook works

---

## Phase 2: RTL Support + Language Switcher

- [ ] T007 [P] [US1][US2] Add RTL-aware CSS — set `<html dir="rtl|ltr">` based on active language in `apps/miniapp-agents/src/App.tsx`
- [ ] T008 [P] [US1][US2] Add RTL CSS utilities: mirrored margins, padding, alignment, and icon rotation for directional icons using `[dir="rtl"]` selectors
- [ ] T009 [US2] Create `LanguageSwitcher` component at `apps/miniapp-agents/src/components/LanguageSwitcher.tsx` — dropdown with en/ar options, calls `useLanguage` to switch
- [ ] T010 [US2] Add `LanguageSwitcher` to the Settings page in `apps/miniapp-agents/src/App.tsx`

---

## Phase 3: Translate Pages (User Story 1 — Arabic UI + User Story 2 — Language Switch + User Story 3 — English Polish)

**Purpose**: Replace all hardcoded user-facing strings with `t()` calls

### Navigation & Layout

- [ ] T011 [P] [US1] Translate BottomNav tab labels in `apps/miniapp-agents/src/App.tsx`
- [ ] T012 [P] [US1] Translate AppShell title, subtitle in `apps/miniapp-agents/src/App.tsx`
- [ ] T013 [P] [US1] Translate notification bell tooltip and notification labels in `apps/miniapp-agents/src/App.tsx`

### Dashboard / Analytics Page

- [ ] T014 [US1][US3] Translate dashboard page — Card titles, analytics labels, status labels, empty state in `apps/miniapp-agents/src/App.tsx` (inline AccountAnalyticsPage section)

### Leads Page

- [ ] T015 [US1][US3] Translate LeadsAcquisitionSection — Card titles, button labels, form labels, placeholders, status/error messages in `apps/miniapp-agents/src/features/leads/LeadsAcquisitionSection.tsx`
- [ ] T016 [US1][US3] Translate AccountLeadsPage — table headers, status labels, action buttons, empty state, lead detail modal in `apps/miniapp-agents/src/App.tsx` (inline section)

### Campaigns Page

- [ ] T017 [US1][US3] Translate CampaignsPage — Card titles, form labels, button labels, status labels, schedule labels, empty states, send log labels in `apps/miniapp-agents/src/pages/CampaignsPage.tsx`
- [ ] T018 [P] [US1] Translate campaign status labels (draft, scheduled, sending, sent, failed) in `apps/miniapp-agents/src/pages/CampaignsPage.tsx`

### Tasks Page

- [ ] T019 [US1][US3] Translate AutomationTasksSection — Card titles, form labels, button labels, placeholder text, condition labels, confirmation modal text, status/error messages in `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx`
- [ ] T020 [P] [US1] Translate TaskActivity — job status labels (pending, queued, running, completed, failed, cancelled), filter labels, send log labels in `apps/miniapp-agents/src/App.tsx` (inline section)

### Settings Page

- [ ] T021 [US1][US3] Translate Settings page — LinkedAccountCard labels, MCPTokensCard labels, RegistrationWizard steps, PhoneEntryStep labels, WizardCodeStep labels, WizardPasswordStep labels, SubscriptionForm labels in `apps/miniapp-agents/src/App.tsx`
- [ ] T022 [P] [US1] Translate SubscriptionSheet plan names, features, price labels, promo code form in `apps/miniapp-agents/src/App.tsx`
- [ ] T023 [P] [US1] Translate NotificationSheet title, mark-seen label, empty state in `apps/miniapp-agents/src/App.tsx`

### Shared Components

- [ ] T024 [P] [US1] Translate ConfirmModal title/message/confirm/cancel labels in `apps/miniapp-agents/src/components/ConfirmModal.tsx`
- [ ] T025 [P] [US1] Translate empty state messages in DataTable (`apps/miniapp-agents/src/components/DataTable.tsx`)
- [ ] T026 [P] [US1] Translate FormActions submit/cancel labels in `apps/miniapp-agents/src/components/FormActions.tsx` (if hardcoded)
- [ ] T027 [P] [US1] Translate GroupAutocompleteField placeholder text in `apps/miniapp-agents/src/components/GroupAutocompleteField.tsx`

---

## Phase 4: Locale-aware Formatting

- [ ] T028 [P] [US3] Localize date/time display using `toLocaleString(activeLocale)` — scan all `Date.prototype.toLocaleString()` calls without explicit locale in `apps/miniapp-agents/src/` and pass active locale
- [ ] T029 [P] [US3] Localize number/count formatting using `toLocaleString(activeLocale)` for member counts, lead counts, job counts, etc.
- [ ] T030 [US1] Verify RTL dates display numbers in LTR context using Unicode bidi controls if needed

---

## Phase 5: Polish & Edge Cases

- [ ] T031 [US2] Add initialization of language from Telegram `language_code` field in `useLanguage` hook
- [ ] T032 [P] Add console.warn for missing translation keys in development mode in `apps/miniapp-agents/src/i18n/index.ts`
- [ ] T033 Verify all pages render correctly in both Arabic (RTL) and English (LTR) — manual QA pass
- [ ] T034 Verify language persistence — switch language, close and reopen miniapp, confirm language is remembered
- [ ] T035 Verify rapid language switching does not cause layout issues or state loss
- [ ] T036 Run `tsc --noEmit` to confirm no type errors
- [ ] T037 Build and restart backend container, verify in Telegram miniapp

---

## Dependencies & Execution Order

- **Phase 1 (Foundation)**: Blocks ALL other phases — must complete first
- **Phase 2 (RTL + Switcher)**: Depends on Phase 1 — can proceed in parallel with Phase 3+ for RTL setup, but LanguageSwitcher needs translations
- **Phase 3 (Translate Pages)**: Depends on Phase 1 — tasks within each page can run in parallel
- **Phase 4 (Formatting)**: Depends on Phase 1 — independent of Phase 3 content translation
- **Phase 5 (Polish)**: Depends on Phases 1-4

### Parallel Opportunities

- T011-T013 (nav/layout translations) can run in parallel
- T014-T023 (page translations) can run in parallel across pages
- T024-T027 (shared component translations) can run in parallel
- T028-T029 (formatting) can run in parallel with Phase 3
- T007-T008 (RTL CSS) can run in parallel with T009-T010 (switcher)
