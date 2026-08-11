/**
 * Runs on the TritonPlanner dev server (localhost) and carries a booking plan
 * into the extension.
 *
 * The page cannot talk to the extension directly, so TritonPlanner dispatches
 * a CustomEvent and this content script relays it. Only two event names are
 * accepted and only from the page's own origin — this is a one-way door into
 * extension storage, so it stays narrow on purpose.
 */

(() => {
  const OUTBOUND = "tritonplanner:booking-plan";
  const REQUEST_SECTIONS = "tritonplanner:request-sections";
  const SECTIONS_REPLY = "tritonplanner:sections";
  const PING = "tritonplanner:ping";
  const READY = "tritonplanner:bridge-ready";
  const FETCH_SECTIONS = "tritonplanner:fetch-sections";
  const FETCH_REPLY = "tritonplanner:fetch-sections-result";
  const FETCH_TERM_OFFERINGS = "tritonplanner:fetch-term-offerings";
  const FETCH_TERM_OFFERINGS_REPLY = "tritonplanner:fetch-term-offerings-result";
  const FETCH_TERM_SECTIONS = "tritonplanner:fetch-term-sections";
  const FETCH_TERM_SECTIONS_REPLY = "tritonplanner:fetch-term-sections-result";
  const TERM_PROGRESS = "tritonplanner:term-progress";
  const TERM_PROGRESS_REPLY = "tritonplanner:term-progress-result";

  function isPlausiblePlan(plan) {
    return Boolean(
      plan &&
        typeof plan === "object" &&
        Array.isArray(plan.steps) &&
        typeof plan.termCode === "string" &&
        plan.steps.length <= 40
    );
  }

  window.addEventListener(OUTBOUND, (event) => {
    const plan = event.detail;
    if (!isPlausiblePlan(plan)) {
      console.warn("[TritonPlanner Bridge] ignored a malformed booking plan");
      return;
    }
    window.TPBB_runtime.sendMessage({ type: "TPBB_SET_PLAN", payload: plan }).then((result) => {
      window.dispatchEvent(
        new CustomEvent("tritonplanner:booking-plan-ack", {
          detail: {
            ok: Boolean(result.response?.ok),
            stale: Boolean(result.stale),
            steps: plan.steps.length,
          },
        })
      );
    });
  });

  function deliverSections(response, pushed) {
    window.dispatchEvent(
      new CustomEvent(SECTIONS_REPLY, {
        detail: {
          sections: response?.sections || {},
          updatedAt: response?.updatedAt || null,
          pushed,
        },
      })
    );
  }

  // Lets the planner pull back whatever section data has been scraped from TSS
  // so it can re-rank a plan with real seat counts and meeting times.
  window.addEventListener(REQUEST_SECTIONS, () => {
    window.TPBB_runtime
      .sendMessage({ type: "TPBB_GET_SECTIONS" })
      .then((result) => deliverSections(result.response, false));
  });

  /**
   * Ask the service worker to pull live sections for a set of courses.
   *
   * The planner page cannot call TSS itself — wrong origin, and no session
   * cookie would be attached. The worker can, so this is the relay. A merged
   * result arrives separately through the storage-change push below; this reply
   * only reports whether the pull succeeded.
   */
  window.addEventListener(FETCH_SECTIONS, (event) => {
    const { courseIds, year, term } = event.detail || {};
    if (!Array.isArray(courseIds) || !courseIds.length) return;
    window.TPBB_runtime
      .sendMessage({
        type: "TPBB_FETCH_SECTIONS",
        payload: { courseIds: courseIds.slice(0, 60), year, term },
      })
      .then((result) => {
        window.dispatchEvent(
          new CustomEvent(FETCH_REPLY, {
            detail: result.stale
              ? { ok: false, reason: result.reason, stale: true }
              : result.response || { ok: false, reason: "no response from the extension" },
          })
        );
      });
  });

  /**
   * Fetch a whole term's schedule and hand it back to the page.
   *
   * The page then publishes it to Supabase, because only the page is signed in
   * as the admin — the extension has no Supabase session and no business
   * holding one. Extension reads TSS, page writes the database.
   */
  window.addEventListener(FETCH_TERM_SECTIONS, (event) => {
    const { year, term } = event.detail || {};
    if (!year || !term) return;
    window.TPBB_runtime
      .sendMessage({ type: "TPBB_FETCH_TERM_SECTIONS", payload: { year: String(year), term } })
      .then((result) => {
        window.dispatchEvent(
          new CustomEvent(FETCH_TERM_SECTIONS_REPLY, {
            detail: result.stale
              ? { ok: false, reason: result.reason, stale: true, sections: [], count: 0 }
              : result.response || { ok: false, reason: "no response from the extension" },
          })
        );
      });
  });

  // Polled while a term fetch runs — it takes a minute or two and a single
  // round trip cannot report anything until it finishes.
  window.addEventListener(TERM_PROGRESS, () => {
    window.TPBB_runtime.sendMessage({ type: "TPBB_GET_TERM_PROGRESS" }).then((result) => {
      window.dispatchEvent(
        new CustomEvent(TERM_PROGRESS_REPLY, { detail: result.response?.progress || null })
      );
    });
  });

  window.addEventListener(FETCH_TERM_OFFERINGS, (event) => {
    const { year, term, dept } = event.detail || {};
    if (!year || !term) return;
    window.TPBB_runtime
      .sendMessage({
        type: "TPBB_FETCH_TERM_OFFERINGS",
        payload: { year: String(year), term, dept: dept || null },
      })
      .then((result) => {
        window.dispatchEvent(
          new CustomEvent(FETCH_TERM_OFFERINGS_REPLY, {
            detail: result.stale
              ? { ok: false, reason: result.reason, stale: true, courses: [], count: 0 }
              : result.response || {
                  ok: false,
                  reason: "no response from the extension",
                  courses: [],
                  count: 0,
                },
          })
        );
      });
  });

  // Push, so the planner never shows stale sections while a TSS tab is actively
  // capturing in the background. Without this the student has to know to come
  // back and press Sync — which is exactly the manual step this removes.
  if (window.TPBB_runtime.alive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.scrapedSections) return;
      window.TPBB_runtime
        .sendMessage({ type: "TPBB_GET_SECTIONS" })
        .then((result) => deliverSections(result.response, true));
    });
  }

  const announce = () =>
    window.dispatchEvent(new CustomEvent(READY, { detail: { version: "0.1.0" } }));

  // Answer probes as well as announcing once. The announcement below fires at
  // document_idle, but Quarter View mounts when the student clicks its tab —
  // usually minutes later — so a listener that only waits for the announcement
  // always misses it and reports the extension as missing while it is running.
  window.addEventListener(PING, announce);

  // Announce availability so the app can show a "connected" state instead of
  // guessing whether the extension is installed.
  announce();
})();
