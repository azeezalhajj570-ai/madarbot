# Feature Specification: Popup Toast Notifications

**Feature Branch**: `013-popup-toast-notifications`

**Created**: 2026-07-07

**Status**: Draft

**Input**: GitHub issue #77 — "Show notifications as auto-dismissing popup toasts instead of only in the notification sheet"

## User Scenarios & Testing

### User Story 1 — Real-Time Toast on New Notification (Priority: P1)

As an agent operator working in the app, I want new backend notifications (job completed/failed, scrape finished, etc.) to appear as auto-dismissing popup toasts in my viewport so I'm alerted immediately without needing to open the notification sheet.

**Why this priority**: This is the core UX gap — users currently have no proactive alert. Notifications only appear behind the bell icon, requiring manual discovery. This story delivers the primary value: real-time awareness.

**Independent Test**: Trigger a scrape job on an agent. While keeping the app open on any page, verify a toast slides in from top-right after 15-30s polling discovers the new notification. Verify it auto-dismisses after 5 seconds or on click.

**Acceptance Scenarios**:

1. **Given** the user is on any page with an active account selected, **When** a new notification is created on the backend and the polling cycle picks it up (15-30s interval), **Then** a toast slides in from the top-right showing the notification title + body, color-coded by kind (success/failure/info)
2. **Given** a toast is visible, **When** the user clicks/taps the toast, **Then** the notification sheet opens (full history view)
3. **Given** a toast is visible, **When** the dismiss (×) button is clicked OR 5 seconds elapse, **Then** the toast slides out and is removed
4. **Given** multiple new notifications arrive in the same poll cycle, **When** they are discovered, **Then** toasts stack vertically below each other (newest at top), each with its own dismiss timer
5. **Given** the notification sheet is already open, **When** a new notification arrives, **Then** no toast is shown (the sheet already shows it)

---

### User Story 2 — Error/Status Messages as Toasts (Priority: P1)

As an agent operator filling out a tall form (campaign, automation task, etc.), I want error messages and status updates from `setStatus()` calls to appear as fixed-position toasts so I can see them regardless of my scroll position.

**Why this priority**: Equal priority to US1 — the inline error display at the top of scrollable content is the most common UX frustration. Users deep in forms never see validation errors or operation results. This directly causes support friction.

**Independent Test**: Open the Campaigns page, scroll to the bottom of a tall form, and click Submit with missing fields. Verify a toast appears in the top-right saying "Message is required" rather than (or in addition to) the inline `<Note>` which the user can't see.

**Acceptance Scenarios**:

1. **Given** the user is scrolled deep in a Campaigns form, **When** validation fails (e.g., empty messages), **Then** a toast slides in at top-right with the error message AND the form auto-scrolls to the first invalid field
2. **Given** any page calls `setStatus(errorMessage)`, **When** the status is set, **Then** a toast appears alongside (or replacing) the inline `DismissibleStatus`/`<Note>` banner
3. **Given** a success status is set (e.g., "Campaign created"), **When** the user is scrolled down, **Then** a success-toast appears at top-right confirming the action
4. **Given** a toast for an error is displayed, **When** the user clicks the toast, **Then** the page scrolls to the first error/invalid field

---

### User Story 3 — Notification Polling (Priority: P2)

As an agent operator, I want the app to periodically check for new notifications while I'm actively using it, so I receive toasts for newly created notifications without refreshing or switching accounts.

**Why this priority**: Enables US1. Without polling, toasts for backend notifications would never appear until the user manually refreshes or switches accounts. Can be built after the toast component exists, but must be done before US1 is complete.

**Independent Test**: Open the app, note the unseen count. Have an admin trigger a job that creates a notification. Wait up to 30 seconds. Verify the unseen count badge updates without page interaction and a toast appears.

**Acceptance Scenarios**:

1. **Given** an active account is selected, **When** the app mounts, **Then** a polling interval of 30 seconds begins fetching `fetchAgentNotifications()`
2. **Given** the poll response has `unseen_count > previous_unseen_count`, **When** the delta is computed, **Then** new notifications (where `is_seen === false` and created after last poll) are pushed to the toast queue
3. **Given** the user switches accounts, **When** the previous account loses focus, **Then** the polling interval is cleared and a new one starts for the newly selected account
4. **Given** the user is in the wizard (account linking), **When** the wizard is active, **Then** polling is paused (no account to check)

