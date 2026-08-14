import {
  canonicalRangeToken,
  courseRangeToken,
  isRangeSeparator,
} from "./courseRanges.js";

/**
 * Read one subrequirement's course options as OR-groups.
 *
 * Each option in the audit looks like
 *   <span class="course draggable" number="100" department="DSC ">
 *     <span class="number">100</span>          <-- bare: the run continues DSC
 *   </span>
 * so the attributes are authoritative and the visible text is not. Options
 * joined by the literal word "OR" are alternatives for a single slot:
 *   [MATH 189] OR [DSC 152], [DSC 100], ... , [DSC 140A] OR [CSE 150A]
 * is seven slots, four of which offer a choice.
 *
 * A range is one option, not two. "ECON 100 to ECON 199" (and the hyphenated
 * single-span form "ECON 100-199") collapses to the token "ECON 100TO199"
 * that search and requirement matching already expand.
 */
export const readCourseGroups = (container) => {
  if (!container) return [];

  const codeOf = (el) => {
    const dept = (el.getAttribute?.("department") || "").trim();
    const number = (el.getAttribute?.("number") || "").trim();
    if (dept && number) return `${dept} ${number}`.replace(/\s+/g, " ");
    // No attributes (older audit exports): fall back to the visible text.
    const text = (el.querySelector?.(".number")?.textContent || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  };

  // Read options and the text between them in document order.
  //
  // Sibling-walking is NOT enough: long lists wrap onto new table rows, so an
  // "OR" can sit after </td></tr> in a different row from the option it joins.
  // That silently split DS25 Core into 8 slots instead of 7, which made the
  // slot count stop matching NEEDS and demoted the whole requirement to
  // "pick any 7 of 11" — the exact bug this parser exists to prevent.
  //
  // Descendants of an option are skipped so its own label never counts as
  // separator text.
  const tokens = []; // {code} for options, {text} for everything between
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        tokens.push({ text: child.nodeValue || "" });
      } else if (child.nodeType === 1) {
        if (child.classList?.contains("course")) {
          const code = codeOf(child);
          if (code) tokens.push({ code: canonicalRangeToken(code) });
        } else {
          walk(child);
        }
      }
    }
  };
  walk(container);

  const groups = [];
  let current = [];
  let between = "";
  for (const token of tokens) {
    if (token.text !== undefined) {
      between += token.text;
      continue;
    }
    if (current.length) {
      const joined =
        isRangeSeparator(between) &&
        courseRangeToken(current[current.length - 1], token.code);
      if (joined) {
        current[current.length - 1] = joined;
        between = "";
        continue;
      }
      if (!/\bOR\b/i.test(between)) {
        groups.push(current);
        current = [];
      }
    }
    current.push(token.code);
    between = "";
  }
  if (current.length) groups.push(current);
  return groups;
};
