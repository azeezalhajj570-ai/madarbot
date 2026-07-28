# Task List: Dark Mode, RTL & Translation

---

## Sprint 1 — Dark Mode

### Task 1: ThemeContext + Provider

**Description:** Create `ThemeContext` for light/dark/system mode with localStorage persistence, `prefers-color-scheme` listener, and `data-theme` attribute on `<html>`. Wrap the app in `<ThemeProvider>`.

**Acceptance criteria:**
- [ ] ThemeContext exposes `theme`, `resolved`, `setTheme`
- [ ] Default mode is `'system'`
- [ ] `setTheme('dark')` sets `data-theme="dark"` on `<html>` and `color-scheme: dark`
- [ ] `setTheme('light')` sets `data-theme="light"` on `<html>` and `color-scheme: light`
- [ ] `setTheme('system')` follows `prefers-color-scheme` media query
- [ ] `system` mode listens for `change` event on media query and updates `resolved`
- [ ] Theme persists in `localStorage` key `'theme'`

**Verification:**
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] Manual: open devtools, run `localStorage.setItem('theme','dark')`, reload, verify `data-theme="dark"` on `<html>`
- [ ] Manual: toggle light/dark/system via console, verify `<html>` attribute updates

**Dependencies:** None

**Files likely touched:**
- `dashboard/src/lib/theme.tsx` (new)
- `dashboard/src/App.tsx` (wrap provider)
- `dashboard/src/main.tsx` (if provider needs to wrap before router)

**Estimated scope:** Small (2-3 files)

---

### Task 2: Dark CSS Variables + Anti-Flash Script

**Description:** Add `[data-theme='dark']` block with dark color values to `index.css`. Add inline `<script>` in `index.html` to read localStorage + `prefers-color-scheme` and set `data-theme` before first paint to prevent flash.

**Acceptance criteria:**
- [ ] All 24 `--ui-*` variables defined for dark theme
- [ ] No missing var warnings in dark mode
- [ ] `color-scheme: dark` in dark block
- [ ] Anti-flash script executes before React mounts
- [ ] Script handles: explicit light, explicit dark, system light, system dark
- [ ] No flash of light theme when dark is preferred
- [ ] No flash of dark theme when light is preferred

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: set `localStorage.theme='dark'`, hard refresh — no light flash
- [ ] Manual: set `localStorage.theme='light'`, hard refresh — no dark flash
- [ ] Manual: clear localStorage, set OS to dark mode, hard refresh — no flash
- [ ] Manual: verify contrast of every UI element in dark mode

**Dependencies:** Task 1 (uses `data-theme` convention)

**Files likely touched:**
- `dashboard/src/index.css`
- `dashboard/index.html`

**Estimated scope:** Small (2 files)

---

### Task 3: Theme Toggle UI in Sidebar

**Description:** Add theme toggle button to the sidebar footer, near the language toggle. Cycles light → dark → system → light. Shows Sun/Moon icon from lucide-react.

**Acceptance criteria:**
- [ ] Sun icon shown in dark mode, Moon in light mode, adaptive icon in system mode
- [ ] Click cycles: light → dark → system → light
- [ ] Button placed in sidebar footer near language toggle
- [ ] No layout shift when toggling
- [ ] Previous theme choice is restored on reload

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: click toggle, verify `<html>` attribute changes
- [ ] Manual: hard refresh, verify theme is preserved
- [ ] Manual: toggle through all 3 modes

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `dashboard/src/components/Sidebar.tsx`

**Estimated scope:** Small (1 file)

---