---

### User Story 4 — Toast Queue Management (Priority: P3)

As a developer and user, I want multiple simultaneous toasts to stack gracefully without overlapping and to respect a maximum visible limit so the viewport doesn't become overwhelmed.

**Why this priority**: Enhances US1 and US2. Without queue management, rapid-fire toasts would overlap or flood the screen. Lower priority because the base case (single toast) delivers most value.

**Independent Test**: Trigger 5 rapid `setStatus()` calls in succession. Verify only 3 toasts are visible at once, stacked vertically, each with its own timer and dismiss button.

**Acceptance Scenarios**:

1. **Given** a toast is already displayed and a new event triggers another toast, **When** the new toast is pushed, **Then** it appears below the existing toast (stacked vertically)
2. **Given** 3 toasts are currently visible and a 4th event triggers, **When** the new event arrives, **Then** the oldest toast is removed (dismissed early) and the new toast appears
3. **Given** a toast is in the queue, **When** its 5-second timer expires, **Then** it animates out (slide to right) and the remaining toasts shift up

---

### Edge Cases

- What happens when the browser tab is backgrounded and polling fires? Polls still run but toasts should not appear (document.visibilityState check). On tab focus, fetch immediately and show toasts for new notifications.
- What happens when a toast is shown and the user navigates to a different page? Toast queue persists across page navigation (it lives at the AppShell level, not per-page).
- How does the system handle very long notification titles/bodies? Truncate to 2 lines with CSS overflow ellipsis.
- What happens on mobile viewports? Toast appears full-width at the top instead of top-right corner, respecting safe-area insets.
- What about duplicate `setStatus()` calls with the same message? Deduplicate by message text — if a toast with the same text is already in the queue, don't add a duplicate.
- What if the API call to fetch notifications fails during polling? Silently retry on the next interval; do not show an error toast for polling failures.
- How does this interact with Telegram WebApp's viewport? The toast container must be inside the app's DOM tree (not a portal outside), with z-index above the sheet (1200+) but below any browser-level overlays.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a fixed-position toast container anchored to the top-right viewport corner (CSS `position: fixed; z-index: 1200+`)
- **FR-002**: System MUST auto-dismiss each toast after 5 seconds with a slide-out animation
- **FR-003**: Each toast MUST show: color-coded left border by kind (success=green, failure=clay/coral, info=blue-grey), title, body, timestamp, and a dismiss (×) button
- **FR-004**: System MUST poll for new notifications every 30 seconds when an active account is selected
- **FR-005**: When a `setStatus(message)` call occurs, System MUST route the message as a toast in addition to its existing inline display
- **FR-006**: On form validation failure, System MUST auto-scroll `scrollIntoView({ behavior: 'smooth', block: 'center' })` to the first invalid field
- **FR-007**: Toasts MUST stack vertically (newest at bottom of stack) with a maximum of 3 visible at once
- **FR-008**: Tapping/clicking a toast's body MUST open the `NotificationSheet` for notification toasts, or scroll to the first error for validation-error toasts
- **FR-009**: System MUST pause polling when the account wizard is active or no account is selected
- **FR-010**: Toasts MUST use the existing color system from `notificationTone()` and follow the design system (rounded corners, semi-transparent background, coral accents)
- **FR-011**: The inline `<Note>` and `<DismissibleStatus>` banners MUST remain as-is for non-scrolled contexts (they provide accessible inline feedback); toasts are additive

### Key Entities

- **Toast**: A transient UI element with `id`, `kind` (notification|error|success|info), `title`, `body`, `createdAt`, `notificationId` (optional link to backend notification), and `onAction` callback. Rendered in a queue anchored to the viewport.
- **ToastQueue**: State array managing active toasts (max 3 visible). Provides `push(toast)`, `dismiss(id)`, and `clear()` operations. Deduplicates by body text.

## Technical Design

### Component Architecture

```
AppShell
├── ToastContainer (new, position:fixed, z-index:1200+)
│   └── Toast[]  (each: slide-in animation, 5s auto-dismiss, × button, click handler)
├── NotificationSheet (existing, unchanged)
├── Bell icon + badge (existing, add polling useEffect)
└── Page Content
    └── (existing inline <Note>/<DismissibleStatus> — remain unchanged)
```

