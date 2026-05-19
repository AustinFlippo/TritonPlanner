# TritonPlanner UI Redesign

**Date:** 2026-05-12
**Branch:** testing
**Scope:** Full visual redesign of the planner page. Storage and Quarter View pages are out of scope.

---

## Goals

Replace the plain, unpolished UI with a cohesive UCSD-branded design. The layout structure stays the same (3 panels); the changes are: a new color system, a branded header, collapsible sidebars, a course detail overlay on click, and planner grid polish.

---

## Color System

| Token | Hex | Usage |
|---|---|---|
| `navy` | `#003366` | Header bar, sidebar section headers, primary headings |
| `blue` | `#0066cc` | Active/selected states, links, primary buttons, progress bar fill |
| `sky` | `#7db8e8` | Logo side prongs, secondary accents |
| `surface` | `#f8fafc` | Page/planner background |
| `card` | `#ffffff` | Panel backgrounds, course cards |
| `border` | `#e2e8f0` | Dividers, card outlines |
| `text-primary` | `#003366` | Main text |
| `text-secondary` | `#64748b` | Subtitles, metadata |
| `text-muted` | `#94a3b8` | Placeholders, hints |

Course card status colors (unchanged logic, refined values):

| Status | Background | Border/accent |
|---|---|---|
| completed | `#dcfce7` | `#16a34a` |
| in-progress | `#fef9c3` | `#ca8a04` |
| planned | `#e0f0ff` | `#0066cc` |
| empty slot | `#f1f5f9` | `#cbd5e1` dashed |

---

## Header

**Height:** ~44px  
**Background:** `#003366` (navy)

**Left side:** Minimal trident SVG logo + "TritonPlanner" wordmark.
- Logo: three geometric prongs — center prong in white (taller), side prongs in `#7db8e8` (shorter). Cross-bar connecting them in sky blue. No fill background — logo sits directly on the navy header.
- Wordmark: "Triton" in `font-weight: 800`, "Planner" in `font-weight: 300`, both white, ~18px. Side by side.

**Right side:** Empty for now (reserved for future user profile / settings).

Replaces the current `<header className="bg-blue-500 text-white p-3 text-xl font-bold">` in `Header.jsx`.

---

## Left Sidebar — Audit Requirements

Functionally identical to the current `SidebarAuditTracker`. Visual changes only, plus collapsible behavior.

**Expanded state (default):**
- Section header: navy background (`#003366`), white "REQUIREMENTS" label (8px, 700 weight, letter-spaced), collapse arrow `◀` on the right in `rgba(255,255,255,0.6)`.
- Body, progress bar, accordion sections: unchanged from the `testing` branch redesign already shipped.
- "↑ Replace audit" button at the bottom: unchanged.
- Resize handle: unchanged.

**Collapsed state:**
- Sidebar shrinks to a 28px-wide navy strip.
- Contents: expand arrow `▶` at top, rotated "REQUIREMENTS" text label below it (vertical, faded).
- Clicking the strip (or the arrow) re-expands to the last width.
- Collapse state stored in local React state (not persisted to localStorage).

**Component:** `LeftSidebar.jsx` — add collapse state, conditional width, and collapsed strip render.

---

## Right Sidebar — Search + Chat

Two stacked collapsible sections. Each has a navy header bar with a label and chevron. Both can be independently collapsed.

**Search panel (top):**
- Header: navy, "SEARCH" label, `▾` chevron (rotates to `▸` when collapsed).
- Body: existing `CourseSearch` component, unstyled changes.
- Collapsed: only the navy header bar is visible (~32px).
- Drag-to-planner from search results continues to work.

**AI Assistant panel (bottom):**
- Header: navy, "AI ASSISTANT" label, `▾` chevron.
- Body: existing `CourseAssistant` component.
- Takes `flex: 1` — fills remaining height after Search.
- Collapsed: only the header bar visible.

**Component:** `RightSidebar.jsx` — add `searchCollapsed` and `chatCollapsed` boolean states. Replace tab markup with stacked section markup.

---

## Course Detail Overlay

When the user clicks any course card in the planner grid, a detail panel slides over the right sidebar.

**Trigger:** `onClick` on `CourseCard`. Fires `onCourseClick(course)` up to `CoursePlannerContainer` → passed to `MainLayout` → passed as `selectedCourse` prop to `RightSidebar`.