### Checkpoint: Sprint 1
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm test` passes
- [ ] Theme toggle works in all 3 modes
- [ ] No flash on hard refresh
- [ ] All UI elements visible in dark mode

---

## Sprint 2 — RTL Fixes

### Task 4: RTL Utility + Primitives Fix

**Description:** Create `useDirectional()` hook for runtime RTL-aware values. Fix all hardcoded directional styles in `primitives.tsx` (Sheet, Dialog, AutoComplete, Badge, ListItem) using logical CSS properties or the hook.

**Acceptance criteria:**
- [ ] `useDirectional(ltr, rtl)` returns correct value based on current `dir`
- [ ] Sheet `right` position → `insetInlineEnd`
- [ ] AutoComplete dropdown `left`/`right` → logical equivalent
- [ ] All `marginLeft`/`marginRight` in primitives → `marginInlineStart`/`marginInlineEnd`
- [ ] All `paddingLeft`/`paddingRight` in primitives → `paddingInlineStart`/`paddingInlineEnd`
- [ ] All `borderLeft`/`borderRight` in primitives → `borderInlineStart`/`borderInlineEnd`
- [ ] All `textAlign: 'left'`/`'right'` → uses `useDirectional`
- [ ] No hardcoded directional properties remain in `primitives.tsx`

**Verification:**
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] Manual: switch to Arabic, verify Sheet opens from left side, dialogs centered, dropdowns correct

**Dependencies:** None (RTL utility is standalone)

**Files likely touched:**
- `dashboard/src/lib/rtl.tsx` (new)
- `dashboard/src/components/ui/primitives.tsx`

**Estimated scope:** Medium (2 files, ~100 lines changed in primitives)

---

### Task 5: Layout + Sidebar RTL Fixes

**Description:** Fix RTL issues in Layout (mobile nav, hamburger, overlay) and Sidebar (slide animation). Update CSS classes in `index.css` for RTL-aware sidebar animation.

**Acceptance criteria:**
- [ ] Sidebar slides from right in RTL (`translateX(100%)` → `translateX(0)`)
- [ ] Sidebar slides from left in LTR (`translateX(-100%)` → `translateX(0)`)
- [ ] Mobile hamburger icon position swaps in RTL
- [ ] Sidebar overlay click-to-close works in RTL
- [ ] No hardcoded directional properties in Layout.tsx or Sidebar.tsx

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: switch to Arabic, verify sidebar slides from right
- [ ] Manual: switch to English, verify sidebar slides from left
- [ ] Manual: mobile viewport, hamburger opens sidebar correctly in both directions

**Dependencies:** Task 4 (RTL utility available)

**Files likely touched:**
- `dashboard/src/components/Layout.tsx`
- `dashboard/src/components/Sidebar.tsx`
- `dashboard/src/index.css`

**Estimated scope:** Medium (3 files)

---

### Task 6: Remaining Pages RTL Sweep

**Description:** Audit and fix all remaining page components for hardcoded directional styles. Focus on LoginPage (decorative panel positioning) and any `marginLeft`/`marginRight`/`paddingLeft`/`paddingRight`/`left`/`right` in other pages.

**Acceptance criteria:**
- [ ] LoginPage decorative panel hides or swaps sides in RTL
- [ ] No `marginLeft`/`marginRight` in any page component
- [ ] No `paddingLeft`/`paddingRight` in any page component
- [ ] No `left`/`right` (positioning) in any page component
- [ ] No `borderLeft`/`borderRight` in any page component
- [ ] No `textAlign: 'left'`/`'right'` without RTL handling
- [ ] All `<Input>`/`<Select>`/`<Textarea>` placeholder `dir` correct for Arabic

**Verification:**
- [ ] `npm run build` succeeds
- [ ] `grep -rn 'marginLeft\|marginRight\|paddingLeft\|paddingRight\|borderLeft\|borderRight' src/` returns zero non-test hits
- [ ] Manual: navigate every page in Arabic, verify no broken layouts

**Dependencies:** Task 4

**Files likely touched:**
- `dashboard/src/pages/LoginPage.tsx`
- `dashboard/src/pages/*.tsx` (scattered fixes)
- `dashboard/src/pages/admin/*.tsx` (scattered fixes)

**Estimated scope:** Medium (3-6 files)

---

### Checkpoint: Sprint 2
- [ ] `npm run build` succeeds
- [ ] Full RTL audit: no hardcoded directional patterns remain
- [ ] Sidebar animates correctly in both directions
- [ ] LoginPage renders correctly in RTL
- [ ] Manual walkthrough of all pages in Arabic shows no broken layout

---

## Sprint 3 — Translation Completion

### Task 7: Translation Audit

**Description:** Read every page component and sidebar/layout, identify all hardcoded user-visible strings that aren't using `t()`. Produce a list of missing translation keys.

**Acceptance criteria:**
- [ ] Every `.tsx` file in `src/pages/` and `src/components/` checked
- [ ] Missing keys documented with their source file and line
- [ ] Shared strings (buttons, placeholders) identified for deduplication
- [ ] Existing `DICT` keys reviewed for consistency with new naming convention

**Verification:**
- [ ] Audit list saved or reported back
- [ ] No code changes in this task — read-only

**Dependencies:** None

**Files touched:** None (read-only audit)

**Estimated scope:** Small (read-only, no code changes)

---

### Task 8: Add Missing Keys to i18n.tsx

**Description:** Add all missing translation keys from the audit to both `en` and `ar` dictionaries in `i18n.tsx`. Following `page.<name>.<section>.<element>` convention.

**Acceptance criteria:**
- [ ] Every key from audit added to `DICT.en`
- [ ] Every key from audit added to `DICT.ar`
- [ ] No duplicate keys
- [ ] Keys follow `page.<name>.<section>.<element>` naming
- [ ] Common reusable keys use `common.<name>` prefix
- [ ] Arabic translations are accurate (correct script, natural phrasing)
- [ ] `t()` fallback behavior preserved: key → DICT.en[key] → key itself

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: import `DICT` in console, verify all new keys exist in both languages

**Dependencies:** Task 7

**Files likely touched:**
- `dashboard/src/lib/i18n.tsx`

**Estimated scope:** Medium (1 file, ~100-200 new dict entries)

---

### Task 9: Replace Hardcoded Strings in Core Components

**Description:** Replace hardcoded English strings with `t('key')` calls in core components: Sidebar, Layout, LoginPage, and main navigation.

**Acceptance criteria:**
- [ ] Sidebar navigation labels use `t()`
- [ ] Layout mobile nav items use `t()`
- [ ] LoginPage form labels, placeholders, errors, button text use `t()`
- [ ] Language toggle label uses `t()`
- [ ] No hardcoded English strings in these files

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: switch to Arabic, verify core navigation and login are fully translated

**Dependencies:** Task 8

**Files likely touched:**
- `dashboard/src/components/Sidebar.tsx`
- `dashboard/src/components/Layout.tsx`
- `dashboard/src/pages/LoginPage.tsx`

**Estimated scope:** Medium (3 files)

---

### Task 10: Replace Hardcoded Strings in Main Pages

**Description:** Replace hardcoded English strings with `t('key')` in main page components: Dashboard, Agents, Scraper, Rules, Members, Activity, Automation, FAQ, Summaries, Settings, Subscriptions, BulkJobs, Owner.

**Acceptance criteria:**
- [ ] All page titles use `t()`
- [ ] All table column headers use `t()`
- [ ] All button labels use `t()`
- [ ] All empty states use `t()`
- [ ] All form labels and placeholders use `t()`
- [ ] All toast/notification messages use `t()`
- [ ] No hardcoded English strings in these pages

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: navigate every page in Arabic, verify all text is translated

**Dependencies:** Task 8

**Files likely touched:**
- `dashboard/src/pages/DashboardPage.tsx`
- `dashboard/src/pages/AgentsPage.tsx`
- `dashboard/src/pages/ScraperPage.tsx`
- `dashboard/src/pages/RulesPage.tsx`
- `dashboard/src/pages/MembersPage.tsx`
- `dashboard/src/pages/ActivityPage.tsx`
- `dashboard/src/pages/AutomationPage.tsx`
- `dashboard/src/pages/FAQPage.tsx`
- `dashboard/src/pages/SummariesPage.tsx`
- `dashboard/src/pages/SettingsPage.tsx`
- `dashboard/src/pages/SubscriptionsPage.tsx`
- `dashboard/src/pages/BulkJobsPage.tsx`
- `dashboard/src/pages/OwnerPage.tsx`

**Estimated scope:** Large (13 files) — can be parallelized

---

### Task 11: Replace Hardcoded Strings in Admin Pages

**Description:** Replace hardcoded English strings with `t('key')` in all admin page components: Health, Agents, Jobs, Subscriptions, PromoCodes, Audit, BulkAdd, AISettings, AdmissionIntelligence, Knowledge.

**Acceptance criteria:**
- [ ] All admin page titles use `t()`
- [ ] All table headers use `t()`
- [ ] All button labels use `t()`
- [ ] All form labels use `t()`
- [ ] No hardcoded English strings in admin pages

**Verification:**
- [ ] `npm run build` succeeds
- [ ] Manual: navigate every admin page in Arabic, verify all text is translated

**Dependencies:** Task 8

**Files likely touched:**
- `dashboard/src/pages/admin/HealthPage.tsx`
- `dashboard/src/pages/admin/AgentsPage.tsx`
- `dashboard/src/pages/admin/JobsPage.tsx`
- `dashboard/src/pages/admin/SubscriptionsPage.tsx`
- `dashboard/src/pages/admin/PromoCodesPage.tsx`
- `dashboard/src/pages/admin/AuditPage.tsx`
- `dashboard/src/pages/admin/BulkAddPage.tsx`
- `dashboard/src/pages/admin/AISettingsPage.tsx`
- `dashboard/src/pages/admin/AdmissionIntelligencePage.tsx`
- `dashboard/src/pages/admin/KnowledgePage.tsx`

**Estimated scope:** Large (10 files) — can be parallelized

---

### Task 12: Test Translation + Theme Integration

**Description:** Write unit tests for ThemeContext (render, toggle, localStorage, system mode) and test that `t()` returns correct strings for both `en` and `ar`. Ensure existing tests still pass.

**Acceptance criteria:**
- [ ] ThemeContext test: renders children
- [ ] ThemeContext test: toggle updates `resolved` value
- [ ] ThemeContext test: preference persisted to localStorage
- [ ] ThemeContext test: system mode follows `prefers-color-scheme`
- [ ] i18n test: `t()` returns correct string for `en`
- [ ] i18n test: `t()` returns correct string for `ar`
- [ ] i18n test: `t()` falls back to `en` key when `ar` key missing
- [ ] Existing tests still pass
- [ ] `npm test` passes

**Verification:**
- [ ] `npm test` passes
- [ ] `npm run build` succeeds

**Dependencies:** Tasks 1, 8

**Files likely touched:**
- `dashboard/src/test/theme.test.tsx` (new)
- `dashboard/src/test/i18n.test.tsx` (new)

**Estimated scope:** Small (2 new files)

---

### Checkpoint: Sprint 3
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm test` passes (including new tests)
- [ ] Every page renders fully translated content in Arabic
- [ ] No hardcoded English strings remain in any component
- [ ] Dict contains both `en` and `ar` for all keys

---

## Summary

| Sprint | Tasks | Scope | Key Deliverable |
|--------|-------|-------|-----------------|
| 1: Dark Mode | 1-3 | Foundation | Theme toggle works, dark mode renders |
| 2: RTL Fixes | 4-6 | Layout | Dashboard works in RTL, no broken components |
| 3: Translation | 7-12 | Content | Arabic translation complete, tests pass |