### Toast Type

```typescript
interface Toast {
  id: string           // unique ID (crypto.randomUUID or counter)
  kind: 'notification' | 'error' | 'success' | 'info'
  title: string
  body: string
  notificationId?: number  // link to backend AgentNotification
  createdAt: number         // Date.now()
  onAction?: () => void     // click handler (open sheet / scroll to error)
}
```

### ToastContainer Component

New file: `apps/miniapp-agents/src/components/ToastContainer.tsx`

Rendered once at the AppShell level (App.tsx), alongside the existing NotificationSheet. Communicates via a shared context or prop-drilled callbacks.

### Integration Points

| Source | Current Behavior | New Behavior |
|--------|-----------------|--------------|
| `setStatus(message)` | Inline `<DismissibleStatus>` or `<Note>` at top of scroll area | **Same inline element + toast at viewport** |
| `fetchAgentNotifications()` (poll) | Only fetches unseen count on mount | **30s poll + compute delta → push toasts** |
| Form validation: `if (!x) { setStatus('msg'); return }` | Error appears in inline banner, hidden if scrolled | **Toast + `scrollIntoView` on first invalid field** |
| NotificationSheet bell click | Opens sheet overlay | Unchanged (toasts are additive) |

### Color Coding

Reuse `notificationTone()` from App.tsx:633-656:

| Condition | Accent Color |
|-----------|-------------|
| `kind.includes('failed')` | `#a1573e` (clay/coral) |
| `kind.includes('completed')` or `kind.includes('queued')` | `#36664e` (sage green) |
| Default / `info` | `#475977` (slate blue) |

### CSS Animation

Slide-in from right:
```css
@keyframes toast-slide-in {
  from { transform: translateX(120%); opacity: 0; }
  to   { transform: translateX(0);   opacity: 1; }
}
@keyframes toast-slide-out {
  from { transform: translateX(0);   opacity: 1; }
  to   { transform: translateX(120%); opacity: 0; }
}
```

### Form Scroll-to-Error

Helper function `scrollToFirstInvalid()`:
1. Query inside the current page's form container for `[aria-invalid="true"]` or `input:invalid`
2. If none found, query for the first visible error `Note` or `DismissibleStatus` banner
3. Call `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`

### Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/miniapp-agents/src/components/ToastContainer.tsx` | **Create** | Toast container + individual Toast component |
| `apps/miniapp-agents/src/App.tsx` | **Modify** | Add ToastContainer to AppShell, add polling useEffect, route `setStatus` to toasts, wire scroll-to-error |
| `apps/miniapp-agents/src/features/leads/LeadsAcquisitionSection.tsx` | **Modify** | Pass invalid-field refs for scroll-to-error |
| `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` | **Modify** | Pass invalid-field refs for scroll-to-error |
| `apps/miniapp-agents/src/pages/CampaignsPage.tsx` | **Modify** | Pass invalid-field refs for scroll-to-error |

### Dependencies

- None (no new packages). Uses existing React hooks, CSS animations, and `agentsApi.fetchAgentNotifications`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every new backend notification results in a visible toast within 30 seconds (one poll cycle) while the app is open and an active account is selected
- **SC-002**: Form validation errors appear as a toast visible at the viewport within 200ms of the submit click
- **SC-003**: 0 reported cases of "I clicked submit and nothing happened" attributed to off-screen error messages
- **SC-004**: Bell icon unseen count updates within 30 seconds without manual page interaction

## Assumptions

- Polling at 30s intervals is acceptable for notifications; WebSocket push is not required for v1
- Browser support for `position: fixed`, CSS `@keyframes`, and `IntersectionObserver` (for visibilityState) is sufficient (all modern Telegram clients support this)
- The inline `<Note>` and `<DismissibleStatus>` components remain for accessibility and as fallback; toasts are additive, not replacements
- Form validation errors via `setStatus()` are always string messages, never React nodes
- The existing `AgentNotification` type and `fetchAgentNotifications` API are sufficient; no backend changes needed
- A shared toast context/state at the App.tsx level is preferred over a full React Context provider (simpler for the current architecture where App.tsx owns all top-level state)
