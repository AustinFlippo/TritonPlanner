# TritonPlanner Booking Bridge

Carries a TritonPlanner schedule into **TSS** (UCSD's SAP-based Triton Student
System) so a planned quarter can actually be booked.

Self-contained: everything lives under `booking-bridge/`. No existing
TritonPlanner file is modified.

---

## Why it's built this way

Three findings forced the architecture. They're worth stating because they rule
out the obvious designs.

**1. WebReg is gone.** TSS replaced it in mid-July 2026, running SAP Student
Lifecycle Management behind a Fiori front end (`sis.ucsd.edu` → `tss.ucsd.edu/fiori`).
Every WebReg bot on GitHub targets endpoints that no longer exist.

**2. Section data is not publicly reachable.** The legacy Schedule of Classes at
`act.ucsd.edu` still responds, but its term list stops at Summer 2026 — there is
no Fall 2026. Verified:

```
term options: SA26, SU26, S326, ... | has FA26: false
```

Current section data exists **only inside TSS, behind SSO + Duo**. So a server-side
scraper is impossible, and TritonPlanner's backend can never see sections on its own.

**3. TSS sessions are fragile.** UCSD's own booking guide warns that merely having
two TSS tabs open "can cause errors, lock you out of your account, or freeze your
registration." That's SAP stateful session handling, and it means synthetic clicks
fired at a control mid-round-trip can leave a booking half-committed.

Together these mean the only viable bridge is **code running inside the student's
own authenticated browser session** — hence a Chrome extension, not a backend
service and not a headless bot.

---

## What it does

```
TritonPlanner (localhost)                 Chrome extension                TSS (tss.ucsd.edu)
────────────────────────                  ────────────────                ──────────────────
4-year grid
  │
  ├─ buildBookingPlan() ──── plan ──────► chrome.storage
  │   ranks by dependency                     │
  │   depth, scarcity, seats                  ├──► on-page panel ──► highlights + prefills
  │                                           │                       grading, credit hours
  │                                           │
  └──◄──── section data ◄──── merged ◄────────┴──◄─ OData: times, seats, staff
```

**The ranking is the actual product.** Given a term's courses it computes, for each
one, how many *other courses in your own plan* it transitively unlocks. Against the
real 7,333-course catalog, on a standard CS lower-div plan:

| Course | Unlocks | Offered |
|---|---|---|
| CSE 8A | 6 | FA/WI/SP |
| CSE 8B | 5 | WI/SP |
| MATH 20A | 2 | FA/WI/SP |
| CSE 30 | 0 | FA/WI/SP |
| MATH 20C | 0 | FA/WI/SP |

That ordering is not obvious from the course list, and it's what should drive an
11.5-unit first pass. Combined with offering scarcity and live seat pressure, it
decides what to secure first and what to defer to second pass.

Also handles: the 11.5 / 19.5 / 22-unit caps, time-conflict detection across linked
lecture+discussion packages, automatic fallback to a non-conflicting alternate
section, and warnings when a course isn't normally offered in the term you placed it.

---

## Why you press the final button

The panel does everything up to the commit — ranks the courses, finds the section,
prefills grading option and credit hours, scrolls the Book/Save button into view and
highlights it. **You press it.**

That's not timidity, it's the finding in #3 above. The account that gets frozen by a
mis-fired synthetic click is yours, during a two-day window, with no undo. You keep
the entire speed benefit — no searching, no deciding under pressure, no tab-hopping —
without betting an enrollment window on a selector guess.

Worth knowing, separately: **TSS waitlists auto-enroll in real time.** When a seat
opens you're moved in automatically, and waitlisted units count against your cap. So
the thing worth optimizing is *waitlist position and section choice*, not reaction
speed at a refresh. Racing the clock optimizes a variable TSS already handles.

---

## Status

