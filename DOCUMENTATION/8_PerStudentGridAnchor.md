# 8. Per-Student Grid Anchor (scoping doc)

**Status:** **IMPLEMENTED** Aug 11 2026. Kept as the rationale record — the
"what's broken" sections below describe the behavior *before* the fix.

**Problem:** the 4-year grid is anchored to a fixed calendar year (2024-25), not to
the student. Students who started in any other year get a degraded product, and
the degradation gets worse every year until an abrupt reset in Oct 2028.

---

## 1. What's broken today

All three verified against the running code, not inferred.

### 1a. Pre-2024 coursework is silently dropped

`gridBaseYear()` pins `year_index 0` to 2024-25 for every student.
`parseTermToCoordinates` returns `null` outside `year_index 0-3`, and
`convertAuditToPlanner` (auditCoursePlanner.js:227) drops those courses with no
user-visible message — the `console.log` is gated behind `isInProgressSection`.

```
FA21, SP22, FA22, SP23, FA23, SP24  ->  dropped
FA24 -> Year 1   FA25 -> Year 2   FA26 -> Year 3   FA27 -> Year 4
FA28 -> dropped
```

A student who started in 2022 uploads their audit and two years of completed
coursework simply is not there.

**Severity: display only.** The planner agent detects completed courses from
audit *text* (`_graded_from_audit`), not from the grid — a FA22/WI23 audit still
yields `['DSC 10/10R', 'DSC 20/20R']`, so those courses still block re-placement
and still satisfy prerequisites. The student sees an alarmingly empty grid; the
AI is not actually confused.

### 1b. "Year N" is a calendar row, not the student's year

A student starting Fall 2026 sees their first quarter under **"Year 3
2026-2027"**. The date range is correct; the "Year 3" is meaningless to them.

### 1c. The planning horizon decays — the real problem

The anchor is fixed but "today" moves, so the number of quarters the agent can
plan into shrinks each year:

| date | base | earliest placeable | quarters left |
|---|---|---|---|
| 2024-10-01 | 24 | Y1 fall | 12 of 12 |
| 2025-10-01 | 24 | Y2 fall | 9 of 12 |
| **2026-08-11** | **24** | **Y3 fall** | **6 of 12** |
| 2027-10-01 | 24 | Y4 fall | 3 of 12 |
| 2028-10-01 | 28 | Y1 fall | 12 of 12 |

**Today a first-year student can only plan 6 quarters — two years of a four-year
degree.** By late 2027 it is 3 quarters for everyone, then the FA28 re-anchor
snaps back to 12. A sawtooth, currently most of the way down the first tooth.

This is not cosmetic: the core promise is four-year planning, and a 2026
freshman structurally cannot get it.

---

## 2. Latent bug found while tracing (independent of cohorts)

There are **three independent sources of truth** for "what academic year is
`year_index` N", and only one of them re-anchors:

| source | used by | re-anchors at FA28? |
|---|---|---|
| `gridBaseYear()` / `grid_base_year()` | term→coordinate mapping, agent term math | **yes** |
| `PLAN_YEAR_LABELS` (academicCalendar.js:3) | Quarter View labels, `enrollmentPlanSlot` | **no** — hardcoded |
| `yearLabels` `useState` (CoursePlannerContainer.jsx:30) | planner year headers | **no** — hardcoded |

The two label arrays are duplicated by hand; academicCalendar.js:1 even carries a
"keep in sync" comment naming the other copies.

Consequence, verified:

```
2027-10-01 -> enrollmentPlanSlot: Year 4 fall
2028-10-01 -> enrollmentPlanSlot: null   <- Quarter View loses its slot entirely
```

In Oct 2028 `gridBaseYear` returns 28, but `PLAN_YEAR_LABELS` still says
2024-2025, so `enrollmentPlanSlot` finds no matching row and returns `null` —
while the planner headers still read "Year 1 2024-2025" for what is now 2028-29.

**This ships broken in Oct 2028 whether or not the cohort work happens.**
Collapsing the three sources into one is a prerequisite for the fix below and is
worth doing on its own.

---

## 3. Proposed design

