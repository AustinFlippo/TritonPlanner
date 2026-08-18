// Group TSS / term_sections rows into enrollable packages (lecture + DI/lab).
// Shared by the quarter week grid and CourseDetails.

import { toMinutes } from "../../../../booking-bridge/core/bookingPlan.js";
import { aliasesFor, courseIdVariants } from "./courseIds.js";

export const normalizeSectionKey = (id) =>
  String(id || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const STATUS_RANK = {
  open: 0,
  "waitlist-active": 1,
  "booked-waitlist": 2,
  "conditionally-booked": 2,
  booked: 2,
  "waitlist-inactive": 3,
  unknown: 3,
  full: 4,
};

/**
 * One spelling of a seat status, whatever the producer used.
 *
 * Two vocabularies grew up side by side: the extension and this module speak
 * "waitlist-active", while the Class Planner scraper and the /seats proxy
 * emitted "waitlist active". A space is enough to miss STATUS_RANK, the seat
 * chip's waitlist branch and WeekSchedule's STATUS_STYLE all at once, so a
 * waitlisted course rendered as a red "Full". Both producers now emit the
 * hyphen; this stays so a snapshot written before that still reads correctly.
 */
export function normalizeSectionStatus(status) {
  if (!status) return null;
  return String(status).trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Keep only sections that belong to the quarter on screen.
 *
 * Matching is on the term's *name* (AcademicPeriod_Text, "Fall Quarter")
 * rather than its numeric code. A section with no term at all comes from the
 * DOM scrape — those return null so the caller can treat them as unverified.
 */
export function matchesTerm(section, year, term) {
  if (!section.termText && !section.year) return null; // term unknown
  if (year && section.year && String(section.year) !== String(year)) return false;
  if (term && section.termText) {
    return String(section.termText)
      .toLowerCase()
      .includes(String(term).toLowerCase());
  }
  return true;
}

/** Every map key that might hold sections for this course id. */
function candidateKeys(courseId) {
  const keys = new Set();
  for (const id of courseIdVariants(courseId)) {
    const norm = normalizeSectionKey(id);
    if (norm) keys.add(norm);
    for (const alias of aliasesFor(norm)) {
      keys.add(normalizeSectionKey(alias));
    }
  }
  return keys;
}

/**
 * Sections for a course, bridging cross-listed ids ("DSC 80" ↔ "DSC 80/80R").
 *
 * Prefer term-verified (OData) rows. If only unverified scrape rows exist,
 * return them with verified: false so the UI can avoid drawing wrong-term times.
 */
export function sectionsForCourse(course, sectionsByCourse, year, term) {
  const courseId = course?.course_id || course?.courseId;
  if (!courseId || !sectionsByCourse) {
    return { sections: [], verified: false };
  }

  const verified = [];
  const unverified = [];
  const wanted = candidateKeys(courseId);

  for (const [key, list] of Object.entries(sectionsByCourse)) {
    if (!list?.length) continue;
    const norm = normalizeSectionKey(key);
    if (!wanted.has(norm)) {
      // Compact fallback: published keys sometimes differ only by spacing
      let hit = false;
      for (const w of wanted) {
        if (w.replace(/\s+/g, "") === norm.replace(/\s+/g, "")) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    for (const s of list) {
      const m = matchesTerm(s, year, term);
      if (m === true) verified.push(s);
      else if (m === null) unverified.push(s);
    }
  }

  if (verified.length) return { sections: verified, verified: true };
  if (unverified.length) return { sections: unverified, verified: false };
  return { sections: [], verified: false };
}

/**
 * The day/time rectangles one section occupies.
 *
 * A section is not necessarily one time range: BENG 133's lecture meets M
 * 11:00–11:50 *and* T/R 9:30–10:50. `meetings` (from the Class Planner scrape)
 * lists every weekly slot with its own clock and room, so read it when it is
 * there; the flat days/start/end pair is the older, lossy view and stays as the
 * fallback for extension rows and pre-migration snapshots.
 *
 * Each block carries its own `start`/`end`/`location` so callers can label the
 * rectangle with the time it actually represents rather than the section's
 * nominal first meeting.
 */
export function blocksOf(section) {
  if (!section) return [];
  const slots =
    Array.isArray(section.meetings) && section.meetings.length
      ? section.meetings
      : [{ days: section.days, start: section.start, end: section.end, location: section.location }];

  const blocks = [];
  for (const slot of slots) {
    const startMin = toMinutes(slot?.start);
    if (startMin === null) continue;
    const endMin = toMinutes(slot?.end) ?? startMin + 50;
    for (const day of slot?.days || []) {
      blocks.push({
        day,
        startMin,
        endMin: Math.max(endMin, startMin + 20),
        start: slot.start ?? null,
        end: slot.end ?? null,
        location: slot.location ?? section.location ?? null,
      });
    }
  }
  return blocks;
}

/** Every package id a section belongs to, newest shape first. */
export function packageIdsOf(section) {
  const ids = Array.isArray(section?.packageIds)
    ? section.packageIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (ids.length) return [...new Set(ids)];
  // Legacy rows: a single id, or (DOM scrapes) no id at all — fall back to the
  // section-letter family the way TSS itself groups them (A00/A01).
  if (section?.packageId) return [String(section.packageId)];
  return [`letter:${String(section?.sectionId || "?")[0]}`];
}

const isPrimary = (s) => /^(LE|SE)$/i.test(s?.component || "");

/**
 * Group a course's sections into the packages you actually enrol in.
 *
 * A package is one lecture plus the discussion/lab that goes with it, and a
 * section belongs to EVERY package that names it — CSE 8A's single lecture is a
 * member of all nine of its labs' packages, which is exactly why membership has
 * to be read from the full `packageIds` array. Grouping on `packageIds[0]`
 * put the lecture in one package and left the other eight as lab-only orphans,
 * so the grid could not draw a complete enrollment.
 *
 * Two clean-ups follow from fan-out:
 *   - Identical member sets are collapsed. UCSD hands out several package ids
 *     that resolve to the same single section; without this they show up as
 *     several identical, unenrollable options.
 *   - Once at least one package carries a lecture/seminar, packages without one
 *     are dropped. Those are the stray ids a lab carries from another course's
 *     package family, never something a student can enrol in on its own.
 *
 * Seats are the package's, not the lecture's: enrolling means getting a seat in
 * every section of the bundle, so the binding constraint is the tightest one.
 */
export function packagesFor(sections) {
  const timed = (sections || []).filter(
    (s) => blocksOf(s).length > 0
  );
  const groups = new Map();
  for (const section of timed) {
    for (const key of packageIdsOf(section)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(section);
    }
  }

  // Collapse duplicate ids that describe the same bundle. The surviving id is
  // the lowest-sorting one, and the rest are kept as aliases so a package id
  // saved on a plan still resolves after the collapse.
  const sectionKey = (s) => s.sectionRef || s.sectionId || "?";
  const bySignature = new Map();
  for (const [id, members] of groups) {
    const signature = members.map(sectionKey).sort().join("|");
    if (!bySignature.has(signature)) bySignature.set(signature, { ids: [], members });
    bySignature.get(signature).ids.push(id);
  }

  let entries = [...bySignature.values()].map(({ ids, members }) => ({
    ids: [...ids].sort(),
    members,
    keys: new Set(members.map(sectionKey)),
  }));

  // Drop packages that are a strict subset of another.
  //
  // UCSD publishes ids covering the lecture alone alongside the ids that pair
  // that lecture with each discussion — MATH 20C's lecture carries nine ids of
  // which only six name a discussion. A lecture-only "option" is not something
  // you can enrol in when the course requires a discussion, and it sorted to
  // the top of the list (biggest lecture hall, most seats), so the default
  // package a student saw was one that could not be booked. The same rule
  // clears the lab-only ids a linked section drags in from another course's
  // package family.
  entries = entries.filter(
    (e) =>
      !entries.some(
        (other) =>
          other !== e &&
          other.keys.size > e.keys.size &&
          [...e.keys].every((k) => other.keys.has(k))
      )
  );

  // Anything left with no lecture/seminar at all is another stray id — but only
  // filter once we know this course does publish primary-bearing packages, so a
  // lab-only or practicum-only course keeps everything it has.
  if (entries.some((e) => e.members.some(isPrimary))) {
    entries = entries.filter((e) => e.members.some(isPrimary));
  }

  const packages = entries.map(({ ids, members }) => {
    const primary = members.find(isPrimary) || members[0];
    const seats = members
      .map((m) => m.seatsAvailable)
      .filter((n) => Number.isFinite(n));
    // Worst status in the bundle: a package with a full lab is not "open"
    // because its lecture is.
    const statuses = members.map((m) => normalizeSectionStatus(m.status)).filter(Boolean);
    const status = statuses.length
      ? statuses.reduce((worst, s) =>
          (STATUS_RANK[s] ?? 3) > (STATUS_RANK[worst] ?? 3) ? s : worst
        )
      : null;
    const bottleneck = seats.length
      ? members
          .filter((m) => Number.isFinite(m.seatsAvailable))
          .reduce((a, b) => (b.seatsAvailable < a.seatsAvailable ? b : a))
      : null;
    return {
      id: ids[0],
      // Every id UCSD gave this same bundle, so a saved packageId still matches.
      packageIds: ids,
      meetings: members,
      primary,
      status,
      // The bundle's seat headroom, not the lecture's.
      seatsAvailable: seats.length ? Math.min(...seats) : null,
      seatsTotal: Number.isFinite(bottleneck?.seatsTotal)
        ? bottleneck.seatsTotal
        : (primary?.seatsTotal ?? null),
      // Which section is the binding constraint, so the UI can say so.
      seatsLimitedBy: seats.length > 1 && bottleneck !== primary ? bottleneck : null,
      instructors: [
        ...new Set(members.map((m) => m.instructor).filter(Boolean)),
      ],
      blocks: members.flatMap(blocksOf),
    };
  });

  return packages.sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
      (b.seatsAvailable ?? -1) - (a.seatsAvailable ?? -1) ||
      String(a.id).localeCompare(String(b.id))
  );
}

/** Does this package answer to `packageId` (its own id or a collapsed alias)? */
export const packageMatchesId = (pkg, packageId) => {
  if (!pkg || !packageId) return false;
  const wanted = String(packageId);
  if (String(pkg.id) === wanted) return true;
  return (pkg.packageIds || []).some((id) => String(id) === wanted);
};

export const blocksOverlap = (a, b) =>
  a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin;

/**
 * Side-by-side columns for overlapping meetings so the one underneath stays
 * clickable. Non-overlapping blocks keep full width (`colCount` 1).
 *
 * Columns are assigned greedily by start time; a connected cluster of overlaps
 * shares one `colCount` so a chain A∩B, B∩C still lines up even when A and C
 * do not themselves overlap.
 */
export function layoutOverlappingBlocks(blocks) {
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin
  );
  const n = sorted.length;
  if (n === 0) return [];

  const col = Array(n).fill(0);
  const colEnds = [];
  for (let i = 0; i < n; i++) {
    let placed = colEnds.findIndex((end) => end <= sorted[i].startMin);
    if (placed === -1) {
      placed = colEnds.length;
      colEnds.push(sorted[i].endMin);
    } else {
      colEnds[placed] = sorted[i].endMin;
    }
    col[i] = placed;
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sorted[i].endMin > sorted[j].startMin && sorted[j].endMin > sorted[i].startMin) {
        union(i, j);
      }
    }
  }

  const clusterCols = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    clusterCols.set(root, Math.max(clusterCols.get(root) || 0, col[i] + 1));
  }

  return sorted.map((block, i) => ({
    ...block,
    col: col[i],
    colCount: clusterCols.get(find(i)) || 1,
  }));
}