| Piece | State |
|---|---|
| Plan builder + catalog logic | **Working**, 28 unit tests passing |
| Text parsers (days, times, status) | **Working**, tested against the shipped file |
| Adapter (resolve + prefill, booking screens) | **Working**, 10 assertions in a real browser DOM |
| Extension skeleton, panel, storage | **Working** |
| Admin page (refresh + freshness) | **Working** — `admin/admin.html` |
| Quarter View week calendar | **Working** — reads sections live, verified in the app |
| OData client | **Schema mapped from live TSS; 29 offline assertions passing** |
| TSS panel | **Simplified** — prepare + check result; capture only while selectors unverified |
| **TSS selectors** | **Placeholders — needs one capture from you** |

### OData

`content/odata.js` reads sections from TSS's own data service instead of its HTML.
The service root is confirmed from a signed-in capture (2026-08-10):

```
/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001
```

It needs no results table on screen, so it works without a search or scrolling, and
it returns typed JSON rather than markup that Fiori redesigns will break.

Section data lives across three tables, joined on `ModuleID`:

| Table | Carries |
|---|---|
| `YUCSD_CON_MODULE` | `CourseAbbr`, `CourseTitle`, credits, term → `ModuleID` |
| `YUCSD_CON_EVENTS` | `TeachingMethod` (LE/DI/LA), `InstructorName`, `locationText`, package seat counts |
| `YUCSD_CON_MODULE_SCHED` | numeric `DoW` + typed `BeginTime`/`EndTime`, joined by `SectionId` == `EventObjid` |

Three things worth knowing, all learned the hard way:

- **`ModuleID` is not a course code.** It is an internal sequence number (`"4"`).
  The course code is `CourseAbbr`, and TSS zero-pads it (`AAS-010R`) while the
  catalog does not (`AAS 10R`) — `normalizeCourseId` strips the padding, or
  nothing matches a planned course.
- **`YUCSD_CON_MODULE.seatsAvailable` is a `"Y"`/`"N"` flag**, not a count. Real
  counts are `EventPkgLimit` / `EventPkgSeatsAvailable` / `EventPkgNumOnWaitl` on
  the event row, and they belong to the *package*, so a lecture and its
  discussion legitimately report the same numbers.
- **Events sharing an `EventPkgOtjid` are one enrollable package.** That is how a
  lecture is tied to its discussion — no same-letter heuristic needed.

The term filter runs client-side on each row's own `AcademicYear_Text` /
`AcademicPeriod_Text`, and the period code for the events query is taken from the
course rows that matched. An earlier version filtered server-side on a period code
looked up from another table, where the last "Fall" match won — one stray row made
every query return empty while the courses plainly existed in that term.

Offline coverage: `http://localhost:5188/fixtures/mock-odata.html` — 29 assertions
over stubs copied verbatim from a live dump. Schema re-dumps (`selfTest` /
`exploreAll`) stay in `odata.js` for console use if TSS changes; they are not
in the panel.

### Page scraping is retired

`content/autoscrape.js` and the adapter's `scrapeSchedule()` are **deleted**.
Section data comes only from OData. The service worker prunes termless leftover
rows on install and on startup.

Everything is verified except the one thing that can only come from a signed-in
session. `selectors.js` currently guesses at Fiori conventions; those guesses are
isolated in that single file so filling them in touches no logic.

---

## After every change to the extension

Reload it in `chrome://extensions` (the ↻ on its card) **and reload any open TSS
tab**. Chrome does not re-inject content scripts into pages that are already open;
the old ones keep running with their extension bridge severed, so `chrome.runtime`
becomes undefined and every call fails with a stack trace that says nothing useful.
`content/runtime.js` detects that state and the panel says "reload the page" instead
— but the page still has to be reloaded.

---

## What I need from you

**One capture on the booking screen.** Takes about a minute.

1. Load the extension: Chrome → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select `booking-bridge/extension/`.
2. Sign in at `sis.ucsd.edu` as normal (your password and Duo code never touch the
   extension).
3. Open a course’s **booking screen** (where Book/Save appears).
4. In the TritonPlanner panel (top-right), click **Capture page structure**
   (shown only while selectors are unverified). Label it `booking-screen`.
5. The JSON file lands in your Downloads. Send it.

