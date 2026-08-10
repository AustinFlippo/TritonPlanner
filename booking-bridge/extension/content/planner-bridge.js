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
    chrome.runtime.sendMessage({ type: "TPBB_SET_PLAN", payload: plan }, (response) => {
      window.dispatchEvent(
        new CustomEvent("tritonplanner:booking-plan-ack", {
          detail: { ok: Boolean(response?.ok), steps: plan.steps.length },
        })
      );
    });
  });

  // Lets the planner pull back whatever section data has been scraped from TSS
  // so it can re-rank a plan with real seat counts and meeting times.
  window.addEventListener(REQUEST_SECTIONS, () => {
    chrome.runtime.sendMessage({ type: "TPBB_GET_SECTIONS" }, (response) => {
      window.dispatchEvent(
        new CustomEvent(SECTIONS_REPLY, { detail: response?.sections || {} })
      );
    });
  });

  // Announce availability so the app can show a "connected" state instead of
  // guessing whether the extension is installed.
  window.dispatchEvent(new CustomEvent("tritonplanner:bridge-ready", { detail: { version: "0.1.0" } }));
})();
