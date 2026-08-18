"""Local course catalog access for the chat planner.

Loads the full 7k-course catalog from mern/server/controllers/v5.json
(the same file the Express search endpoint uses) so the FastAPI side
can validate and enrich LLM-proposed schedules without Pinecone.

Also loads the structured prerequisite graph (prereq_graph.json, built by
mern/server/scripts/build-prereq-graph.mjs) for deterministic prereq checks.
"""
import json
import re
from pathlib import Path
from typing import Optional

_CONTROLLERS = Path(__file__).parent.parent / "mern" / "server" / "controllers"
CATALOG_PATH = _CONTROLLERS / "v5.json"
PREREQ_GRAPH_PATH = _CONTROLLERS / "prereq_graph.json"
# Same Class Planner snapshot Express serves at GET /next-quarter. Absent or
# empty far ahead of registration — callers must treat None as "unknown".
UPCOMING_TERM_PATH = (
    Path(__file__).parent.parent / "mern" / "server" / "scripts" / "data"
    / "upcoming-term.json"
)

_by_norm = None
_prereq_graph = None
# {mtime, data} where data is a dict or None (file missing / unusable).
_upcoming_cache = None


def _normalize(code: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", code or "").lower()


# Segments of a slashed cross-listing: "COM GEN 194" (subject(s) + number),
# "ANSC" (bare subject — borrows the NEXT segment's number, as in
# "AAS/ANSC 185"), "267" (bare number — borrows the PREVIOUS segment's
# subject, as in "HIUS 167/267/ETHN 180").
_SEG_FULL_RE = re.compile(r"^([A-Z]+(?: [A-Z]+)*) (\d\S*)$")
_SEG_SUBJ_RE = re.compile(r"^[A-Z]+(?: [A-Z]+)*$")
_SEG_NUM_RE = re.compile(r"^\d\S*$")

# A section-variant suffix: "R" (remote) or "GS" (global seminar) sections of
# an otherwise ordinary course. The General Catalog usually lists only the
# base course, but a degree audit prints whichever variant the student took or
# may take ("MUS 20R", "MUS 8GS"), so a variant must also answer to its base
# number. Deliberately limited to these two suffixes: a trailing letter is
# normally part of the number itself ("DSC 140A", "MATH 20B") and stripping it
# would name a different course. Mirrored in courseIds.js and course-ids.mjs.
_SECTION_VARIANT_RE = re.compile(
    r"^([A-Z]+(?: [A-Z]+)* \d+[A-Z]?)(?:R|GS)$", re.I)

# A multi-quarter sequence, which the catalog publishes as ONE dash-joined
# entry ("HILD 2A-B-C", "JAPN 150A-B-C", "MUS 201A-B-C-D-E-F") while degree
# audits, the Schedule of Classes and students all name the individual
# quarters ("HILD 2A"). 59 catalog entries use this notation and between them
# they hide 155 real courses. Mirrored in courseIds.js and course-ids.mjs.
_SEQUENCE_RE = re.compile(
    r"^([A-Z]+(?: [A-Z]+)*) (\d+)([A-Z])((?:-[A-Z])+)$", re.I)


def _sequence_members(course_id: str) -> list:
    """["HILD 2A", "HILD 2B", "HILD 2C"] for "HILD 2A-B-C"; [] if not one."""
    m = _SEQUENCE_RE.match(course_id or "")
    if not m:
        return []
    subject, number, first, rest = m.groups()
    letters = [first] + [x for x in rest.split("-") if x]
    return [f"{subject} {number}{letter}" for letter in letters]


def _with_variants(aliases: list) -> list:
    """Each alias plus the other ids it answers to — the quarters of a
    sequence entry, and the base of a section variant — order-preserving so
    the code as written always resolves first."""
    out = []
    for alias in aliases:
        for code in [alias, *_sequence_members(alias)]:
            m = _SECTION_VARIANT_RE.match(code or "")
            for candidate in ([code, m.group(1)] if m else [code]):
                if candidate and candidate not in out:
                    out.append(candidate)
    return out


def aliases_for(course_id: str) -> list:
    """All ids a cross-listed course answers to. Port of
    mern/server/scripts/lib/course-ids.mjs; conformance is enforced by
    shared/course-alias-cases.json (test_course_alias_contract.py here,
    course-ids.test.mjs / courseIds.test.mjs on the JS sides) — change one
    port, change all three, and add a case."""
    aliases = [course_id]
    segments = [s.strip() for s in course_id.split("/")]
    if len(segments) < 2:
        return _with_variants(aliases)
    subjects, numbers = [], []
    for seg in segments:
        m = _SEG_FULL_RE.match(seg)
        if m:
            subjects.append(m.group(1))
            numbers.append(m.group(2))
        elif _SEG_SUBJ_RE.match(seg):
            subjects.append(seg)
            numbers.append(None)
        elif _SEG_NUM_RE.match(seg):
            subjects.append(None)
            numbers.append(seg)
        else:
            return _with_variants(aliases)  # unparseable: no expansion
    for i in range(1, len(subjects)):  # bare numbers inherit subject from the left
        if subjects[i] is None:
            subjects[i] = subjects[i - 1]
    for i in range(len(numbers) - 2, -1, -1):  # bare subjects inherit number from the right
        if numbers[i] is None:
            numbers[i] = numbers[i + 1]
    for subj, num in zip(subjects, numbers):
        if subj and num:
            aliases.append(f"{subj} {num}")
    return _with_variants(aliases)


def load_catalog() -> dict:
    global _by_norm
    if _by_norm is None:
        courses = json.loads(CATALOG_PATH.read_text())
        _by_norm = {}
        # First pass: canonical ids win; second pass: cross-listing aliases
        # ("DSC 80" -> the "DSC 80/80R" entry) fill remaining slots.
        for c in courses:
            key = c.get("normalized_course_id") or _normalize(c.get("course_id", ""))
            if key and key not in _by_norm:
                _by_norm[key] = c
        for c in courses:
            for alias in aliases_for(c.get("course_id", "")):
                key = _normalize(alias)
                if key and key not in _by_norm:
                    _by_norm[key] = c
    return _by_norm


_PLAIN_NUMBER_RE = re.compile(r"^\d+(\.\d+)?$")


def _member_credits(raw, index: int, total: int):
    """One quarter's credits from a sequence entry's dash-joined value.

    The catalog writes them per quarter and in order ("4-4-4", "2-2-2"), so a
    member takes its own slot; a single value ("4") applies to every quarter.
    Anything else — the variable-unit "0-4/0-4/0-4" graduate seminars — is
    handed back untouched for parse_credits to read, never guessed at."""
    parts = [p.strip() for p in str(raw or "").split("-")]
    if len(parts) == total and all(_PLAIN_NUMBER_RE.match(p) for p in parts):
        return parts[index]
    return raw


def _as_sequence_member(entry: dict, requested: str) -> Optional[dict]:
    """A single-quarter view of a dash-joined sequence entry, or None when the
    request is not for one quarter of one.

    Keeps the sequence's name, description and prerequisites but narrows the
    id and the credits to the quarter asked for, so a planned "HILD 2A" is
    itself and worth 4 units — not "HILD 2A-B-C" worth the string "4-4-4"."""
    members = _sequence_members(entry.get("course_id", ""))
    if not members:
        return None
    want = _normalize(requested)
    for i, member in enumerate(members):
        if _normalize(member) == want:
            narrowed = dict(entry)
            narrowed["course_id"] = member
            narrowed["normalized_course_id"] = _normalize(member)
            narrowed["credits"] = _member_credits(entry.get("credits"), i,
                                                  len(members))
            return narrowed
    return None


def get_course(code: str) -> Optional[dict]:
    """Catalog entry for a course code, or None.

    Tries the code as written first, then the other ids it answers to: one
    quarter of a dash-joined sequence ("HILD 2A" of "HILD 2A-B-C"), or the
    base of a section variant (an audit's "MUS 20R" finding "MUS 20").
    Whitespace is tidied first because audits pad codes into columns."""
    catalog = load_catalog()
    tidy = " ".join(str(code or "").split())
    for candidate in _with_variants([tidy]):
        hit = catalog.get(_normalize(candidate))
        if hit:
            return _as_sequence_member(hit, tidy) or hit
    return None


_SEAT_STATUS_RANK = {
    "open": 0,
    "waitlist-active": 1,
    "booked-waitlist": 2,
    "waitlist-inactive": 3,
    "full": 4,
}


def _norm_section_status(status) -> str:
    return str(status or "").strip().lower().replace(" ", "-")


def seat_status_from_sections(sections) -> Optional[str]:
    """Whether a course has enrollable open seats, from section rows.

    Groups by packageId so a roomy lecture with every discussion full is
    FULL, not open — matching courseSeatChip in sectionPackages.js.
    Returns 'open', 'waitlist', 'full', or None when no seat numbers exist.
    """
    if not sections:
        return None
    by_pkg = {}
    ungrouped = []
    for s in sections:
        if not isinstance(s, dict):
            continue
        ids = list(s.get("packageIds") or [])
        pid = s.get("packageId")
        if pid and pid not in ids:
            ids.append(pid)
        if ids:
            for pkg_id in ids:
                by_pkg.setdefault(pkg_id, []).append(s)
        else:
            ungrouped.append(s)
    packages = list(by_pkg.values()) + [[row] for row in ungrouped]
    if not packages:
        return None

    best_open = None
    statuses = []
    for members in packages:
        seats = [
            m.get("seatsAvailable") for m in members
            if isinstance(m.get("seatsAvailable"), (int, float))
        ]
        if seats:
            pkg_open = min(seats)
            best_open = pkg_open if best_open is None else max(best_open, pkg_open)
        ranked = [
            _norm_section_status(m.get("status"))
            for m in members if m.get("status")
        ]
        if ranked:
            statuses.append(max(ranked, key=lambda st: _SEAT_STATUS_RANK.get(st, 3)))

    if best_open is not None and best_open > 0:
        return "open"
    waitlist = any(st in ("waitlist-active", "booked-waitlist") for st in statuses)
    if waitlist:
        return "waitlist"
    if best_open == 0 or (statuses and all(st == "full" for st in statuses)):
        return "full"
    return None


def load_upcoming_term() -> Optional[dict]:
    """Live Class Planner snapshot for the upcoming enrollment quarter.

    Returns None when the scrape file is missing, empty, or unreadable —
    common well before registration opens. On success:
      {term_code, term, year, scraped_at, course_count, course_norms: set[str],
       seat_by_norm: {normalized_id: 'open'|'waitlist'|'full'}}
    course_norms is every normalized alias of every course key in the feed so
    "DSC 80" matches catalog "DSC 80/80R". seat_by_norm is the same alias
    expansion of each course's package-aware seat status (snapshot seats are
    indicative — callers may overlay a fresher payload). Re-reads when the
    file mtime changes so a mid-process scrape is picked up without restart.
    """
    global _upcoming_cache
    path = UPCOMING_TERM_PATH
    try:
        mtime = path.stat().st_mtime
    except OSError:
        _upcoming_cache = {"mtime": None, "data": None}
        return None
    if _upcoming_cache and _upcoming_cache.get("mtime") == mtime:
        return _upcoming_cache.get("data")

    data = None
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raw = None
    courses = (raw or {}).get("courses") if isinstance(raw, dict) else None
    term = (raw or {}).get("term") if isinstance(raw, dict) else None
    term_code = (raw or {}).get("term_code") if isinstance(raw, dict) else None
    # A tiny/broken scrape must not become an allowlist that rejects everything.
    if (isinstance(courses, dict) and len(courses) >= 50
            and term in {"fall", "winter", "spring"}
            and term_code):
        norms = set()
        seat_by_norm = {}
        for cid, sections in courses.items():
            status = seat_status_from_sections(sections)
            for alias in aliases_for(str(cid)):
                key = _normalize(alias)
                norms.add(key)
                if status:
                    seat_by_norm[key] = status
        data = {
            "term_code": str(term_code).upper(),
            "term": term,
            "year": str((raw or {}).get("year") or ""),
            "scraped_at": (raw or {}).get("scraped_at"),
            "course_count": len(courses),
            "course_norms": norms,
            "seat_by_norm": seat_by_norm,
        }
    _upcoming_cache = {"mtime": mtime, "data": data}
    return data


def is_offered_in_upcoming_term(course_id: str) -> Optional[bool]:
    """Whether course_id appears on the live upcoming-term schedule.

    None — no usable snapshot (do not block placements).
    True / False — snapshot is loaded and the course is / isn't on it.
    """
    snap = load_upcoming_term()
    if not snap:
        return None
    for alias in aliases_for(" ".join(str(course_id or "").split())):
        if _normalize(alias) in snap["course_norms"]:
            return True
    return False


def upcoming_seat_status(course_id: str) -> Optional[str]:
    """Snapshot seat status for a course on the live upcoming-term schedule.

    None — no snapshot, course not on it, or no seat numbers.
    'open' / 'waitlist' / 'full' — package-aware status from the scrape.
    Snapshot seats drift; prefer a live overlay when the caller has one.
    """
    snap = load_upcoming_term()
    if not snap:
        return None
    by_norm = snap.get("seat_by_norm") or {}
    if not by_norm:
        return None
    for alias in aliases_for(" ".join(str(course_id or "").split())):
        status = by_norm.get(_normalize(alias))
        if status:
            return status
    return None


def load_prereq_graph() -> dict:
    """course_id -> {requires: [[or-group], ...], notes, confidence, unlocks}.
    Missing/corrupt file degrades to no prereq checking, not a crash."""
    global _prereq_graph
    if _prereq_graph is None:
        try:
            _prereq_graph = json.loads(PREREQ_GRAPH_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            _prereq_graph = {}
    return _prereq_graph


def get_prereq_entry(course_id: str) -> Optional[dict]:
    """Structured prereqs for a course id, or None.

    The graph is keyed by the catalog's own canonical ids, so a bare dict
    lookup is not enough: get_course narrows a dash-joined sequence entry
    ("MATH 220A-B-C") to the single quarter that was asked for ("MATH 220A"),
    and the graph still holds the prereqs under the parent id. 155 real courses
    live inside 61 such entries and every one of them silently lost its
    structured prereq checking — and its `unlocks` edges, and its place in the
    prompt's prereq closure. So fall back through the catalog index, which maps
    a member (and any cross-listing alias) to the entry that owns it.
    """
    graph = load_prereq_graph()
    entry = graph.get(course_id)
    if entry is not None:
        return entry
    hit = load_catalog().get(_normalize(course_id))
    parent = (hit or {}).get("course_id")
    if parent and parent != course_id:
        return graph.get(parent)
    return None


def level_of(course_id: str) -> str:
    """UCSD numbering: 1-99 lower-division, 100-199 upper, 200+ grad.
    Mirrors levelOf in mern/server/controllers/searchController.js."""
    m = re.search(r"(\d+)", course_id or "")
    if not m:
        return "upper"
    n = int(m.group(1))
    return "lower" if n < 100 else ("upper" if n < 200 else "grad")


def subjects_of(course_id: str) -> set:
    """Department codes a course belongs to, across cross-listings
    ("AAS/ANSC 185" -> {AAS, ANSC})."""
    subjects = set()
    for alias in aliases_for(course_id):
        m = re.match(r"^([A-Z]+(?: [A-Z]+)*)\s", alias)
        if m:
            subjects.add(m.group(1))
    return subjects


_search_index = None


def _get_search_index() -> list:
    global _search_index
    if _search_index is None:
        seen_ids = set()
        _search_index = []
        for c in load_catalog().values():
            cid = c.get("course_id", "")
            if not cid or cid in seen_ids:
                continue  # alias keys point at the same rows; index each once
            seen_ids.add(cid)
            _search_index.append({
                "course": c,
                "norm_id": c.get("normalized_course_id") or _normalize(cid),
                "name": (c.get("course_name") or "").lower(),
                "desc": (c.get("description") or "").lower(),
                "subjects": subjects_of(cid),
                "level": level_of(cid),
            })
        _search_index.sort(key=lambda e: e["course"]["course_id"])
    return _search_index


def search_courses(query: str, levels=None, depts=None, quarters=None,
                   limit: int = 10, live_only: bool = False):
    """Ranked catalog search, mirroring the Express endpoint's tiers:
    exact id > id prefix > name starts-with > name contains > description
    contains, plus a lowest tier where every query token appears somewhere.
    Empty query with filters = browse mode. Returns (courses, total_matches).

    live_only: drop courses that the Class Planner snapshot says are NOT
    offered next quarter. When no snapshot is loaded, the filter is a no-op
    (is_offered_in_upcoming_term returns None) so we never empty the catalog
    just because registration hasn't opened."""
    q = (query or "").strip().lower()
    q_norm = _normalize(q)
    tokens = [t for t in re.split(r"\W+", q) if t]
    levels = set(levels or [])
    depts = {d.upper() for d in (depts or [])}
    quarters = set(quarters or [])

    scored = []
    for e in _get_search_index():
        if levels and e["level"] not in levels:
            continue
        if depts and not (e["subjects"] & depts):
            continue
        if quarters and not (set(e["course"].get("offerings") or []) & quarters):
            continue
        if live_only and is_offered_in_upcoming_term(e["course"]["course_id"]) is False:
            continue
        if not q:
            tier = 6  # browse mode: filters only, catalog order
        elif q_norm and e["norm_id"] == q_norm:
            tier = 0
        elif q_norm and e["norm_id"].startswith(q_norm):
            tier = 1
        elif e["name"].startswith(q):
            tier = 2
        elif q in e["name"]:
            tier = 3
        elif q in e["desc"]:
            tier = 4
        elif tokens and all(t in e["name"] or t in e["desc"] for t in tokens):
            tier = 5
        else:
            continue
        scored.append((tier, e["course"]))

    scored.sort(key=lambda te: (te[0], te[1]["course_id"]))
    return [c for _, c in scored[:limit]], len(scored)


# Matches "CSE 100", "MATH 20C", "CSE100" in uppercase text.
#
# The gap is 0-3 spaces, not 0-1: a real degree audit renders the course column
# at a fixed width, so it emits "COGS  9", "DSC  10", "CCE   1". With \s? those
# lines matched nothing, and every consumer that re-derives codes from audit
# text (_graded_from_audit above all) silently saw a transcript with two thirds
# of the courses missing. Horizontal whitespace only — a newline between a
# subject and a number is two different lines, not a course code.
_COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,5})[ \t]{0,3}(\d{1,3}[A-Z]{0,2})\b")


def extract_course_codes(text: str) -> list:
    """Pull candidate course codes out of free text. Callers should filter
    through get_course() since the pattern also matches things like 'WANT 4'."""
    return [code for code, _ in iter_course_codes(text)]


def iter_course_codes(text: str) -> list:
    """(code, end_offset) for each distinct candidate code in text.upper();
    end_offset lets callers inspect what follows (e.g. a letter grade)."""
    if not text:
        return []
    seen, out = set(), []
    for m in _COURSE_CODE_RE.finditer(text.upper()):
        code = f"{m.group(1)} {m.group(2)}"
        if code not in seen:
            seen.add(code)
            out.append((code, m.end()))
    return out
