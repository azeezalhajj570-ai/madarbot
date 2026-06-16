# Feature Specification: Arabic and English Language Support (i18n)

**Feature Branch**: `002-i18n-arabic-english`

**Created**: 2026-06-16

**Status**: Draft

**Input**: GitHub issue #40 — Add Arabic and English language support to the miniapp

## User Scenarios & Testing

### User Story 1 — Arabic-speaking user uses miniapp in Arabic (Priority: P1)

An Arabic-speaking Telegram user opens the miniapp and sees all UI text in Arabic with correct RTL layout.

**Why this priority**: Core requirement — without Arabic translation + RTL, Arabic users cannot use the app natively.

**Independent Test**: Open the miniapp, switch language to Arabic via settings. Verify every page, button, label, placeholder, status, and error message displays in Arabic. Verify RTL alignment, correct text direction, and icon mirroring.

**Acceptance Scenarios**:

1. **Given** the user opens the miniapp **When** the app loads **Then** the UI text appears in the user's Telegram language if Arabic or English is supported, otherwise falls back to English
2. **Given** the user navigates to Settings **When** they select Arabic from the language picker **Then** all UI text immediately switches to Arabic, document direction changes to rtl, and the choice persists after refresh
3. **Given** Arabic is active **When** the user views any page with a list, form, table, or card **Then** layout, spacing, and alignment are correct for RTL

---

### User Story 2 — User switches language via settings (Priority: P1)

A user wants to switch between Arabic and English from a visible settings control.

**Why this priority**: Without a switcher, users are locked into one language. This is the primary mechanism to select language.

**Independent Test**: Navigate to Settings page, change language from English to Arabic and back. Verify all UI text updates immediately.

**Acceptance Scenarios**:

1. **Given** the user is on the Settings page **When** they change the language dropdown **Then** the UI language switches immediately without page reload
2. **Given** the user selected Arabic **When** they close and reopen the miniapp **Then** Arabic is still active
3. **Given** the user switches the language **When** they navigate between pages **Then** the language persists across all pages

---

### User Story 3 — English-speaking user sees polished English UI (Priority: P2)

An English-speaking user uses the miniapp and sees clean, properly formatted English text with no hardcoded fallback issues.

**Why this priority**: English is the default and must feel native, not like an untranslated fallback.

**Independent Test**: Set language to English. Verify all UI text is in proper English, dates/times/numbers use locale-aware formatting.

**Acceptance Scenarios**:

1. **Given** English is active **When** the user views dates, times, or numbers **Then** they are formatted according to English locale conventions
2. **Given** English is active **When** the user sees status labels (pending, completed, failed, etc.) **Then** they display in English

---

### Edge Cases

- What happens when a translation key is missing? — Falls back to English key value or key name
- What happens when a new component is added without translations? — Falls back to English without crashing
- What happens when the browser/Telegram language is neither Arabic nor English? — Default to English
- What happens during language switch while a form has unsaved input? — Form state preserved, only labels re-render
- What happens to dates in RTL mode? — Numbers remain LTR within RTL text; date format is locale-appropriate
- How does RTL affect icons with directional meaning (arrows, chevrons)? — Icons that imply direction should be mirrored via CSS

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a structured i18n translation system with centralized JSON dictionaries for English and Arabic
- **FR-002**: System MUST provide a reusable `t(key)` translation function or hook accessible from any component
- **FR-003**: System MUST display UI text in the user's selected language, falling back to English for missing keys
- **FR-004**: System MUST persist the selected language across sessions using localStorage
- **FR-005**: System MUST provide a language switcher UI component on the Settings page
- **FR-006**: System MUST switch the active language immediately when the user selects a new language, without page reload
- **FR-007**: System MUST set document direction to `rtl` when Arabic is active and `ltr` when English is active
- **FR-008**: System MUST apply RTL-aware CSS for margins, padding, alignment, and icon mirroring
- **FR-009**: System MUST translate all user-facing text across all pages: Dashboard, Leads, Campaigns, Tasks, Settings, navigation, buttons, form labels, placeholders, empty states, status labels, and error/success messages
- **FR-010**: System MUST localize date, time, and number formatting using the active locale
- **FR-011**: System MUST translate status/enum labels (pending, queued, running, completed, failed, cancelled, scheduled) while keeping internal API values in English
- **FR-012**: System MUST NOT modify backend APIs, route IDs, or internal enum values — only display text is translated
- **FR-013**: System MUST detect missing translation keys during development (e.g., console warning) to prevent untranslated strings from reaching production
- **FR-014**: System MUST initialize the language from the Telegram user's `language_code` when available

### Key Entities

- **Translation Dictionary**: JSON file per language (`en.json`, `ar.json`) with flat or nested key-value pairs
- **Language State**: Active locale code stored in React context + persisted to localStorage
- **Language Switcher**: Dropdown/select component on the Settings page

## Success Criteria

- **SC-001**: 100% of user-facing strings in the miniapp are wrapped with translation keys (no hardcoded English strings in components)
- **SC-002**: Arabic mode renders with correct RTL layout on all pages — no broken alignment, overlapping text, or mis-ordered elements
- **SC-003**: Language switch takes effect immediately (<500ms re-render) without page reload
- **SC-004**: Selected language persists across miniapp reopen/refresh
- **SC-005**: Missing translation keys display English fallback text, never raw `undefined` or key names
- **SC-006**: Date/time/number formatting uses locale-aware APIs for both English and Arabic
- **SC-007**: Internal API calls, route URLs, and enum values remain unchanged (English)

## Assumptions

- The miniapp does not need SSR or dynamic language loading — all translations are bundled at build time
- Backend language preference storage is out of scope for V1; localStorage is sufficient
- No new backend endpoints are required for V1 i18n
- The `language_code` from `MiniappIdentity.user.language_code` (Telegram) provides the initial locale hint
- All UI is rendered client-side within the Telegram miniapp WebView
- The existing `@miniapp/shared` package components will receive translation strings via props rather than having their own i18n dependency