**Dismiss:** clicking anywhere on the planner (the `CoursePlannerContainer` wrapper div gets an `onClick` that clears `selectedCourse`), or clicking the `✕` button in the overlay. `CourseCard`'s `onClick` must call `e.stopPropagation()` so the card click doesn't immediately bubble up and clear the selection.

**Overlay appearance:**
- Absolutely positioned over the right sidebar panel, `inset: 0`, white background, `z-index: 10`.
- Left border: 3px solid `#0066cc`.
- Slide-in animation: `transform: translateX(100%)` → `translateX(0)` on mount (CSS transition, ~200ms).

**Overlay content (top to bottom):**
1. **Header:** Course ID (bold navy, 14px), course name if available (secondary text, 10px), offering quarters as sky-blue pills if available, units pill, `✕` dismiss button top-right.
2. **Requirements satisfied:** Cross-reference `course.course_id` against `parsedCourseData.sections` — each section has an `items` array with `courseId` fields. Show a green block for each section whose items include this course. If no audit data loaded or no match: show "Upload an audit to see requirement matches."
3. **Prerequisites:** Show `course.prerequisites` string if present on the course object (available for search-sourced courses). If absent (audit-sourced course): omit this section.
4. **Top professors:** Show up to 2 entries from `course.professors` array using existing `ProfessorInfo` component. If `course.professors` is absent or empty (audit-sourced courses): omit this section.
5. **Description:** Show `course.description` (cleaned, same logic as `CourseDetails.jsx`) if present. If absent: omit.
6. **Footer:** "Click planner to dismiss" hint in muted text.

**Data availability:** Courses have two sources with different data shapes. Audit-sourced courses (placed by upload) only have `course_id`, `credits`, `status`, `grade` — sections 3–5 are omitted for these. Search-sourced courses (dragged from right sidebar) carry full data including `professors`, `description`, `offerings`, `prerequisites`. The overlay renders gracefully either way — section 2 (requirements) works for both since it uses `parsedCourseData`, not the course object itself.

**New component:** `CourseDetailOverlay.jsx` in `src/components/planner/`.

---

## Planner Grid — Aesthetic Polish

No structural changes. `CoursePlannerContainer`, `CoursePlanner`, `YearBlock`, `TermBlock` keep their current logic.

Visual changes:
- Page background: `#f8fafc` instead of white.
- Year header rows: navy text (`#003366`), `font-weight: 700`, smaller (13px).
- Year collapse toggle: replace current implementation with the same SVG rotating chevron pattern used in `AuditAccordionSection`.
- Term column blocks: white background, `border: 1px solid #e2e8f0`, `border-radius: 8px`, `padding: 12px`.
- Term label ("FALL", "WINTER", "SPRING"): 7px, 700 weight, navy, `letter-spacing: 0.5px`, uppercase.
- Term unit count badge: sky-blue pill, same style as progress summary badges.
- Course cards: apply status colors from the color system table above. `border-radius: 6px`. Remove emoji status indicators (`✓`, `⟳`, `📅`) — replace with the left border color as the sole status signal.
- Empty slot: `background: #f1f5f9`, `border: 1px dashed #cbd5e1`, "drag here" hint in muted text.
- Invalid drop flash: keep existing logic, restyle flash color to `#fee2e2`.

---

## Implementation Approach

CSS-only polish + targeted structural additions. No rewiring of drag-and-drop, resize, or audit logic.

**Files touched:**
- `Header.jsx` — full rewrite (simple, ~20 lines)
- `LeftSidebar.jsx` — add collapse state + collapsed strip render
- `RightSidebar.jsx` — replace tabs with stacked collapsible sections
- `CourseCard.jsx` — restyle only
- `CoursePlanner.jsx` / `YearBlock.jsx` / `TermBlock.jsx` — restyle only
- `MainLayout.jsx` — add `selectedCourse` state, wire `onCourseClick` down to planner, pass to right sidebar
- `CourseDetailOverlay.jsx` — new component

**Files unchanged:**
- All audit components (`SidebarAuditTracker`, `AuditAccordionSection`, `ProgressSummary`)
- `CourseSearch.jsx`, `CourseAssistant.jsx`, `CourseDetails.jsx`, `ProfessorInfo.jsx`
- All backend files

---

## Out of Scope

- `CourseStorage.jsx` and `QuarterlyView.jsx` — stubs, not being built
- Navigation between pages — single-page app for now, no nav needed
- Dark mode
- Mobile/responsive layout
- Persisting collapse state across sessions