**They contain no personal data.** The capture keeps structure — tags, element ids,
SAP UI5 control types, and short UI labels like "Book/Save". It scrubs emails,
student numbers, any digit run of 7+, and any text longer than 60 characters, which
is where record data lives. Course codes are kept deliberately, since they anchor
selectors. Read `extension/content/capture.js` if you want to confirm before running it.

With those two files I can write real selectors and the bridge goes live end to end.

---

## Running the tests

```bash
cd booking-bridge && npm test
```

Browser-DOM adapter test: start the `booking-bridge-fixtures` preview server, open
`http://localhost:5188/fixtures/mock-tss.html` (booking controls) and
`http://localhost:5188/fixtures/mock-odata.html` (the OData client, 29 assertions
over stubs copied from a live entity dump).

---

## Wiring it into the React app

**Section data is wired.** Quarter View imports `isBridgeInstalled`,
`requestScrapedSections`, and `subscribeToSections`, and renders the week calendar
from whatever the extension has captured. Nothing further is needed for that path.

**Booking plans are not wired** — sending a plan still needs a button in the
planner. One import and one handler:

```js
import { planAndSend } from "../../../booking-bridge/core/plannerBridge.js";
import catalogJson from "../../server/controllers/v5.json";

const result = await planAndSend({
  grid: schedule,          // CoursePlannerContainer's state
  yearIndex: 2,
  term: "fall",
  termCode: "FA26",
  catalogJson,
  pass: 1,
});
// result.plan.steps    -> ordered courses with sections and reasoning
// result.plan.deferred -> what didn't fit under the cap, and why
// result.delivered     -> whether the extension received it
```

---

## Policy

This automates *your own* enrollment in *your own* session, and stops short of
submitting. That's meaningfully different from a bot, but it is not a ruling —
UCSD's [PPM 135-9](https://adminrecords.ucsd.edu/ppm/docs/135-9.html) is broad and
doesn't address registration tooling directly, while peer institutions ban
registration scripts by name.

Before this goes to anyone but you, ask the Registrar or ITS whether assistive
booking tools are permitted. If you distribute it and the answer turns out to be no,
you own that outcome for every student who installed it.

---

## Layout

```
booking-bridge/
├── core/                      # pure logic, no DOM — runs in Node and the browser
│   ├── catalog.js             # id normalization, credits, prereq graph, scarcity
│   ├── bookingPlan.js         # ranking, unit caps, conflicts, fallbacks
│   ├── plannerBridge.js       # React-side connector
│   ├── bookingPlan.test.mjs   # 22 tests
│   └── parsing.test.mjs       # 7 tests, evaluates the shipped parser file
├── extension/
│   ├── manifest.json
│   ├── background.js          # plan + section storage; makes no network calls
│   ├── content/
│   │   ├── selectors.js       # ← ALL TSS DOM knowledge, currently placeholders
│   │   ├── parsing.js         # pure text parsers
│   │   ├── capture.js         # privacy-safe structural capture
│   │   ├── ui5-probe.js       # page-world SAP UI5 control tree reader
│   │   ├── adapter.js         # resolve + prefill (booking screens only)
│   │   ├── odata.js           # section fetch: the three-table join
│   │   ├── overlay.js         # the on-page panel
│   │   └── planner-bridge.js  # relays events from localhost
│   ├── popup/                 # status + a way into the admin page
│   └── admin/                 # refresh seat counts, freshness, activity log
└── fixtures/
    ├── mock-tss.html          # booking-control assertions
    └── mock-odata.html        # 29 assertions over the OData client
```

---

## Admin page

`chrome://extensions` → **Details** → **Extension options**, or the popup's
**Manage section data** button.

It shows how old the stored section data is, one row per tracked course, and a
recent activity log. **Refresh seat counts** re-reads every course already in
storage, grouped by term. **Clear all** wipes the local copy (everything is
re-fetchable).

This exists for the two weeks a year that matter. Times and instructors barely
move once a schedule publishes; seat counts change by the minute during
enrollment. A course whose sections report no seat figure shows `—` rather than
`0`, because those are different facts.
