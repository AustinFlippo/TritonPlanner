/**
 * Service worker: the only thing that persists between the TritonPlanner tab
 * and the TSS tab.
 *
 * Deliberately dumb. It stores a booking plan and the sections scraped out of
 * TSS, and does no network I/O of its own — nothing student-identifying ever
 * leaves the browser through this extension.
 */

/**
 * The worker fetches TSS directly.
 *
 * A content script's fetch carries the *page's* origin, so OData only works from
 * a tss.ucsd.edu tab. The service worker is not bound that way: `host_permissions`
 * covers tss.ucsd.edu, so its fetches skip CORS and still carry the student's
 * session cookie. That is what lets sections refresh with no TSS tab open —
 * the student signs in once and the planner stays current on its own.
 *
 * `self.window = self` exists because these files are shared verbatim with the
 * content scripts, which attach their exports to `window`. Keeping one copy is
 * worth the shim; a second copy is how the time parser silently drifted before.
 * Note $metadata parsing needs DOMParser, which workers lack — schema *dumping*
 * stays in the content script, and only fetchSections runs here.
 */
self.window = self;
importScripts("content/parsing.js", "content/selectors.js", "content/odata.js");

const STORE = {
  plan: "bookingPlan",
  sections: "scrapedSections",
  sectionsUpdatedAt: "sectionsUpdatedAt",
  log: "activityLog",
  // The whole term's schedule, kept separate from `sections` on purpose:
  // `sections` is this student's own courses with live seat counts, this is the
  // shared copy (times, instructors, rooms) destined for Supabase. Mixing them
  // would make "my seats" and "everyone's timetable" impossible to tell apart.
  termCatalog: "termCatalog",
  termProgress: "termFetchProgress",
};

/** "Fall Quarter" -> "fall", which is what fetchSections filters on. */
function termWordOf(termText) {
  const text = String(termText || "").toLowerCase();
  return ["fall", "winter", "spring", "summer"].find((w) => text.includes(w)) || null;
}

async function appendLog(entry) {
  const { [STORE.log]: log = [] } = await chrome.storage.local.get(STORE.log);
  log.push({ ...entry, at: Date.now() });
  // Keep the log short; it exists for debugging a failed window, not history.
  await chrome.storage.local.set({ [STORE.log]: log.slice(-100) });
}

/**
 * Drop stored sections that carry no term.
 *
 * Only the retired DOM scrape produced these. It read the Schedule of Classes
 * results table, which lists courses rather than sections and says nothing
 * about which quarter it is showing — so those rows have no term and usually no
 * meeting time either, and the week grid has to warn that their times might
 * belong to a different quarter.
 *
 * Nothing is lost: everything they covered is re-fetchable from OData, with a
 * term attached and in one request.
 */
async function pruneTermlessSections() {
  const { [STORE.sections]: existing = {} } = await chrome.storage.local.get(STORE.sections);
  const kept = {};
  let dropped = 0;

  for (const [courseId, list] of Object.entries(existing)) {
    const survivors = (list || []).filter((s) => s.term || s.termText || s.year);
    dropped += (list || []).length - survivors.length;
    if (survivors.length) kept[courseId] = survivors;
  }

  if (!dropped) return { dropped: 0, courses: Object.keys(kept).length };

  await chrome.storage.local.set({ [STORE.sections]: kept });
  await appendLog({ event: "pruned-termless-sections", dropped });
  return { dropped, courses: Object.keys(kept).length };
}

// Runs once per extension load, so upgrading is enough to clear the backlog.
chrome.runtime.onInstalled.addListener(() => pruneTermlessSections());
chrome.runtime.onStartup.addListener(() => pruneTermlessSections());

/**
 * Fold freshly-read sections into storage, keyed by course id.
 *
 * A section already present is *replaced*, not skipped: a re-read carries a
 * fresher seat count, and during an enrollment window a stale "12 seats open"
 * is worse than no number at all.
 */
