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

  let state = { plan: null, stepIndex: 0, collapsed: false, lastMessage: null };

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

  async function loadPlan() {
    const stored = await chrome.storage.local.get("bookingPlan");
    state.plan = stored.bookingPlan || null;
    state.stepIndex = 0;
    render();
  }

  function scrapeSections() {
    const result = adapter.scrapeSchedule();
    if (!result.ok) {
      flash(`Could not read the results table: ${result.reason}`, "error");
      return;
    }
    chrome.runtime.sendMessage({
      type: "TPBB_SECTIONS_SCRAPED",
      payload: { sections: result.sections, scrapedAt: Date.now() },
    });
    flash(
      `Read ${result.sections.length} section${result.sections.length === 1 ? "" : "s"} ` +
        `from ${result.rowsSeen} visible rows. Scroll and re-scrape for more.`,
      "ok"
    );
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

  async function capturePage() {
    // The first field capture came back with an empty grid — the search hadn't
    // been run yet, so the one thing we needed (column headers) wasn't in it.
    // Catch that at capture time instead of after the file has been shared.
    if (location.hash.startsWith("#YSchedule-view")) {
      const table = adapter.resolve("socResultsTable");
      const rows = table.ok
        ? table.elements[0].querySelectorAll(".sapMListTblRow").length
        : 0;
      if (!rows) {
        flash(
          "The results grid is empty. Set filters, press Go, wait for rows to " +
            "appear, then capture — an empty grid has no column headers to learn from.",
          "warn"
        );
        return;
      }
    }

    const label = prompt(
      "Label this capture (e.g. 'schedule-of-classes-results' or 'booking-screen'):",
      "unlabeled"
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
      body.appendChild(el("div", "tpbb-section tpbb-muted", "No section data — scrape first"));
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
      const diagnostics = adapter.diagnostics();
      if (!diagnostics.verified) {
        panel.appendChild(
          el(
            "div",
            "tpbb-banner tpbb-warn",
            "Selectors are unverified against live TSS. Use “Capture page structure” " +
              "on the Schedule of Classes and booking screens, then update selectors.js."
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
      button("Read sections on this page", scrapeSections);
      button("Prepare current step", prepareCurrentStep, "tpbb-primary");
      button("Check result", checkResult);
      button("Capture page structure", capturePage, "tpbb-ghost");
      panel.appendChild(actions);

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
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.bookingPlan) loadPlan();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
