/**
 * TritonPlanner-side connector.
 *
 * Import this from the React app to send a booking plan to the extension and
 * to pull back section data the extension scraped out of TSS. Everything goes
 * through CustomEvents on window; the extension's content script relays them.
 *
 * Deliberately standalone — drop it in without editing existing components.
 * Wiring it up is one import plus a button handler; see the README.
 */

import { buildBookingPlan } from "./bookingPlan.js";
import { indexCatalog } from "./catalog.js";

const EVENTS = {
  send: "tritonplanner:booking-plan",
  ack: "tritonplanner:booking-plan-ack",
  requestSections: "tritonplanner:request-sections",
  sections: "tritonplanner:sections",
  ready: "tritonplanner:bridge-ready",
  ping: "tritonplanner:ping",
  fetchSections: "tritonplanner:fetch-sections",
  fetchResult: "tritonplanner:fetch-sections-result",
  fetchTermOfferings: "tritonplanner:fetch-term-offerings",
  fetchTermOfferingsResult: "tritonplanner:fetch-term-offerings-result",
  fetchTermSections: "tritonplanner:fetch-term-sections",
  fetchTermSectionsResult: "tritonplanner:fetch-term-sections-result",
  termProgress: "tritonplanner:term-progress",
  termProgressResult: "tritonplanner:term-progress-result",
};

/** Resolves true if the extension announced itself, false after `timeoutMs`. */
export function isBridgeInstalled(timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ready, onReady);
      resolve(value);
    };
    const onReady = () => done(true);
    window.addEventListener(EVENTS.ready, onReady);
    // The extension fires `ready` once at document_idle, which has long since
    // passed by the time a tab like Quarter View mounts. Probe for it rather
    // than waiting on an announcement that already happened.
    window.dispatchEvent(new CustomEvent(EVENTS.ping));
    setTimeout(() => done(false), timeoutMs);
  });
}

/** Send a plan to the extension. Resolves with the ack, or null on timeout. */
export function sendPlanToBridge(plan, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const onAck = (event) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ack, onAck);
      resolve(event.detail);
    };
    window.addEventListener(EVENTS.ack, onAck);
    window.dispatchEvent(new CustomEvent(EVENTS.send, { detail: plan }));
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ack, onAck);
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Normalize a sections event payload.
 *
 * The bridge sends `{ sections, updatedAt, pushed }`; older builds sent the
 * course-keyed map bare. Tell them apart by looking for the envelope key, so a
 * student running a stale unpacked extension still gets their data.
 */
function unwrapSections(detail) {
  if (!detail || typeof detail !== "object") return { sections: {}, updatedAt: null };
  if ("sections" in detail) {
    return {
      sections: detail.sections || {},
      updatedAt: detail.updatedAt || null,
      pushed: Boolean(detail.pushed),
    };
  }
  return { sections: detail, updatedAt: null, pushed: false };
}

/** Pull back section data scraped from TSS, keyed by course id. */
export function requestScrapedSections(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const onSections = (event) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.sections, onSections);
      resolve(unwrapSections(event.detail).sections);
    };
    window.addEventListener(EVENTS.sections, onSections);
    window.dispatchEvent(new CustomEvent(EVENTS.requestSections));
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.sections, onSections);
      resolve({});
    }, timeoutMs);
  });
}

/**
 * Ask the extension to pull live sections for these courses in one term.
 *
 * This needs no TSS tab open: the request is relayed to the extension's service
 * worker, whose host permissions let it call TSS with the student's existing
 * session. The sections themselves arrive through `subscribeToSections`; this
 * resolves with the outcome so the UI can distinguish "nothing offered" from
 * "your TSS session expired".
 *
 * @param {{courseIds: string[], year: string|number, term: "fall"|"winter"|"spring"}} request
 * @returns {Promise<{ok: boolean, count?: number, reason?: string, needsSignIn?: boolean}>}
 */
export function requestLiveSections({ courseIds, year, term }, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!Array.isArray(courseIds) || !courseIds.length) {
      resolve({ ok: true, count: 0, note: "no courses in this quarter" });
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.fetchResult, onResult);
      resolve(value);
    };
    const onResult = (event) => done(event.detail || { ok: false, reason: "empty reply" });
    window.addEventListener(EVENTS.fetchResult, onResult);
    window.dispatchEvent(
      new CustomEvent(EVENTS.fetchSections, { detail: { courseIds, year: String(year), term } })
    );
    // TSS can be slow; a long timeout beats reporting a false failure while the
    // request is still in flight.
    setTimeout(() => done({ ok: false, reason: "the extension did not respond in time" }), timeoutMs);
  });
}