Make the base year a **per-student value derived from their audit**, instead of a
global calendar constant.

### Where the base year comes from — RESOLVED against a real audit

Checked against an actual UCSD audit export (Aug 11 2026). **Use the header's
Catalog Year. Do not infer from coursework.**

The audit carries a student-info header the app currently ignores entirely:

```html
<div class="auditHeader verticalListing row">
  <div class="auditHeaderEntryLabel col-1"><h><b>Catalog Year</b></h></div>
  <div class="auditHeaderEntry col-3"><h>Fall 2024</h></div>
  ...
</div>
```

Fields present, in order: `Prepared On`, `Program Code`, `Catalog Year`, `PID`,
`Graduation Date`, `Job ID`. Parse by pairing `.auditHeaderEntryLabel` with the
following `.auditHeaderEntry` in document order.

- `Catalog Year` → **"Fall 2024"**. This is the anchor.
- `Graduation Date` was **empty** in the sample — do not depend on it.
- `.auditHeaderEntryLabel` occurs exactly 6 times in the document, only inside
  the student-info block, so the selector is unambiguous even though there are
  13 `.auditHeader` elements overall.

Convert season + year to a base year the same way term math does elsewhere:
fall → that year, winter/spring → the previous year (`"Fall 2024"` → `24`).

#### Why "earliest completed term" is wrong — measured, not theorized

The obvious fallback (earliest `term` on completed coursework, already parsed by
`parseCourseFromAuditItem` and today thrown away) **disagrees with the truth by
two years** on the sample audit:

| source | value |
|---|---|
| Catalog Year header | Fall 2024 ← correct |
| earliest completed term | **SP22** |

The pre-2024 rows are transfer and AP credit, posted under the term they were
earned rather than a term of UCSD enrollment:

```
SP22   BILD 1    grade TP   (transfer pass)
SP23   AP MS5    grade tP   (AP credit)
```

Anchoring on that would put this student's grid at 2022-2026 and push their
actual enrollment quarter (FA26) **off the bottom** — the exact failure mode
described for fifth-years in §4, triggered here by an ordinary four-year student
who merely arrived with AP credit. That is a large fraction of students.

A refined version (ignore `TP`/`AP`-graded rows) is possible but fragile, and
unnecessary now that the header field is confirmed present.

```
baseYear = auditCatalogYear      // from the header — confirmed present
           ?? gridBaseYear()     // no audit yet: current behavior
```

> **Note on why this bug went unnoticed:** the sample audit's Catalog Year is
> Fall 2024 — precisely the hardcoded launch anchor. The app was built and
> tested against a Fall 2024 student, for whom the fixed anchor is correct.

This fixes all three problems at once: pre-2024 coursework lands on the grid,
"Year 1" means the student's first year, and every cohort gets a full window.

### Single source of truth

Collapse `PLAN_YEAR_LABELS` and `CoursePlannerContainer.yearLabels` into one
derived function:

```js
yearLabelsFor(baseYear)  // 24 -> ["2024-2025", "2025-2026", ...]
```

Everything that today reads a hardcoded array reads this instead. `baseYear`
flows from one place (the audit, falling back to the calendar) into the labels,
the coordinate mapping, the enrollment slot, and the agent.

### Carrying it across sessions

The `baseYear` stamp already written by `stampGrid` (savedPlans.js) and
MainLayout is exactly the field this lives in. It is currently written as
`gridBaseYear()` and read by nothing, so changing *what gets written* is
contained. A restored plan uses its own stamped `baseYear`; `null` (pre-stamp
rows) means "assume the launch anchor", which is what those grids were built
with.

---

## 4. Open product decisions — needed before implementation

These are product calls, not code calls.

1. ~~**Students with more than 4 years of history.**~~ **DONE.** The grid grows:
   `yearCount = clamp(currentAcademicYear - baseYear + 1, 4, 8)`. A fifth-year
   gets 5 rows and keeps the quarter they're enrolling in. Capped at 8 so a
   garbled catalog year can't produce hundreds of rows.

   Growing the grid replaced the earlier plan of clamping `baseYear` forward:
   no coursework is dropped at all, so the clamp is unnecessary.
