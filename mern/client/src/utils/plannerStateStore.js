// Device-local planner storage, and the rules for reconciling it with the
// plan stored on a signed-in account.
//
// localStorage is a property of the *browser*, not of the student. On a lab
// machine or a shared laptop the blob under PLANNER_STATE_KEY can easily
// belong to whoever sat down last, and it contains a parsed degree audit — a
// full academic record. So every write stamps the `ownerId` that produced it
// (null while signed out) and every read is checked against the account doing
// the reading. A blob stamped with a different account is never applied and
// never uploaded: doing either would both show one student another's record
// and overwrite the reader's own saved plan with it.
//
// The second rule here is about destruction rather than privacy. The local
// write is synchronous on every edit while the account load is a network
// round-trip, so a single drag performed during hydration always produces a
// "newer" local timestamp. Letting that win outright replaced multi-year
// account plans with one-course grids. Timestamps only decide when the two
// sides are meaningfully far apart; near-simultaneous writes are compared by
// content, and an anonymous local plan never replaces a real account plan.

export const PLANNER_STATE_KEY = "tp_planner_state";
export const SAVED_PLANS_KEY = "tp_saved_plans";
export const SIGN_IN_MIGRATION_KEY = "tp_planner_sign_in_migration";

const TERMS = ["fall", "winter", "spring"];

// Two writes this close together are one edit seen through two clocks (the
// browser's and Postgres'), not a later decision — compare content instead.
const CLOCK_SKEW_MS = 5000;

export const scheduleHasCourses = (grid) =>
  Array.isArray(grid) &&
  grid.some(
    (year) =>
      year && TERMS.some((term) => (year[term] || []).some(Boolean))
  );

/** How much plan a grid actually holds — the tiebreak when clocks are level. */
export const countPlacedCourses = (grid) => {
  if (!Array.isArray(grid)) return 0;
  let count = 0;
  for (const year of grid) {
    if (!year) continue;
    for (const term of TERMS) {
      for (const course of year[term] || []) if (course) count += 1;
    }
  }
  return count;
};

/** A persisted blob worth keeping: real placements or a parsed audit. */
export const planIsNonEmpty = (state) =>
  Boolean(
    state &&
      (scheduleHasCourses(state.schedule) ||
        (state.parsedCourseData?.sections || []).length)
  );

/** Account that wrote this blob; null means "written while signed out". */
export const localPlanOwner = (state) => state?.ownerId ?? null;

/**
 * May `userId` read this device-local blob? Anonymous state is adoptable by
 * whoever signs in next (it is their own unsaved work); state stamped with a
 * different account is not theirs to see or to overwrite.
 */
export const localPlanBelongsTo = (state, userId) => {
  const owner = localPlanOwner(state);
  return owner === null || owner === (userId ?? null);
};

/**
 * Decide what a signing-in user's session should show, and whether the local
 * blob may be pushed to their account.
 *
 * Returns { apply: "local" | "server" | "none", upload: boolean, reason }.
 * `upload` is never true for a blob this user doesn't own, and never true
 * when the account's own plan is the one being applied.
 */
export const resolvePlanConflict = ({
  local = null,
  server = null,
  serverUpdatedAt = null,
  userId = null,
} = {}) => {
  const hasServer = planIsNonEmpty(server);
  const serverChoice = hasServer
    ? { apply: "server", upload: false }
    : { apply: "none", upload: false };

  if (!planIsNonEmpty(local)) {
    return { ...serverChoice, reason: "no-local-plan" };
  }

  // Privacy rule: someone else's blob is inert. Not applied, not uploaded.
  if (!localPlanBelongsTo(local, userId)) {
    return { ...serverChoice, reason: "local-owned-by-another-account" };
  }

  if (!hasServer) {
    return { apply: "local", upload: true, reason: "account-has-no-plan" };
  }

  // Anonymous work never overwrites a real account plan — a doodle made
  // before signing in must not destroy four years of planning.
  if (localPlanOwner(local) === null) {
    return { apply: "server", upload: false, reason: "anonymous-local-yields" };
  }

  const localMs = Number(local?.savedAt) || 0;
  const serverMs = serverUpdatedAt ? Date.parse(serverUpdatedAt) : 0;

  if (!localMs) {
    return { apply: "server", upload: false, reason: "local-not-timestamped" };
  }

  if (!serverMs || Math.abs(localMs - serverMs) <= CLOCK_SKEW_MS) {
    // Same moment as far as anyone can tell — keep whichever holds more plan.
    return countPlacedCourses(local.schedule) >
      countPlacedCourses(server.schedule)
      ? { apply: "local", upload: true, reason: "local-is-richer" }
      : { apply: "server", upload: false, reason: "server-is-richer-or-equal" };
  }

  return localMs > serverMs
    ? { apply: "local", upload: true, reason: "local-is-newer" }
    : { apply: "server", upload: false, reason: "server-is-newer" };
};

export const readLocalPlannerState = () => {
  try {
    const raw = localStorage.getItem(PLANNER_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Failed to read local planner state:", err);
    return null;
  }
};

export const writeLocalPlannerState = (state) => {
  try {
    localStorage.setItem(PLANNER_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save plan locally:", err);
  }
};

/**
 * Drop every trace of the device-local plan. Called on sign-out: what stays
 * behind on this machine is anonymous state the next person would otherwise
 * inherit, and the account's copy is safe in Supabase.
 */
export const clearDeviceLocalPlanState = () => {
  try {
    localStorage.removeItem(PLANNER_STATE_KEY);
    localStorage.removeItem(SAVED_PLANS_KEY);
    localStorage.removeItem(SIGN_IN_MIGRATION_KEY);
  } catch (err) {
    console.error("Failed to clear local plan state:", err);
  }
};
