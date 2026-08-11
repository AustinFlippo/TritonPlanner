/**
 * Reads section data from TSS's OData service instead of its HTML.
 *
 * The service root came from a signed-in capture (2026-08-10): the app's own
 * requests go to
 *
 *   /sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/$batch
 *
 * Everything before `$batch` is the service root. This runs as a content script
 * on tss.ucsd.edu, so requests are same-origin and the student's existing
 * session cookie is attached by the browser — no credentials pass through this
 * extension, and nothing is stored.
 *
 * Why this exists alongside the DOM scraper:
 *  - It does not need the results table to be on screen, so it works without
 *    the student running a search or scrolling.
 *  - It returns typed JSON, so it survives the Fiori markup changes that
 *    eventually break every CSS selector.
 *
 * Nothing here is hardcoded to field names I guessed. The service publishes its
 * own schema at $metadata; we read that, pick the entity set, and map its real
 * property names onto our section shape through the alias table below — the
 * same approach the DOM scraper uses for column headers, for the same reason:
 * SAP vocabulary ("Module" for course, "Event" for section) is not guessable
 * and does change.
 *
 * STATUS: unverified against live TSS. It is written from a confirmed URL and
 * confirmed filter-field names, but the entity set and its properties have not
 * been read yet — that needs one signed-in run. `selfTest()` reports exactly
 * what it found so the gap closes in one click rather than one guess.
 */