async function mergeSections(sections, readAt) {
  const { [STORE.sections]: existing = {} } = await chrome.storage.local.get(STORE.sections);
  const merged = { ...existing };
  for (const section of sections || []) {
    if (!section.courseId) continue;
    const list = [...(merged[section.courseId] || [])];
    const at = list.findIndex(
      (s) => s.sectionId === section.sectionId && s.component === section.component
    );
    const record = { ...section, seenAt: readAt };
    if (at === -1) list.push(record);
    else list[at] = record;
    merged[section.courseId] = list;
  }
  await chrome.storage.local.set({
    [STORE.sections]: merged,
    [STORE.sectionsUpdatedAt]: readAt,
  });
  return merged;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "TPBB_SET_PLAN": {
        await chrome.storage.local.set({ [STORE.plan]: message.payload });
        await appendLog({
          event: "plan-loaded",
          term: message.payload?.termCode,
          steps: message.payload?.steps?.length ?? 0,
        });
        sendResponse({ ok: true });
        break;
      }

      case "TPBB_GET_PLAN": {
        const stored = await chrome.storage.local.get(STORE.plan);
        sendResponse({ ok: true, plan: stored[STORE.plan] || null });
        break;
      }

      /**
       * Pull live sections for specific courses straight from TSS.
       *
       * Runs here rather than in a content script precisely so no TSS tab is
       * needed. Failures are reported, never swallowed: a 401 means the SSO
       * session lapsed, and a student who thinks their seat counts are live
       * when they are hours stale is worse off than one who is told to sign in.
       */
      case "TPBB_FETCH_SECTIONS": {
        const { courseIds = [], year = null, term = null } = message.payload || {};
        try {
          const result = await self.__TPBB_odata.fetchSections({ courseIds, year, term });
          const readAt = Date.now();
          const merged = result.sections.length
            ? await mergeSections(result.sections, readAt)
            : null;
          await appendLog({
            event: "sections-fetched",
            term,
            year,
            requested: courseIds.length,
            found: result.count,
          });
          sendResponse({
            ok: true,
            count: result.count,
            coursesMatched: result.coursesMatched ?? 0,
            diagnosis: result.diagnosis || null,
            offeringsFound: result.offeringsFound || null,
            codesQueried: result.codesQueried || null,
            comparison: result.comparison || null,
            // Stamped so a stale, un-reloaded extension is visible rather than
            // being mistaken for a logic bug — that ambiguity cost two rounds.
            extensionVersion: chrome.runtime.getManifest().version,
            truncated: Boolean(result.truncated),
            note: result.note || null,
            updatedAt: merged ? readAt : null,
          });
        } catch (error) {
          const reason = String(error?.message || error);
          await appendLog({ event: "sections-fetch-failed", reason });
          sendResponse({
            ok: false,
            reason,
            // 401/403 from SAP means the session expired, not a broken URL.
            needsSignIn: /\b(401|403)\b/.test(reason),
          });
        }
        break;
      }

      /**
       * List every course TSS publishes for one term (optionally one dept).
       *
       * Powers the Course Search "next quarter" filter. Distinct from
       * TPBB_FETCH_SECTIONS: no meeting join, just the MODULE rows, so a
       * department browse stays one request.
       */
      case "TPBB_FETCH_TERM_OFFERINGS": {
        const { year = null, term = null, dept = null } = message.payload || {};
        try {
          const result = await self.__TPBB_odata.fetchTermOfferings({
            year,
            term,
            dept,
          });
          await appendLog({
            event: "term-offerings-fetched",
            term,
            year,
            dept,
            found: result.count,
          });
          sendResponse({
            ...result,
            extensionVersion: chrome.runtime.getManifest().version,
          });
        } catch (error) {
          const reason = String(error?.message || error);
          await appendLog({ event: "term-offerings-fetch-failed", reason });
          sendResponse({
            ok: false,
            reason,
            courses: [],
            count: 0,
            needsSignIn: /\b(401|403)\b/.test(reason),
          });
        }
        break;
      }

      /**
       * Re-fetch every course already in storage, grouped by the term it
       * belongs to.
       *
       * This is the seat-refresh path. Times and instructors barely move once a
       * schedule publishes, but seat counts change by the minute during the
       * two-week enrollment window — so the useful action is "re-read what I
       * already track", not "search for something new".
       */
      case "TPBB_REFRESH_STORED": {
        const { [STORE.sections]: stored = {} } = await chrome.storage.local.get(STORE.sections);

        // Group by term: one fetch per term is far fewer round trips than one
        // per course, and fetchSections takes a list of codes anyway.
        const byTerm = new Map();
        for (const [courseId, list] of Object.entries(stored)) {
          for (const section of list || []) {
            const term = termWordOf(section.termText);
            if (!term || !section.year) continue;
            const key = `${section.year}|${term}`;
            if (!byTerm.has(key)) byTerm.set(key, new Set());
            byTerm.get(key).add(courseId);
            break; // one grouping per course is enough
          }
        }

        if (!byTerm.size) {
          sendResponse({ ok: true, refreshed: 0, note: "nothing stored to refresh yet" });
          break;
        }

        const readAt = Date.now();
        let refreshed = 0;
        const failures = [];
        for (const [key, courseIds] of byTerm) {
          const [year, term] = key.split("|");
          try {
            const result = await self.__TPBB_odata.fetchSections({
              courseIds: [...courseIds],
              year,
              term,
            });
            if (result.sections.length) {
              await mergeSections(result.sections, readAt);
              refreshed += result.sections.length;
            }
          } catch (error) {
            failures.push(`${term} ${year}: ${String(error?.message || error)}`);
          }
        }

        await appendLog({ event: "refresh-stored", refreshed, terms: byTerm.size });
        sendResponse({
          ok: failures.length === 0,
          refreshed,
          terms: byTerm.size,
          updatedAt: refreshed ? readAt : null,
          failures,
          needsSignIn: failures.some((f) => /\b(401|403)\b/.test(f)),
        });
        break;
      }

      /**
       * Fetch an entire term's schedule — every course, every meeting.
       *
       * This is the shared copy: run once when a schedule publishes, and every
       * student can read times and instructors without their own TSS session.
       * Deliberately manual and deliberately heavy; it is thousands of rows and
       * has no business running on a timer.
       *
       * Progress goes to storage rather than the response, because the whole
       * thing takes a minute or two and a single sendResponse cannot report
       * anything until it is over.
       */
      case "TPBB_FETCH_TERM_SECTIONS": {
        const { year = null, term = null } = message.payload || {};
        const startedAt = Date.now();
        await chrome.storage.local.set({
          [STORE.termProgress]: { running: true, stage: "starting", startedAt },
        });

        try {
          const result = await self.__TPBB_odata.fetchTermSections({
            year,
            term,
            onProgress: (progress) =>
              chrome.storage.local.set({
                [STORE.termProgress]: { running: true, ...progress, startedAt },
              }),
          });

          if (result.ok && result.count) {
            const byCourse = {};
            for (const section of result.sections) {
              (byCourse[section.courseId] ||= []).push(section);
            }
            const { [STORE.termCatalog]: catalog = {} } = await chrome.storage.local.get(
              STORE.termCatalog
            );
            catalog[`${result.year}-${result.term}`] = {
              fetchedAt: Date.now(),
              year: result.year,
              term: result.term,
              courseCount: Object.keys(byCourse).length,
              sectionCount: result.count,
              truncated: Boolean(result.truncated),
              courses: byCourse,
            };
            await chrome.storage.local.set({ [STORE.termCatalog]: catalog });
          }

          await chrome.storage.local.set({
            [STORE.termProgress]: { running: false, finishedAt: Date.now(), startedAt },
          });
          await appendLog({
            event: "term-sections-fetched",
            term,
            year,
            sections: result.count,
            courses: result.coursesWithMeetings ?? 0,
            seconds: Math.round((Date.now() - startedAt) / 1000),
          });
          sendResponse({ ...result, elapsedMs: Date.now() - startedAt });
        } catch (error) {
          const reason = String(error?.message || error);
          await chrome.storage.local.set({
            [STORE.termProgress]: { running: false, error: reason, startedAt },
          });
          await appendLog({ event: "term-sections-fetch-failed", reason });
          sendResponse({
            ok: false,
            reason,
            needsSignIn: /\b(401|403)\b/.test(reason),
          });
        }
        break;
      }

      case "TPBB_GET_TERM_PROGRESS": {
        const stored = await chrome.storage.local.get(STORE.termProgress);
        sendResponse({ ok: true, progress: stored[STORE.termProgress] || null });
        break;
      }

      /** Everything the admin page needs in one round trip. */
      case "TPBB_GET_STATUS": {
        const stored = await chrome.storage.local.get([
          STORE.sections,
          STORE.sectionsUpdatedAt,
          STORE.log,
          STORE.termCatalog,
        ]);
        const sections = stored[STORE.sections] || {};
        const catalog = stored[STORE.termCatalog] || {};
        sendResponse({
          ok: true,
          version: chrome.runtime.getManifest().version,
          updatedAt: stored[STORE.sectionsUpdatedAt] || null,
          log: (stored[STORE.log] || []).slice(-25).reverse(),
          // Summaries only — the full catalog is thousands of rows and the admin
          // page has no reason to hold it in memory.
          terms: Object.entries(catalog)
            .map(([key, entry]) => ({
              key,
              year: entry.year,
              term: entry.term,
              courseCount: entry.courseCount,
              sectionCount: entry.sectionCount,
              truncated: Boolean(entry.truncated),
              fetchedAt: entry.fetchedAt,
            }))
            .sort((a, b) => b.fetchedAt - a.fetchedAt),
          courses: Object.entries(sections)
            .map(([courseId, list]) => ({
              courseId,
              sectionCount: list.length,
              term: list[0]?.termText || null,
              year: list[0]?.year || null,
              seenAt: Math.max(...list.map((s) => s.seenAt || 0)) || null,
              // Seats live on the package, so the same numbers repeat across a
              // lecture and its discussion; one figure per course is enough here.
              seatsAvailable: list.reduce(
                (best, s) => (Number.isFinite(s.seatsAvailable) ? Math.max(best, s.seatsAvailable) : best),
                -1
              ),
            }))
            .sort((a, b) => a.courseId.localeCompare(b.courseId)),
        });
        break;
      }

      case "TPBB_PRUNE_TERMLESS": {
        sendResponse({ ok: true, ...(await pruneTermlessSections()) });
        break;
      }

      case "TPBB_GET_SECTIONS": {
        const stored = await chrome.storage.local.get([STORE.sections, STORE.sectionsUpdatedAt]);
        sendResponse({
          ok: true,
          sections: stored[STORE.sections] || {},
          updatedAt: stored[STORE.sectionsUpdatedAt] || null,
        });
        break;
      }

      case "TPBB_CLEAR": {
        await chrome.storage.local.remove([
          STORE.plan,
          STORE.sections,
          STORE.sectionsUpdatedAt,
          STORE.log,
        ]);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, reason: `unknown message type '${message?.type}'` });
    }
  })();

  return true; // keep the channel open for the async response
});
