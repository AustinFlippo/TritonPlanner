import { useEffect, useState } from "react";

// Below this width the app drops to a single pane with a bottom tab bar.
//
// The number is not "phone-sized" — it is the width at which the three-column
// workspace stops fitting. MIN_SIDEBAR (250) + MIN_MAIN (320) + MIN_SIDEBAR
// (250) needs 820px before any column is even usable, and the planner grid
// wants more than the minimum. Anything under Tailwind's `lg` gets the
// single-pane layout instead, which also catches the case a plain phone
// breakpoint misses: an iPhone in landscape is 844px wide and would
// otherwise be handed a workspace it cannot render.
export const COMPACT_MAX_WIDTH = 1023;
const QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;

const currentMatch = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;

/** True while the viewport is too narrow for the three-column workspace. */
export function useCompactLayout() {
  const [compact, setCompact] = useState(currentMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mql = window.matchMedia(QUERY);
    const onChange = (event) => setCompact(event.matches);
    // Re-read on mount: the first paint may have happened before hydration.
    setCompact(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return compact;
}

export default useCompactLayout;
