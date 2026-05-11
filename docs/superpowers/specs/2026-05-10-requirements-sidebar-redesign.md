# Requirements Sidebar Redesign

**Date:** 2026-05-10  
**Status:** Approved

## Problem

The degree audit sidebar (`SidebarAuditTracker`) has three core UI problems:

1. **Stats are too bulky** — 4 separately colored cards stacked vertically (units, completed, in progress, remaining) consume a large portion of the sidebar before the requirements list even appears.
2. **Upload zone stays dominant after loading** — the large dashed drop zone remains prominent even once an audit is already loaded, wasting vertical space permanently.
3. **Accordion sections feel dated** — plain text ▶/▼ toggles, a small colored dot that duplicates the badge, and a redundant "Status: FULFILLED" footer inside the expanded panel.

## Approach

**Component split (Approach B).** Extract a `ProgressSummary` component for the stats block; restyle `AuditAccordionSection` in place. The HTML parsing logic stays untouched inside `SidebarAuditTracker`. Delete two unused `AuditSectionBlock.jsx` files.

## Component Changes

### New: `ProgressSummary.jsx`

Location: `mern/client/src/components/audit/ProgressSummary.jsx`

**Props:**
```ts
{
  fulfilled: number,
  inProgress: number,
  notFulfilled: number,
  unitsCompleted: number | undefined,
  totalSections: number
}
```

**Renders:**
- A thin progress bar (height 7px, rounded) filled to `fulfilled / totalSections * 100%` with a green gradient.
- Four pill badges below the bar:
  - `✓ N done` — green (`bg-green-100 text-green-800`)
  - `⏳ N in progress` — yellow (`bg-yellow-50 text-yellow-800`)
  - `✗ N remaining` — red (`bg-red-100 text-red-800`)
  - `📚 N units` — purple (`bg-violet-100 text-violet-800`), only rendered when `unitsCompleted` is defined
- No internal state. Pure display component.

### Modified: `SidebarAuditTracker.jsx`

**Upload area behavior:**
- When `auditSections.length === 0`: show the existing full dashed upload zone (unchanged).
- When `auditSections.length > 0`: hide the upload zone entirely; show a small outlined "↑ Replace audit" button inline in the header row, next to the "Graduation Progress" title.

**Stats block:**
- Remove the four colored card divs and the separate "Overall Progress" card.
- Replace with `<ProgressSummary>` receiving `fulfilled`, `inProgress`, `notFulfilled`, `unitsCompleted`, and `totalSections` derived from existing `statusCounts` and `auditData.metadata`.

**Everything else** (parsing logic, `handleFileUpload`, state, error/loading display, section list rendering) is unchanged.

### Modified: `AuditAccordionSection.jsx`

**Header row (always visible):**
- Left border: `border-l-[3px]` colored by status — green / yellow / red.
- SVG chevron (`▼` rotated 180° when expanded, `▼` at rest) replacing the text ▶/▼.
- Title text (unchanged).
- Right side: a pill badge — "Done" (green), "In Progress" (yellow), "Remaining" (red).
- Remove: the small colored dot (`w-3 h-3 rounded-full`).

**Expanded panel:**
- Keep the existing course item rendering (green bg for completed grades, white bg for needs/WIP).
- Remove: the "Status: FULFILLED / IN PROGRESS / NOT FULFILLED" footer block entirely.

### Deleted files

- `mern/client/src/components/audit/AuditSectionBlock.jsx` — unused
- `mern/client/src/components/AuditSectionBlock.jsx` — unused duplicate

## File Summary

| File | Action |
|---|---|
| `components/audit/ProgressSummary.jsx` | Create |
| `components/audit/SidebarAuditTracker.jsx` | Modify (upload behavior + stats block) |
| `components/audit/AuditAccordionSection.jsx` | Modify (header row + remove footer) |
| `components/audit/AuditSectionBlock.jsx` | Delete |
| `components/AuditSectionBlock.jsx` | Delete |

## Out of Scope

- Course item text formatting (raw string display unchanged — not a selected pain point).
- Parsing logic in `SidebarAuditTracker` — no changes.
- `LeftSidebar.jsx` — no changes needed.
- `auditParser.js` — no changes needed.
