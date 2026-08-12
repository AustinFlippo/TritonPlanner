/**
 * The on-page panel shown inside TSS.
 *
 * Why the final click stays with the student:
 *
 * TSS is a stateful SAP session, and UCSD's own booking guide warns that even
 * having two TSS tabs open "can cause errors, lock you out of your account, or
 * freeze your registration". Synthetic clicks fired at a Fiori control that is
 * mid-round-trip can leave a booking half-committed, and the account that gets
 * frozen is the student's — during a two-day window, with no undo.
 *
 * So this panel does everything up to the commit: ranks the courses, finds the
 * section, prefills grading and credit hours, scrolls the button into view and
 * highlights it. The student presses it. That keeps the speed benefit (no
 * searching, no deciding under pressure) without betting an enrollment window
 * on a selector guess.
 */

(() => {
  const adapter = window.__TPBB_adapter;
  const PANEL_ID = "tpbb-panel";

  let state = {
    plan: null,
    stepIndex: 0,
    collapsed: false,
    lastMessage: null,
    capture: null,
    stale: false,
  };

  // --- helpers -------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function flash(message, tone = "info") {
    state.lastMessage = { message, tone };
    render();
  }

  function highlight(target) {
    document.querySelectorAll(".tpbb-highlight").forEach((n) => n.classList.remove("tpbb-highlight"));
    if (!target) return;
    target.classList.add("tpbb-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // --- actions -------------------------------------------------------------

  /**
   * Read extension storage, or report that this page is orphaned.
   *
   * After the extension is reloaded, an already-injected content script keeps
   * running with no way back — every call throws about `undefined`. Detect it
   * once here so the panel can say "reload the page" instead of the student
   * seeing a stack trace in chrome://extensions.
   */
  async function readStorage(keys) {
    if (!window.TPBB_runtime.alive()) return null;
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return null;
    }
  }

  async function loadPlan() {
    const stored = await readStorage("bookingPlan");
    if (stored === null) {
      state.stale = true;
      render();
      return;
    }
    state.plan = stored.bookingPlan || null;
    state.stepIndex = 0;
    render();
  }

  /**
   * Summarize what has been captured so far.
   *
   * Read from storage rather than asking the worker: the fetch that filled it
   * was triggered from the planner tab, so storage is the one place both sides
   * can see.
   */
  async function loadCapture() {
    const stored = await readStorage(["scrapedSections", "sectionsUpdatedAt"]);
    if (stored === null) {
      state.stale = true;
      render();
      return;
    }
    const sections = stored.scrapedSections || {};
    state.capture = {
      courses: Object.keys(sections).length,
      sections: Object.values(sections).reduce((total, list) => total + list.length, 0),
      updatedAt: stored.sectionsUpdatedAt || null,
    };
    render();
  }

  function prepareCurrentStep() {
    const step = state.plan?.steps?.[state.stepIndex];
    if (!step) return;

    const report = adapter.prepareBooking(step);
    if (report.submitElement) {
      highlight(report.submitElement);
      const prepared = report.prepared.length
        ? ` Prefilled: ${report.prepared.join(", ")}.`
        : "";
      flash(
        `${step.courseId} is ready — the highlighted Book/Save button is yours to press.${prepared}`,
        "ok"
      );
    } else {
      flash(
        `Could not find the Book/Save button. ${report.missing.join(" ")} ` +
          `Selectors may need re-capturing.`,
        "error"
      );
    }
  }

  function checkResult() {
    const result = adapter.readResult();
    if (!result.ok) {
      flash(`No confirmation message found: ${result.reason}`, "warn");
      return;
    }
    flash(`TSS says: "${result.text}"`, result.status === "booked" ? "ok" : "info");
    if (result.status === "booked" || result.status === "booked-waitlist") {
      advance();
    }
  }

  function advance() {
    if (!state.plan) return;
    if (state.stepIndex < state.plan.steps.length - 1) state.stepIndex += 1;
    render();
  }

  /**
   * Export the structure of a page so its selectors can be written.
   *
   * One-time setup for booking screens — section data already comes from OData.
   * Only offered while selectors.js is still unverified.
   */
  async function capturePage() {
    const label = prompt(
      "Label this capture (e.g. 'booking-screen'):",
      "booking-screen"
    );
    if (label === null) return;

    const snapshot = await window.__TPBB_capture(label);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tss-capture-${label.replace(/[^a-z0-9-]+/gi, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    flash(
      `Captured ${snapshot.nodesVisited} nodes` +
        (snapshot.ui5?.available ? ` plus the UI5 control tree` : "") +
        `. Saved to your downloads.`,
      "ok"
    );
  }

  // --- rendering -----------------------------------------------------------

  function renderStep(step, index) {
    const row = el("div", `tpbb-step${index === state.stepIndex ? " tpbb-step-current" : ""}`);
    row.appendChild(el("span", "tpbb-rank", String(index + 1)));

    const body = el("div", "tpbb-step-body");
    body.appendChild(el("div", "tpbb-course", `${step.courseId} · ${step.units} units`));
    body.appendChild(el("div", "tpbb-title", step.title || ""));

    const target = step.targets?.[0];
    if (target) {
      const when = target.days?.length
        ? `${target.days.join("")} ${target.start || "?"}–${target.end || "?"}`
        : "time TBA";
      body.appendChild(el("div", "tpbb-section", `Section ${target.sectionId || "?"} · ${when}`));
      if (step.targets.length > 1) {
        body.appendChild(
          el("div", "tpbb-fallback", `${step.targets.length - 1} fallback section(s) ready`)
        );
      }
    } else {
      body.appendChild(el("div", "tpbb-section tpbb-muted", "No section data yet — open Quarter View"));
    }

    if (step.criticality?.reasons?.length) {
      body.appendChild(el("div", "tpbb-why", step.criticality.reasons.join("; ")));
    }

    row.appendChild(body);
    row.addEventListener("click", () => {
      state.stepIndex = index;
      render();
    });
    return row;
  }

  function render() {
    document.getElementById(PANEL_ID)?.remove();

    const panel = el("div", "tpbb-panel");
    panel.id = PANEL_ID;
    if (state.collapsed) panel.classList.add("tpbb-collapsed");

    const header = el("div", "tpbb-header");
    header.appendChild(el("span", "tpbb-logo", "TritonPlanner"));
    const toggle = el("button", "tpbb-toggle", state.collapsed ? "▸" : "▾");
    toggle.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      render();
    });
    header.appendChild(toggle);
    panel.appendChild(header);

    if (!state.collapsed) {
      // Nothing below this can work on an orphaned page, so say so first and
      // plainly — this is the state every extension reload leaves behind.
      if (state.stale) {
        panel.appendChild(el("div", "tpbb-banner tpbb-warn", window.TPBB_runtime.STALE_MESSAGE));
        document.body.appendChild(panel);
        return;
      }

      const diagnostics = adapter.diagnostics();
      if (!diagnostics.verified) {
        panel.appendChild(
          el(
            "div",
            "tpbb-banner tpbb-warn",
            "Booking helpers are not verified on live TSS yet. " +
              "On the booking screen, use “Capture page structure” once and send the file."
          )
        );
      }

      if (state.capture) {
        const { courses, sections } = state.capture;
        panel.appendChild(
          el(
            "div",
            "tpbb-banner",
            courses
              ? `${sections} section${sections === 1 ? "" : "s"} across ${courses} ` +
                  `course${courses === 1 ? "" : "s"} ready. Refresh from Quarter View.`
              : "No sections stored yet. Open Quarter View in TritonPlanner to fetch them."
          )
        );
      }

      if (state.plan) {
        const summary = el("div", "tpbb-summary");
        summary.appendChild(
          el(
            "div",
            "tpbb-summary-line",
            `${state.plan.termCode} · pass ${state.plan.pass} · ` +
              `${state.plan.totalUnits}/${state.plan.unitCap} units`
          )
        );
        if (state.plan.deferred?.length) {
          summary.appendChild(
            el("div", "tpbb-summary-sub", `${state.plan.deferred.length} deferred to next pass`)
          );
        }
        panel.appendChild(summary);

        const steps = el("div", "tpbb-steps");
        state.plan.steps.forEach((step, index) => steps.appendChild(renderStep(step, index)));
        panel.appendChild(steps);
      } else {
        panel.appendChild(
          el("div", "tpbb-banner", "No booking plan loaded. Send one from TritonPlanner.")
        );
      }

      const actions = el("div", "tpbb-actions");
      const button = (label, handler, variant = "") => {
        const b = el("button", `tpbb-btn ${variant}`, label);
        b.addEventListener("click", handler);
        actions.appendChild(b);
      };

      if (state.plan) {
        button("Prepare this course", prepareCurrentStep, "tpbb-primary");
        button("Check result", checkResult);
      }

      // One-time setup only — disappears once selectors.js is marked verified.
      if (!diagnostics.verified) {
        button("Capture page structure", capturePage, "tpbb-ghost");
      }

      if (actions.childNodes.length) panel.appendChild(actions);

      if (state.lastMessage) {
        panel.appendChild(
          el("div", `tpbb-message tpbb-${state.lastMessage.tone}`, state.lastMessage.message)
        );
      }

      panel.appendChild(
        el(
          "div",
          "tpbb-footnote",
          "This panel prepares bookings. You press Book/Save yourself — " +
            "TSS can freeze a registration if its session is driven automatically."
        )
      );
    }

    document.body.appendChild(panel);
  }

  // --- boot ----------------------------------------------------------------

  function boot() {
    if (window.top !== window.self) return; // top frame only
    if (document.getElementById(PANEL_ID)) return;
    loadPlan();
    loadCapture();
  }

  if (window.TPBB_runtime.alive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.bookingPlan) loadPlan();
      if (changes.scrapedSections) loadCapture();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
