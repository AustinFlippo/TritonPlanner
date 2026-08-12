/**
 * TritonMark — the TritonPlanner logo.
 *
 * A trident drawn on a strict 32-unit grid. Every tine is 3.4 units wide and
 * tapers to a point over exactly 6 units; the outer pair is inset 6 units from
 * the centre shaft and stops 9 units short of it, so the three tines read as
 * the three terms in a UCSD academic year and the crossbar as the year binding
 * them. Tapered tines (rather than barbed heads) are what make the silhouette
 * read as a trident instead of three arrows.
 *
 * Single-colour and inherits `currentColor`, so it works on navy, on white,
 * and down to 14px without hinting.
 */

// One path, four subpaths, all wound clockwise so nonzero fill unions them
// where the tines cross the crossbar.
const TRIDENT_PATH = [
  "M16 2 17.7 8V30H14.3V8Z", // centre tine + shaft
  "M6.8 5 8.5 11V17H5.1V11Z", // left tine
  "M25.2 5 26.9 11V17H23.5V11Z", // right tine
  "M5.1 13.6H26.9V17H5.1Z", // crossbar
].join("");

const TritonMark = ({ size = 24, className = "", title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="currentColor"
    className={className}
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title ? <title>{title}</title> : null}
    <path d={TRIDENT_PATH} />
  </svg>
);

export default TritonMark;