/**
 * Ask the extension for every course TSS lists in one term.
 *
 * Used by Course Search's "next quarter" filter — live schedule data, not the
 * historical catalog harvest behind the F/W/S chips. Optional `dept` narrows
 * the MODULE query (e.g. "CSE") so a department browse stays fast.
 *
 * @param {{year: string|number, term: "fall"|"winter"|"spring", dept?: string|null}} request
 */
export function requestTermOfferings(
  { year, term, dept = null },
  timeoutMs = 30000
) {
  return new Promise((resolve) => {
    if (!year || !term) {
      resolve({ ok: false, reason: "year and term are required", courses: [], count: 0 });
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.fetchTermOfferingsResult, onResult);
      resolve(value);
    };
    const onResult = (event) =>
      done(event.detail || { ok: false, reason: "empty reply", courses: [], count: 0 });
    window.addEventListener(EVENTS.fetchTermOfferingsResult, onResult);
    window.dispatchEvent(
      new CustomEvent(EVENTS.fetchTermOfferings, {
        detail: { year: String(year), term, dept: dept || null },
      })
    );
    setTimeout(
      () =>
        done({
          ok: false,
          reason: "the extension did not respond in time",
          courses: [],
          count: 0,
        }),
      timeoutMs
    );
  });
}

/**
 * Ask the extension to read an entire term's schedule from TSS.
 *
 * Used by the admin page. The extension does the TSS read (only it can reach a
 * signed-in TSS session); the page publishes the result to Supabase (only it is
 * signed in as the admin). Neither side does the other's job.
 *
 * Slow by nature — thousands of rows — so the timeout is generous and
 * `onProgress` is polled meanwhile.
 *
 * @param {{year: string|number, term: string, onProgress?: Function}} request
 */
export function requestTermSections({ year, term, onProgress }, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let settled = false;
    let poll = null;

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      window.removeEventListener(EVENTS.fetchTermSectionsResult, onResult);
      window.removeEventListener(EVENTS.termProgressResult, onProgressEvent);
      resolve(value);
    };
    const onResult = (event) => done(event.detail || { ok: false, reason: "empty reply" });
    const onProgressEvent = (event) => {
      if (event.detail && onProgress) onProgress(event.detail);
    };

    window.addEventListener(EVENTS.fetchTermSectionsResult, onResult);
    window.addEventListener(EVENTS.termProgressResult, onProgressEvent);
    window.dispatchEvent(
      new CustomEvent(EVENTS.fetchTermSections, { detail: { year: String(year), term } })
    );

    if (onProgress) {
      poll = setInterval(
        () => window.dispatchEvent(new CustomEvent(EVENTS.termProgress)),
        1000
      );
    }
    setTimeout(() => done({ ok: false, reason: "the extension did not respond in time" }), timeoutMs);
  });
}

/**
 * Subscribe to section data as the extension captures it.
 *
 * The TSS tab captures while the student scrolls; this is how the planner tab
 * finds out without being asked to refresh. Fires for pushed updates and for
 * replies to `requestScrapedSections`, so a subscriber is always current.
 *
 * @param {(payload: {sections: object, updatedAt: number|null, pushed: boolean}) => void} onUpdate
 * @returns {() => void} unsubscribe
 */
export function subscribeToSections(onUpdate) {
  const handler = (event) => onUpdate(unwrapSections(event.detail));
  window.addEventListener(EVENTS.sections, handler);
  return () => window.removeEventListener(EVENTS.sections, handler);
}

/**
 * One-call convenience: build a plan from the live grid and hand it over.
 *
 * @param {object}   options
 * @param {object[]} options.grid        the planner's schedule state
 * @param {number}   options.yearIndex   which year row to book
 * @param {string}   options.term        "fall" | "winter" | "spring"
 * @param {string}   options.termCode    TSS term label, e.g. "FA26"
 * @param {object[]} options.catalogJson raw v5.json course array
 * @param {number}   options.pass        1 or 2
 */
export async function planAndSend({
  grid,
  yearIndex,
  term,
  termCode,
  catalogJson,
  pass = 1,
  level = "undergrad",
  preferences = {},
  alreadyBooked = [],
}) {
  const catalog = indexCatalog(catalogJson);

  // Use whatever TSS data the extension already has, so the plan is ranked on
  // real seat counts and meeting times when they are available.
  const sectionsByCourse = await requestScrapedSections();

  const plan = buildBookingPlan({
    grid,
    yearIndex,
    term,
    termCode,
    catalog,
    sectionsByCourse,
    pass,
    level,
    preferences,
    alreadyBooked,
  });
  plan.generatedAt = Date.now();

  const ack = await sendPlanToBridge(plan);
  return { plan, delivered: Boolean(ack?.ok) };
}

export { EVENTS as BRIDGE_EVENTS };
