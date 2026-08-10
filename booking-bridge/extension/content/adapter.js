/**
 * TSS adapter: turns the live Fiori DOM into data, and turns a booking plan
 * into on-screen guidance.
 *
 * Design rules:
 *  - Every DOM lookup goes through resolve(), which reports named failures
 *    instead of returning null. During a two-day enrollment window, a tool
 *    that silently does nothing is worse than one that says it is broken.
 *  - Column positions are discovered from header text, not hardcoded, because
 *    Fiori lets users reorder and hide columns.
 *  - Nothing here submits a booking on its own. See overlay.js for why the
 *    final click stays with the student.
 */

(() => {
  const SELECTORS = window.TPBB_SELECTORS;

  // --- selector resolution -------------------------------------------------

  const failures = new Set();

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Find elements matching one candidate strategy. */
  function tryCandidate(candidate, root = document) {
    switch (candidate.kind) {
      case "css":
        return [...root.querySelectorAll(candidate.value)];

      case "role":
        return [...root.querySelectorAll(`[role='${candidate.value}']`)];

      case "text": {
        const tag = candidate.tag || "*";
        const wanted = normalizeText(candidate.text);
        return [...root.querySelectorAll(tag)].filter(
          (el) => normalizeText(el.textContent) === wanted
        );
      }

      case "ui5":
        // UI5 stamps its control type into a data attribute on the root node
        // of each control; fall back to the sap* class convention.
        return [
          ...root.querySelectorAll(`[data-sap-ui-control-type='${candidate.type}']`),
          ...(candidate.type.startsWith("sap.m.")
            ? root.querySelectorAll(`.${candidate.type.replace("sap.m.", "sapM")}`)
            : []),
        ];

      case "ui5Text": {
        const wanted = normalizeText(candidate.text);
        return tryCandidate({ kind: "ui5", type: candidate.type }, root).filter(
          (el) => normalizeText(el.textContent).includes(wanted)
        );
      }

      default:
        return [];
    }
  }

  /**
   * Resolve a named target. Returns { ok, elements, strategy } — never throws,
   * and records misses so the overlay can surface exactly which selector is
   * stale rather than a generic failure.
   */
  function resolve(targetName, { root = document, all = false } = {}) {
    const target = SELECTORS.targets[targetName];
    if (!target) return { ok: false, elements: [], reason: `unknown target '${targetName}'` };

    for (const candidate of target.candidates || []) {
      const found = tryCandidate(candidate, root).filter(
        (el) => el.offsetParent !== null || el === document.body
      );
      if (found.length) {
        return { ok: true, elements: all ? found : [found[0]], strategy: candidate };
      }
    }

    failures.add(targetName);
    return {
      ok: false,
      elements: [],
      reason: `no candidate matched '${targetName}' (${target.description})`,
    };
  }

  // --- schedule of classes scraping ---------------------------------------

  /** Map discovered column headers onto our field names. */
  function mapColumns(headerCells) {
    const aliases = SELECTORS.targets.socRowCells.headerAliases;
    const columns = {};

    headerCells.forEach((cell, index) => {
      const label = normalizeText(cell.textContent);
      if (!label) return;
      for (const [field, options] of Object.entries(aliases)) {
        if (columns[field] !== undefined) continue;
        if (options.some((option) => label === option || label.includes(option))) {
          columns[field] = index;
          return;
        }
      }
    });

    return columns;
  }

  // Pure text parsers live in parsing.js so they can be unit tested directly.
  const { parseDays, parseTimeRange, parseSeats, normalizeCourseId } = window.TPBB_parsing;
  const normalizeStatus = (raw) => window.TPBB_parsing.normalizeStatus(raw, SELECTORS.statusText);

  /**
   * Read the visible Schedule of Classes results into section objects.
   *
   * Only reads what is rendered. Fiori tables virtualize rows, so this returns
   * what is on screen and reports the count — the caller is responsible for
   * scrolling and merging if it needs the full result set.
   */
  function scrapeSchedule() {
    const tableResult = resolve("socResultsTable");
    if (!tableResult.ok) {
      return { ok: false, reason: tableResult.reason, sections: [] };
    }
    const table = tableResult.elements[0];

    const headerSpec = SELECTORS.targets.socRowCells;
    let headerCells = [];
    for (const candidate of headerSpec.headerCandidates) {
      headerCells = tryCandidate(candidate, table);
      if (headerCells.length) break;
    }
    if (!headerCells.length) {
      return { ok: false, reason: "could not find column headers", sections: [] };
    }

    const columns = mapColumns(headerCells);
    if (columns.courseId === undefined && columns.sectionId === undefined) {
      return {
        ok: false,
        reason: `headers did not match known aliases: ${headerCells
          .map((c) => normalizeText(c.textContent))
          .filter(Boolean)
          .join(" | ")}`,
        sections: [],
      };
    }

    const rowsResult = resolve("socResultRow", { root: table, all: true });
    if (!rowsResult.ok) return { ok: false, reason: rowsResult.reason, sections: [] };

    const sections = [];
    for (const row of rowsResult.elements) {
      let cells = [];
      for (const candidate of headerSpec.cellCandidates) {
        cells = tryCandidate(candidate, row);
        if (cells.length) break;
      }
      if (!cells.length) continue;

      const valueAt = (field) => {
        const index = columns[field];
        if (index === undefined || !cells[index]) return "";
        return String(cells[index].textContent || "").replace(/\s+/g, " ").trim();
      };

      const courseId = valueAt("courseId");
      const sectionId = valueAt("sectionId");
      if (!courseId && !sectionId) continue;

      const { start, end } = parseTimeRange(valueAt("time"));
      sections.push({
        courseId: normalizeCourseId(courseId),
        sectionId: sectionId || null,
        component: valueAt("component") || null,
        days: parseDays(valueAt("days")),
        start,
        end,
        instructor: valueAt("instructor") || null,
        location: valueAt("location") || null,
        units: valueAt("units") || null,
        status: normalizeStatus(valueAt("status") || valueAt("seats")),
        ...parseSeats(valueAt("seats")),
        scrapedFrom: location.pathname + location.hash,
      });
    }

    return {
      ok: true,
      sections,
      columnsFound: Object.keys(columns),
      rowsSeen: rowsResult.elements.length,
      note: "Fiori virtualizes rows; scroll and re-scrape to capture long result sets.",
    };
  }

  // --- booking assistance --------------------------------------------------

  /**
   * Locate the controls for one booking step and prefill what is safe to
   * prefill (grading option, credit hours). Returns a report describing what
   * was found and what the student still needs to do.
   */
  function prepareBooking(step) {
    const report = { courseId: step.courseId, prepared: [], missing: [], ready: false };

    const grading = resolve("gradingOptionControl");
    if (grading.ok && step.gradingOption) {
      const control = grading.elements[0];
      const wanted = step.gradingOption === "pnp" ? /pass|p\/np|no pass/i : /letter|graded/i;
      if (control.tagName === "SELECT") {
        const option = [...control.options].find((o) => wanted.test(o.textContent));
        if (option) {
          control.value = option.value;
          control.dispatchEvent(new Event("change", { bubbles: true }));
          report.prepared.push(`grading option -> ${option.textContent.trim()}`);
        }
      } else {
        report.missing.push("grading option is a UI5 control; set it manually");
      }
    } else if (!grading.ok) {
      report.missing.push(grading.reason);
    }

    if (step.variableUnits) {
      const credits = resolve("creditHoursInput");
      if (credits.ok && step.units) {
        const input = credits.elements[0];
        input.value = String(step.units);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        report.prepared.push(`credit hours -> ${step.units}`);
      } else {
        report.missing.push("variable-unit course: set credit hours manually");
      }
    }

    const submit = resolve("bookSaveButton");
    if (submit.ok) {
      report.ready = true;
      report.submitElement = submit.elements[0];
    } else {
      report.missing.push(submit.reason);
    }

    return report;
  }

  /** Read back whatever TSS said after an attempt. */
  function readResult() {
    const message = resolve("resultMessage");
    if (!message.ok) return { ok: false, reason: message.reason };
    const text = String(message.elements[0].textContent || "").replace(/\s+/g, " ").trim();
    return { ok: true, text, status: normalizeStatus(text) };
  }

  window.__TPBB_adapter = {
    resolve,
    scrapeSchedule,
    prepareBooking,
    readResult,
    parseDays,
    parseTimeRange,
    parseSeats,
    normalizeStatus,
    diagnostics: () => ({
      verified: SELECTORS.verified,
      capturedAgainst: SELECTORS.capturedAgainst,
      failedTargets: [...failures],
      url: location.origin + location.pathname,
    }),
  };
})();