/** Do two packages collide anywhere in the week? */
export const packagesClash = (a, b) =>
  a.blocks.some((x) => b.blocks.some((y) => blocksOverlap(x, y)));

// UCSD's own shorthand — "MWF", "TuTh"
const DAY_SHORT = { M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa" };

/**
 * "TuTh 11:00–12:20" for one section — or "M 11:00–11:50 + TuTh 9:30–10:50"
 * when the section really does meet at more than one time in the week.
 */
export const whenLabel = (section) => {
  const slots =
    Array.isArray(section?.meetings) && section.meetings.length
      ? section.meetings
      : [{ days: section?.days, start: section?.start, end: section?.end }];
  return slots
    .filter((s) => s?.start)
    .map(
      (s) =>
        `${(s.days || []).map((d) => DAY_SHORT[d] ?? d).join("")} ` +
        `${s.start}–${s.end || "?"}`
    )
    .join(" + ");
};

/**
 * Compact seat chip for planner / search cards.
 *
 * Looks at enrollable packages (lecture + DI) when times exist; otherwise at
 * primary LE/SE rows (or any row with seat numbers). Returns null when we
 * have no seat signal — callers keep showing only the offered-next chip.
 *
 *   { kind: "full",     label: "Full",    className, title }
 *   { kind: "waitlist", label: "Waitlist", className, title }
 *   { kind: "open",     label: "12 left", className, title, seatsAvailable }
 */
export function courseSeatChip(sections) {
  const list = sections || [];
  if (!list.length) return null;

  const packages = packagesFor(list);
  let primaries = packages.map((pkg) => ({
    seatsAvailable: pkg.seatsAvailable,
    seatsTotal: pkg.seatsTotal,
    status: pkg.status,
  }));

  // packagesFor drops untimed rows (independent study, TBA). Fall back to
  // lecture/seminar seats, then any section that carries a seat count.
  if (!primaries.length) {
    const lectures = list.filter((s) => /^(LE|SE)$/i.test(s.component || ""));
    const pool = lectures.length ? lectures : list;
    primaries = pool.map((s) => ({
      seatsAvailable: s.seatsAvailable,
      seatsTotal: s.seatsTotal,
      status: normalizeSectionStatus(s.status),
    }));
  }

  const withSeats = primaries.filter((p) => Number.isFinite(p.seatsAvailable));
  const bestOpen = withSeats.length
    ? Math.max(...withSeats.map((p) => p.seatsAvailable))
    : null;

  if (bestOpen != null && bestOpen > 0) {
    return {
      kind: "open",
      label: `${bestOpen} left`,
      seatsAvailable: bestOpen,
      className: "bg-emerald-50 text-emerald-700",
      // Package seats are the bundle minimum, so this is a seat you can
      // actually take — lecture *and* discussion — not just a roomy lecture.
      title: `${bestOpen} seat${bestOpen === 1 ? "" : "s"} open in at least one enrollable section package`,
    };
  }

  const statuses = primaries.map((p) => p.status).filter(Boolean);
  const waitlist = statuses.some((s) =>
    s === "waitlist-active" || s === "booked-waitlist"
  );
  const allFull =
    (bestOpen === 0) ||
    (statuses.length > 0 && statuses.every((s) => s === "full"));

  if (waitlist && (bestOpen === 0 || allFull || !statuses.some((s) => s === "open"))) {
    return {
      kind: "waitlist",
      label: "Waitlist",
      className: "bg-amber-50 text-amber-700",
      title: "No open seats — waitlist available",
    };
  }

  if (allFull || bestOpen === 0) {
    return {
      kind: "full",
      label: "Full",
      className: "bg-red-50 text-red-600",
      title: "No open seats in any section",
    };
  }

  return null;
}