2. **Transfer students.** A junior transfer's "Year 1" is their first year *at
   UCSD*, but their audit contains transfer credit with non-UCSD or absent terms.
   Does the grid start at their UCSD entry (likely yes) and transfer credit live
   outside the grid entirely?
3. **No audit uploaded.** Fall back to `gridBaseYear()` (today's behavior), or
   ask the student their start year? Falling back is fine, but the grid must
   re-anchor when an audit arrives — which means a grid rebuild, and
   `auditUploadKey` already exists for exactly that.
   **Also needed: what if an audit has no Catalog Year?** Only one export has
   been inspected. Falling back to `gridBaseYear()` is safe; falling back to
   earliest-completed-term is not (see §3).
4. **Existing saved plans.** Re-anchoring changes what `year_index` means. Plans
   stamped with a `baseYear` can be migrated; `null`-stamped ones must be assumed
   to be launch-anchored.

---

## 5. Change list

| file | change |
|---|---|
| `components/audit/SidebarAuditTracker.jsx` | parse `.auditHeaderEntryLabel`/`.auditHeaderEntry` pairs for Catalog Year into `metadata.catalogYear`; today nothing reads that region |
| `utils/auditCoursePlanner.js` | `gridBaseYear` gains an audit-derived path with the `currentAcademicYear - 3` clamp; `parseTermToCoordinates` takes `baseYear` as a param instead of computing it; add `yearLabelsFor(baseYear)`; `convertAuditToPlanner` surfaces dropped-course count instead of silently returning |
| `utils/academicCalendar.js` | delete `PLAN_YEAR_LABELS`; `enrollmentPlanSlot` takes `baseYear` |
| `components/planner/CoursePlannerContainer.jsx` | delete the hardcoded `yearLabels` `useState`; take labels from context/props |
| `components/QuarterlyView.jsx` | drop local `YEAR_LABELS` alias; read derived labels |
| `components/MainLayout.jsx` | own the derived `baseYear`, pass it down, write the real value into the save payload, re-anchor on `auditUploadKey` bump |
| `utils/savedPlans.js` | already stamps `baseYear`; write the derived value, and use the stamp on restore |
| `app/planner_agent.py` | `grid_base_year` / `next_enrollable_term` accept an explicit base year; `plan_chat` takes it from the request |
| `app/main.py` | `ChatRequest` gains `base_year` |
| `components/right-sidebar/RightSidebar.jsx` | send `base_year` with the chat request |

Both `grid_base_year` implementations are already mirrored JS↔Python with the
boundary pinned by tests on both sides, so there is one clear seam rather than a
hunt.

---

## 6. Risk

- **Blast radius is wide but shallow.** ~9 files, mostly threading one value.
  Nothing here is algorithmically hard; the risk is a missed consumer silently
  keeping the old anchor — which is precisely the bug class that produced the
  three-sources-of-truth problem in the first place.
- **Grid rebuild on audit upload** is the sharp edge: re-anchoring after a plan
  exists must not discard user placements. `auditUploadKey` already distinguishes
  a real upload from a restore, so the hook exists.
- **The agent and the client must agree.** They are separate implementations of
  the same term math; if `base_year` isn't threaded to FastAPI, the agent will
  place courses into the wrong rows. This is the highest-consequence step and
  needs a test on both sides.

---

## 7. Effort

**Not a simple fix — roughly a day, plus the product decisions in §4.**

The mechanism is simple (derive one number instead of hardcoding it). The work is
that the number is currently assumed-constant in three places across two
languages, and one of those places is duplicated by hand.

Suggested split — the first is independently valuable and unblocks the rest:

1. **Collapse the three sources into one derived from `gridBaseYear`.** No
   behavior change today, fixes the Oct 2028 Quarter View breakage. ~2 hours.
2. **Parse Catalog Year from the audit header and thread `baseYear` through the
   client.** ~half a day. The parsing itself is small and now fully specified;
   the time is in threading and the grid-rebuild-on-upload path.
3. **Thread `base_year` to the planner agent.** ~2 hours, needs tests both sides.
