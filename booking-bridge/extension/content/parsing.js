/**
 * Pure parsers for the text TSS renders into its Schedule of Classes table.
 *
 * Kept free of DOM access so they can be unit tested directly (see
 * core/parsing.test.mjs, which evaluates this exact file). Loaded as a plain
 * content script, so no import/export syntax here.
 */

(() => {
  // TSS day columns use SAP/US mixed conventions. R = Thursday, matching the
  // convention the rest of TritonPlanner already uses.
  const DAY_TOKENS = { M: "M", TU: "T", T: "T", W: "W", TH: "R", R: "R", F: "F", S: "S" };

  /** "MWF" / "TuTh" / "M,W,F" -> ["M","W","F"] */
  function parseDays(raw) {
    const text = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "");
    const days = [];
    let i = 0;
    while (i < text.length) {
      const pair = text.slice(i, i + 2);
      // Two-letter tokens must win, or "TH" parses as Tuesday + Thursday.
      if (pair === "TU" || pair === "TH") {
        days.push(DAY_TOKENS[pair]);
        i += 2;
        continue;
      }
      const single = DAY_TOKENS[text[i]];
      if (single) days.push(single);
      i += 1;
    }
    return [...new Set(days)];
  }

  /** "10:00a-10:50a" / "2:00p - 3:20p" -> { start, end } */
  function parseTimeRange(raw) {
    const match = String(raw || "").match(
      /(\d{1,2}:?\d{0,2}\s*[ap]?\.?m?\.?)\s*(?:-|–|—|to)\s*(\d{1,2}:?\d{0,2}\s*[ap]?\.?m?\.?)/i
    );
    if (!match) return { start: null, end: null };
    const clean = (value) => value.replace(/[\s.]/g, "").toLowerCase();
    return { start: clean(match[1]), end: clean(match[2]) };
  }

  /** Fold TSS status wording into our normalized vocabulary. */
  function normalizeStatus(raw, statusText) {
    const text = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) return "unknown";
    // Longest phrases first, so "waitlist inactive" is not swallowed by
    // "waitlist", and "booked on wait list" is not swallowed by "booked".
    const entries = [];
    for (const [status, phrases] of Object.entries(statusText || {})) {
      for (const phrase of phrases) entries.push([status, phrase]);
    }
    entries.sort((a, b) => b[1].length - a[1].length);
    for (const [status, phrase] of entries) {
      if (text.includes(phrase)) return status;
    }
    return "unknown";
  }

  /** "CSE-101" / "cse 101" -> "CSE 101" */
  function normalizeCourseId(raw) {
    if (!raw) return null;
    const cleaned = String(raw).toUpperCase().replace(/\s+/g, " ").trim();
    const match = cleaned.match(/^([A-Z]{2,5})\s*[- ]?\s*0*(\d{1,3}[A-Z]{0,3})$/);
    // TSS's OData writes course numbers zero-padded ("AAS-010R", "CSE-008A")
    // while the catalog and the planner grid use "AAS 10R" / "CSE 8A". Strip
    // the padding here or nothing from OData ever matches a planned course.
    return match ? `${match[1]} ${match[2]}` : cleaned || null;
  }

  const api = { parseDays, parseTimeRange, normalizeStatus, normalizeCourseId };

  if (typeof window !== "undefined") window.TPBB_parsing = api;
  if (typeof globalThis !== "undefined") globalThis.TPBB_parsing = api;
})();