(() => {
  const SERVICE_ROOT =
    "https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb" +
    "/srvd/sap/yucsd_con_module_servicedef/0001";
  const CLIENT = "sap-client=500";

  /**
   * Our field name -> candidate OData property names, most likely first.
   *
   * The lowercase names (seatsAvailable, wishlisted) are confirmed from the
   * live filter bar; the rest follow SAP's naming for this entity and are
   * matched case-insensitively, so a near miss still resolves.
   */
  const FIELD_ALIASES = {
    // Confirmed from a live $metadata + sample record (2026-08-10). Note
    // `CourseAbbr` ("AAS-010R"), not `ModuleID` — ModuleID is an internal
    // sequence number ("4"), not a course code.
    courseId: ["CourseAbbr", "Module", "CourseID", "Course"],
    courseName: ["CourseTitle", "Description", "ModuleName", "ModuleText"],
    sectionId: ["EventID", "EventId", "Event", "SectionID"],
    component: ["EventType", "EventCategory", "ModuleEventType", "Type"],
    days: ["DoW", "DayOfWeek", "DaysOfWeek", "MeetingDays"],
    timeRange: ["MeetingTime", "EventTime", "TimeRange"],
    startTime: ["StartTime", "EventStartTime", "MeetingStartTime", "BeginTime"],
    endTime: ["EndTime", "EventEndTime", "MeetingEndTime"],
    instructor: ["Instructor", "InstructorName", "Lecturer", "TeachingStaff"],
    building: ["Building", "BuildingText"],
    room: ["Room", "RoomText", "Location"],
    // On YUCSD_CON_MODULE this is a "Y"/"N" *flag*, not a count — the real
    // counts live on the event-level entity. toSection() guards against
    // rendering "Y seats".
    seatsAvailable: ["seatsAvailable", "SeatsAvailable", "AvailableSeats"],
    seatsTotal: ["Capacity", "MaxCapacity", "TotalSeats", "OptimumCapacity"],
    units: ["CreditsDisplay", "MinimumCredits", "Credits", "CreditPoints", "Units"],
    unitsMin: ["MinimumCredits"],
    unitsMax: ["MaximumCredits"],
    term: ["AcademicPeriod", "AcademicPeriod_Text", "Term"],
    termKey: ["Persl"], // compact SAP period key, e.g. "26FA" for Fall 2026
    year: ["AcademicYear"],
    level: ["AcademicLevel", "AcademicLevel2"],
    modality: ["DeliveryMode", "DeliveryMode_Text", "Modality"],
    department: ["DepartmentText", "DepartmentAbbr", "Department"],
  };

  /**
   * How the service is actually laid out, confirmed from a full entity-set dump
   * (2026-08-10). Section data is spread across three tables joined on ModuleID:
   *
   *   YUCSD_CON_MODULE        course row: CourseAbbr, CourseTitle, credits,
   *                           AcademicYear/AcademicPeriod -> ModuleID
   *   YUCSD_CON_EVENTS        one row per meeting: TeachingMethod (LE/DI/LA),
   *                           InstructorName, locationText, Sched, and the
   *                           package seat counts. Events sharing an
   *                           EventPkgOtjid are one enrollable package — this is
   *                           how a lecture is tied to its discussion.
   *   YUCSD_CON_MODULE_SCHED  structured meeting pattern: numeric DoW plus
   *                           BeginTime/EndTime, joined to an event by
   *                           SectionId == EventObjid.
   *
   * Times are taken from MODULE_SCHED where possible: they are typed values
   * rather than the "Tu, Th 05:00 PM - 06:20 PM Live Online" string, which is
   * assembled for display and is a parsing liability.
   */
  const SETS = {
    module: "YUCSD_CON_MODULE",
    events: "YUCSD_CON_EVENTS",
    sched: "YUCSD_CON_MODULE_SCHED",
  };

  // SAP numbers the days from Monday; confirmed by DoWText ("2 Tuesday",
  // "3 Wednesday"). R = Thursday, matching the rest of TritonPlanner.
  const DOW_LETTERS = { 1: "M", 2: "T", 3: "W", 4: "R", 5: "F", 6: "S", 7: "S" };

  let schema = null; // { entitySet, properties: string[] }

  const url = (path, query = "") =>
    `${SERVICE_ROOT}/${path}?${CLIENT}${query ? `&${query}` : ""}`;

  async function getJson(target) {
    const response = await fetch(target, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      // A 401/403 here means the SSO session lapsed, not that the URL is wrong.
      throw new Error(`${response.status} ${response.statusText} for ${target}`);
    }
    return response.json();
  }

  /**
   * Read the service's own schema.
   *
   * $metadata is XML even on a JSON service, so this parses it with DOMParser
   * rather than regex — attribute order and self-closing forms vary between
   * SAP releases and would quietly break a pattern match.
   */
  async function loadSchema() {
    if (schema) return schema;

    const response = await fetch(url("$metadata"), { credentials: "include" });
    if (!response.ok) {
      throw new Error(`$metadata returned ${response.status} ${response.statusText}`);
    }
    const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("$metadata was not valid XML");

    const sets = [...doc.querySelectorAll("EntitySet")].map((node) => ({
      name: node.getAttribute("Name"),
      type: (node.getAttribute("EntityType") || "").split(".").pop(),
    }));
    if (!sets.length) throw new Error("$metadata listed no entity sets");

    // Prefer the set whose entity type is the module/section entity the
    // Schedule of Classes app is built on; fall back to the only one there is.
    const preferred =
      sets.find((s) => /module/i.test(s.type) || /module/i.test(s.name)) || sets[0];

    const entityType = [...doc.querySelectorAll("EntityType")].find(
      (node) => node.getAttribute("Name") === preferred.type
    );
    const properties = entityType
      ? [...entityType.querySelectorAll("Property")].map((p) => p.getAttribute("Name"))
      : [];

    schema = { entitySet: preferred.name, entityType: preferred.type, properties, allSets: sets };
    return schema;
  }

  /** Resolve one of our field names to the property this service actually has. */
  function propertyFor(field, properties) {
    const candidates = FIELD_ALIASES[field] || [];
    const lower = new Map(properties.map((p) => [p.toLowerCase(), p]));
    for (const candidate of candidates) {
      const hit = lower.get(candidate.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  const { parseDays, parseTimeRange, normalizeCourseId } = window.TPBB_parsing;
  const normalizeStatus = (raw) =>
    window.TPBB_parsing.normalizeStatus(raw, window.TPBB_SELECTORS.statusText);

  /**
   * Read every page of a collection, not just the first.
   *
   * `$top` is a request, not a guarantee: SAP enforces its own maximum page size
   * and returns `@odata.nextLink` for the remainder. Reading only the first page
   * looks identical to a complete result — the failure mode is a schedule that
   * is quietly missing sections, which is worse than an error.
   *
   * If the cap is ever hit, that is reported rather than swallowed.
   */
  /** Replace or append `$skip` on a query URL. */
  function withSkip(target, skip) {
    return /[?&]\$skip=\d+/.test(target)
      ? target.replace(/([?&]\$skip=)\d+/, `$1${skip}`)
      : `${target}&$skip=${skip}`;
  }

  async function getAllPages(target, { maxRows = 5000, maxPages = 40 } = {}) {
    const rows = [];
    let next = target;
    let pages = 0;
    let exhausted = false;

    // `$top` is a page size, not a total. Knowing it is what lets a full page be
    // recognised as "probably more behind it".
    const topMatch = target.match(/[?&]\$top=(\d+)/);
    const pageSize = topMatch ? Number(topMatch[1]) : null;

    while (next && rows.length < maxRows && pages < maxPages) {
      const payload = await getJson(next);
      const batch = payload.value || [];
      rows.push(...batch);
      pages += 1;

      const link = payload["@odata.nextLink"];
      if (link) {
        // A relative nextLink is resolved against the service root, and the
        // client parameter re-attached if SAP dropped it from the continuation.
        let resolved = /^https?:/i.test(link) ? link : `${SERVICE_ROOT}/${link.replace(/^\//, "")}`;
        if (!resolved.includes("sap-client=")) {
          resolved += (resolved.includes("?") ? "&" : "?") + CLIENT;
        }
        next = resolved;
        continue;
      }

      // No nextLink. This service does not send one — it silently truncates at
      // `$top` — so a full page means there is more, and paging has to continue
      // by `$skip`. Trusting the absent link reported an entire UCSD term as
      // 500 meetings across 134 courses, and called it complete.
      if (pageSize && batch.length === pageSize) {
        next = withSkip(target, rows.length);
        continue;
      }

      // A short page is the real end of the collection.
      next = null;
      exhausted = true;
    }

    // Only a cap counts as truncation; running out of rows does not.
    return { rows, truncated: !exhausted && Boolean(next), pages };
  }

  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const anyOf = (property, values) =>
    `(${values.map((v) => `${property} eq ${quote(v)}`).join(" or ")})`;

  /** "17:00:00" -> "17:00", which is what core/bookingPlan.js toMinutes() takes. */
  const trimSeconds = (raw) => {
    const match = String(raw || "").match(/^(\d{1,2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : null;
  };

  /**
   * Does this course row belong to the requested academic year and term?
   *
   * Matched on the *names* the row carries (`AcademicYear_Text` "2026/2027",
   * `AcademicPeriod_Text` "Fall Quarter") rather than on SAP's numeric period
   * code. An earlier version filtered server-side on a code looked up from
   * YUCSD_I_MINMAXUNITS, where hundreds of rows were scanned and the last
   * "Fall" match won — one stray row silently changed the code and every query
   * came back empty while the courses plainly existed in that term.
   *
   * Filtering here instead is safe because the server filter on CourseAbbr has
   * already cut this to a handful of rows.
   */
  function rowMatchesTerm(row, year, term) {
    if (year) {
      const rowYear = String(row.AcademicYear || "");
      const rowYearText = String(row.AcademicYear_Text || "");
      if (rowYear !== String(year) && !rowYearText.startsWith(String(year))) return false;
    }
    if (term) {
      const periodText = String(row.AcademicPeriod_Text || "").toLowerCase();
      if (!periodText.includes(String(term).toLowerCase())) return false;
    }
    return true;
  }

  /**
   * Fetch sections for specific courses in one term.
   *
   * Three queries, joined on ModuleID:
   *   1. course rows  -> ModuleID, title, credits for the codes asked for
   *   2. events       -> one row per meeting, with component/instructor/seats
   *   3. schedule     -> typed day + begin/end times per event
   *
   * Asking for exactly the courses on the plan is the point: a handful of rows,
   * no page open, no search, no scrolling.
   */
  /**
   * Join event rows to their meeting times and course rows.
   *
   * Shared by fetchSections (a few courses) and fetchTermSections (a whole
   * term) so there is one definition of what a section is. A second copy is
   * exactly how the time parser drifted before.
   */
  function joinSections({ byModuleId, eventRows, schedRows }) {
  // Meeting patterns keyed by the event they belong to. MODULE_SCHED.SectionId
  // is EVENTS.EventObjid — the same number, different column name.
  const meetingsByEvent = new Map();
  for (const row of schedRows) {
    const key = String(row.SectionId || "");
    if (!key) continue;
    if (!meetingsByEvent.has(key)) meetingsByEvent.set(key, []);
    meetingsByEvent.get(key).push({
      day: DOW_LETTERS[Number(row.DoW)] || null,
      start: trimSeconds(row.BeginTime),
      end: trimSeconds(row.EndTime),
    });
  }

  const sections = [];
  for (const event of eventRows) {
    const course = byModuleId.get(String(event.ModuleID));
    if (!course) continue;

    const meetings = meetingsByEvent.get(String(event.EventObjid)) || [];
    let days = meetings.map((m) => m.day).filter(Boolean);
    let start = meetings[0]?.start || null;
    let end = meetings[0]?.end || null;

    // Fall back to the display string only when the typed schedule rows are
    // missing, e.g. an event whose pattern has not been published yet.
    if (!days.length || !start) {
      const sched = String(event.Sched || "");
      const times = parseTimeRange(sched);
      if (!days.length) days = parseDays(sched.replace(/\d.*$/, ""));
      start = start || times.start;
      end = end || times.end;
    }

    const limit = Number(event.EventPkgLimit);
    const available = Number(event.EventPkgSeatsAvailable);
    const waitlisted = Number(event.EventPkgNumOnWaitl);
    const hasSeats = Number.isFinite(limit) && Number.isFinite(available);

    sections.push({
      courseId: normalizeCourseId(String(course.CourseAbbr || "")),
      courseName: course.CourseTitle || null,
      sectionId: event.EventAbbr || event.EventID || null,
      component: event.TeachingMethod || null,
      componentName: event.TeachingMethod_Text || null,
      days: [...new Set(days)],
      start,
      end,
      instructor: event.InstructorName || null,
      location: event.locationText || null,
      units: course.CreditsDisplay || null,
      unitsMin: course.MinimumCredits ?? null,
      unitsMax: course.MaximumCredits ?? null,
      seatsAvailable: hasSeats ? available : null,
      seatsTotal: hasSeats ? limit : null,
      seatsTaken: hasSeats ? limit - available : null,
      waitlisted: Number.isFinite(waitlisted) ? waitlisted : null,
      // Seats belong to the enrollable package, so a lecture and its
      // discussion legitimately report the same numbers.
      packageId: event.EventPkgOtjid || null,
      status: normalizeStatus(
        !hasSeats ? "" : available > 0 ? "open" : waitlisted > 0 ? "waitlist active" : "full"
      ),
      term: course.AcademicPeriod || null,
      termText: course.AcademicPeriod_Text || null,
      termKey: course.Persl || null,
      year: course.AcademicYear || null,
      moduleId: String(event.ModuleID),
      scrapedFrom: "odata",
    });
  }

    return sections.filter((s) => s.courseId);
  }

  async function fetchSections({ courseIds = [], year = null, term = null, top = 500 } = {}) {
    if (!courseIds.length) return { ok: true, sections: [], count: 0, note: "no courses requested" };

    // TSS zero-pads ("AAS-010R"); the planner does not ("AAS 10R"). Ask for
    // both spellings rather than trying to predict which one this course uses.
    const wanted = [];
    for (const id of courseIds) {
      const compact = String(id).toUpperCase().replace(/\s+/g, "-");
      const match = compact.match(/^([A-Z]{2,5})-(\d{1,3})([A-Z]{0,3})$/);
      wanted.push(compact);
      if (match) wanted.push(`${match[1]}-${match[2].padStart(3, "0")}${match[3]}`);
    }

    // Only CourseAbbr is filtered server-side. It is the selective clause — a
    // few courses out of the whole catalog — and it keeps the query free of any
    // assumption about how SAP numbers its terms.
    const coursePage = await getAllPages(
      url(
        SETS.module,
        `$filter=${encodeURIComponent(anyOf("CourseAbbr", [...new Set(wanted)]))}&$top=${top}`
      )
    );

    const courses = coursePage.rows.filter((row) => rowMatchesTerm(row, year, term));
    if (!courses.length) {
      // "No sections" has three very different causes and they are
      // indistinguishable from an empty grid, so name which one this is. The
      // rows already fetched answer it — no second request needed.
      const offerings = [
        ...new Set(
          coursePage.rows.map(
            (r) => `${r.CourseAbbr} — ${r.AcademicYear_Text || r.AcademicYear} ${r.AcademicPeriod_Text || ""}`.trim()
          )
        ),
      ];
      return {
        ok: true,
        sections: [],
        count: 0,
        codesQueried: [...new Set(wanted)],
        offeringsFound: offerings,
        // What was compared, and against what. Two rounds were lost to a
        // diagnosis that could not distinguish "the filter is wrong" from "the
        // course really is not offered" — so show the actual values.
        comparison: {
          askedYear: year,
          askedTerm: term,
          rowsSeen: coursePage.rows.length,
          sampleRows: coursePage.rows.slice(0, 3).map((r) => ({
            code: r.CourseAbbr,
            year: r.AcademicYear,
            yearText: r.AcademicYear_Text,
            periodText: r.AcademicPeriod_Text,
          })),
        },
        diagnosis: coursePage.rows.length
          ? "those courses exist in TSS but are not offered in the requested term"
          : "TSS has no course under those codes at all — the code format probably differs",
        note: coursePage.rows.length
          ? `not offered that term; TSS lists: ${offerings.slice(0, 4).join(" · ")}`
          : `no course found for ${[...new Set(wanted)].slice(0, 6).join(", ")}`,
      };
    }

    const byModuleId = new Map();
    for (const course of courses) byModuleId.set(String(course.ModuleID), course);
    const moduleIds = [...byModuleId.keys()];

    // Take the period code from the rows that actually matched, so the events
    // query is consistent with the courses by construction rather than by a
    // lookup that could disagree with them.
    const periodCode = courses[0]?.AcademicPeriod || null;
    const eventYear = courses[0]?.AcademicYear || year || null;

    const eventClauses = [anyOf("ModuleID", moduleIds)];
    if (eventYear) eventClauses.push(`AcYear eq ${quote(eventYear)}`);
    if (periodCode) eventClauses.push(`AcPeriod eq ${quote(periodCode)}`);

    const [eventsPage, schedPage] = await Promise.all([
      getAllPages(
        url(SETS.events, `$filter=${encodeURIComponent(eventClauses.join(" and "))}&$top=${top}`)
      ),
      getAllPages(
        url(
          SETS.sched,
          `$filter=${encodeURIComponent(anyOf("ModuleID", moduleIds))}&$top=${top}`
        )
      ),
    ]);

    const sections = joinSections({
      byModuleId,
      eventRows: eventsPage.rows,
      schedRows: schedPage.rows,
    });

    // Hitting a page cap means sections are missing from the schedule below, so
    // it is surfaced rather than logged and forgotten.
    const truncated = coursePage.truncated || eventsPage.truncated || schedPage.truncated;

    return {
      ok: true,
      sections: sections.filter((s) => s.courseId),
      count: sections.length,
      coursesMatched: courses.length,
      // Courses found but no events means the department has not published the
      // meeting pattern yet — different from the course not running at all.
      diagnosis: sections.length
        ? null
        : `found ${courses.length} course(s) in that term, but TSS has no scheduled meetings for them yet`,
      periodCode,
      pagesRead: coursePage.pages + eventsPage.pages + schedPage.pages,
      truncated,
      note: truncated
        ? "TSS returned more rows than this fetch reads; some sections may be missing."
        : null,
    };
  }

  /**
   * List courses TSS is actually offering in one term.
   *
   * Unlike fetchSections (which needs specific codes and returns meeting
   * patterns), this is the catalog browse for "what's running next quarter":
   * one MODULE query filtered by AcademicYear, optionally narrowed by
   * department prefix, then term-matched on AcademicPeriod_Text the same way
   * fetchSections does — so a wrong period code cannot empty the list.
   *
   * Returns unique course ids (canonical "CSE 100" form) with titles; no
   * events/schedule join, so it stays cheap enough to power a search filter.
   */
  async function fetchTermOfferings({
    year = null,
    term = null,
    dept = null,
    top = 500,
  } = {}) {
    if (!year || !term) {
      return { ok: false, reason: "year and term are required", courses: [], count: 0 };
    }

    const clauses = [`AcademicYear eq ${quote(String(year))}`];
    if (dept) {
      const prefix = String(dept)
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
      if (prefix) clauses.push(`startswith(CourseAbbr,${quote(`${prefix}-`)})`);
    }

    // A whole academic year without a dept can be thousands of rows; a single
    // department is a few hundred. Cap accordingly and report truncation.
    const page = await getAllPages(
      url(
        SETS.module,
        `$filter=${encodeURIComponent(clauses.join(" and "))}&$top=${top}`
      ),
      { maxRows: dept ? 2500 : 8000, maxPages: 40 }
    );

    const matched = page.rows.filter((row) => rowMatchesTerm(row, year, term));
    const byId = new Map();
    for (const row of matched) {
      const courseId = normalizeCourseId(String(row.CourseAbbr || ""));
      if (!courseId || byId.has(courseId)) continue;
      const credits = Number(row.MinimumCredits);
      byId.set(courseId, {
        courseId,
        courseName: row.CourseTitle || null,
        credits: Number.isFinite(credits) ? credits : null,
        termText: row.AcademicPeriod_Text || null,
        year: row.AcademicYear || null,
      });
    }

    const courses = [...byId.values()].sort((a, b) =>
      a.courseId.localeCompare(b.courseId)
    );

    return {
      ok: true,
      courses,
      count: courses.length,
      truncated: page.truncated,
      pagesRead: page.pages,
      year: String(year),
      term,
      dept: dept || null,
      diagnosis: courses.length
        ? null
        : page.rows.length
          ? "TSS has courses in that academic year, but none matched this term"
          : "TSS returned no courses for that academic year",
    };
  }

  /**
   * Report what the service actually exposes.
   *
   * Written to be run once from a signed-in session: it turns every remaining
   * unknown in this file into a printed fact, so the alias table above can be
   * corrected from evidence instead of extended by guessing.
   */
  async function selfTest({ ignoreOrigin = false } = {}) {
    // A content script's fetch carries the *page's* origin, not the extension's,
    // so this only works from a tss.ucsd.edu page. Run it from sis.ucsd.edu and
    // CORS blocks it — which reads as "OData is unavailable" when the service is
    // fine and the tab is simply wrong. Say which it is.
    // (`ignoreOrigin` is for the offline fixture, which runs on localhost with
    // fetch stubbed and so has no origin to satisfy.)
    if (!ignoreOrigin && location.origin !== new URL(SERVICE_ROOT).origin) {
      return {
        ok: false,
        serviceRoot: SERVICE_ROOT,
        error:
          `This page is ${location.origin}, but the data service lives on ` +
          `${new URL(SERVICE_ROOT).origin}. Requests from here are cross-origin and ` +
          `will be blocked regardless of your session. Open the Schedule of Classes ` +
          `on tss.ucsd.edu and run this again.`,
      };
    }

    try {
      const model = await loadSchema();
      const map = {};
      const unresolved = [];
      for (const field of Object.keys(FIELD_ALIASES)) {
        map[field] = propertyFor(field, model.properties);
        if (!map[field]) unresolved.push(field);
      }
      const sample = await getJson(url(model.entitySet, "$top=1"));
      return {
        ok: true,
        serviceRoot: SERVICE_ROOT,
        entitySet: model.entitySet,
        entityType: model.entityType,
        entitySetsAvailable: model.allSets.map((s) => s.name),
        properties: model.properties,
        resolved: map,
        unresolved,
        sampleRecord: (sample.value || [])[0] || null,
      };
    } catch (error) {
      return { ok: false, serviceRoot: SERVICE_ROOT, error: String(error.message || error) };
    }
  }

  /**
   * Dump every entity set in the service, with its properties and a sample row.
   *
   * The first self-test picked YUCSD_CON_MODULE — the *course* list, where the
   * section columns (EventID, DoW, Instructor, Building) exist for filtering but
   * come back empty. The real meeting data lives in sibling sets whose names the
   * metadata revealed (YUCSD_CON_EVENTS, YUCSD_CON_MODULE_SCHED, ...). Rather
   * than guess which, read them all once and let evidence decide.
   *
   * Read-only: one $top=2 per set. A set that errors is reported, not fatal.
   */
  async function exploreAll({ sampleSize = 2 } = {}) {
    if (location.origin !== new URL(SERVICE_ROOT).origin) {
      return {
        ok: false,
        error:
          `This page is ${location.origin}, not ${new URL(SERVICE_ROOT).origin}. ` +
          `Open the Schedule of Classes on tss.ucsd.edu and run this again.`,
      };
    }

    let doc;
    try {
      const response = await fetch(url("$metadata"), { credentials: "include" });
      if (!response.ok) throw new Error(`$metadata returned ${response.status}`);
      doc = new DOMParser().parseFromString(await response.text(), "application/xml");
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }

    const propertiesByType = {};
    for (const type of doc.querySelectorAll("EntityType")) {
      propertiesByType[type.getAttribute("Name")] = [...type.querySelectorAll("Property")].map(
        (p) => ({ name: p.getAttribute("Name"), type: (p.getAttribute("Type") || "").replace("Edm.", "") })
      );
    }

    const sets = [...doc.querySelectorAll("EntitySet")].map((node) => ({
      name: node.getAttribute("Name"),
      type: (node.getAttribute("EntityType") || "").split(".").pop(),
    }));

    const report = [];
    for (const set of sets) {
      const entry = {
        entitySet: set.name,
        entityType: set.type,
        properties: propertiesByType[set.type] || [],
      };
      try {
        const payload = await getJson(url(set.name, `$top=${sampleSize}`));
        entry.sampleCount = (payload.value || []).length;
        entry.samples = payload.value || [];
      } catch (error) {
        entry.sampleError = String(error?.message || error);
      }
      report.push(entry);
    }

    return {
      ok: true,
      serviceRoot: SERVICE_ROOT,
      entitySetCount: report.length,
      // Surface the likely section-bearing sets first so the answer is obvious
      // even before reading the whole file.
      likelySectionSets: report
        .filter((e) =>
          e.properties.some((p) => /^(DoW|EventID|StartTime|EndTime|MeetingTime)$/i.test(p.name))
        )
        .map((e) => e.entitySet),
      sets: report,
    };
  }

  /**
   * Every scheduled meeting in one term — the whole schedule, not one plan's worth.
   *
   * `fetchSections` asks "when do *these* courses meet?", which is right for
   * drawing one student's week but means the data only ever covers three or four
   * courses. This asks the same three tables without the course clause, because
   * all of them can be filtered by term on their own:
   *
   *   YUCSD_CON_MODULE        AcademicYear (+ client-side period match)
   *   YUCSD_CON_EVENTS        AcYear + AcPeriod
   *   YUCSD_CON_MODULE_SCHED  AcYear + Acsess
   *
   * Note each table spells the term differently — AcademicPeriod / AcPeriod /
   * Acsess — which is why this cannot be one generic helper.
   *
   * The result is the shared copy: times, instructors and rooms for every course
   * TSS is running. Deliberately heavy and deliberately manual — it is worth
   * running when a schedule publishes, not on a timer.
   *
   * `onProgress` is called between stages so a caller can show something during
   * what is a minute or two of paging.
   */
  async function fetchTermSections({ year = null, term = null, onProgress = null } = {}) {
    if (!year || !term) {
      return { ok: false, reason: "year and term are required", sections: [], count: 0 };
    }
    const step = (stage, detail) => onProgress && onProgress({ stage, ...detail });

    // 1. Courses. Filtered on year server-side, narrowed to the term here for
    //    the same reason fetchSections does it: the numeric period code is a SAP
    //    internal, and a wrong one silently empties the result.
    step("courses", { message: "Reading the term's course list…" });
    const coursePage = await getAllPages(
      url(SETS.module, `$filter=${encodeURIComponent(`AcademicYear eq ${quote(String(year))}`)}&$top=500`),
      { maxRows: 20000, maxPages: 80 }
    );
    const courses = coursePage.rows.filter((row) => rowMatchesTerm(row, year, term));
    if (!courses.length) {
      return {
        ok: true,
        sections: [],
        count: 0,
        diagnosis: coursePage.rows.length
          ? "TSS has courses in that academic year, but none in this term"
          : "TSS returned no courses for that academic year",
      };
    }

    const byModuleId = new Map();
    for (const course of courses) byModuleId.set(String(course.ModuleID), course);

    // Both remaining tables key off the same year/period the courses reported,
    // so they agree with the course rows by construction.
    const periodCode = courses[0]?.AcademicPeriod || null;
    const eventYear = courses[0]?.AcademicYear || String(year);

    step("events", { message: "Reading every meeting…", courses: byModuleId.size });
    const eventClauses = [`AcYear eq ${quote(eventYear)}`];
    if (periodCode) eventClauses.push(`AcPeriod eq ${quote(periodCode)}`);
    const eventsPage = await getAllPages(
      url(SETS.events, `$filter=${encodeURIComponent(eventClauses.join(" and "))}&$top=500`),
      { maxRows: 40000, maxPages: 120 }
    );

    step("schedule", { message: "Reading meeting times…", events: eventsPage.rows.length });
    const schedClauses = [`AcYear eq ${quote(eventYear)}`];
    if (periodCode) schedClauses.push(`Acsess eq ${quote(periodCode)}`);
    const schedPage = await getAllPages(
      url(SETS.sched, `$filter=${encodeURIComponent(schedClauses.join(" and "))}&$top=500`),
      { maxRows: 40000, maxPages: 120 }
    );

    step("joining", { message: "Matching meetings to times…" });
    const sections = joinSections({
      byModuleId,
      eventRows: eventsPage.rows,
      schedRows: schedPage.rows,
    });

    const truncated = coursePage.truncated || eventsPage.truncated || schedPage.truncated;
    return {
      ok: true,
      sections,
      count: sections.length,
      coursesMatched: byModuleId.size,
      coursesWithMeetings: new Set(sections.map((s) => s.courseId)).size,
      periodCode,
      year: String(year),
      term,
      pagesRead: coursePage.pages + eventsPage.pages + schedPage.pages,
      truncated,
      // Never let a page cap masquerade as a complete schedule.
      note: truncated
        ? "TSS returned more rows than this fetch reads; the term is incomplete."
        : null,
    };
  }

  window.__TPBB_odata = {
    SERVICE_ROOT,
    fetchSections,
    fetchTermOfferings,
    fetchTermSections,
    loadSchema,
    selfTest,
    exploreAll,
  };
})();
