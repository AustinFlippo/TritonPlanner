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

_by_norm = None
_prereq_graph = None


def _normalize(code: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", code or "").lower()


# Segments of a slashed cross-listing: "COM GEN 194" (subject(s) + number),
# "ANSC" (bare subject — borrows the NEXT segment's number, as in
# "AAS/ANSC 185"), "267" (bare number — borrows the PREVIOUS segment's
# subject, as in "HIUS 167/267/ETHN 180").
_SEG_FULL_RE = re.compile(r"^([A-Z]+(?: [A-Z]+)*) (\d\S*)$")
_SEG_SUBJ_RE = re.compile(r"^[A-Z]+(?: [A-Z]+)*$")
_SEG_NUM_RE = re.compile(r"^\d\S*$")


def aliases_for(course_id: str) -> list:
    """All ids a cross-listed course answers to. Port of
    mern/server/scripts/lib/course-ids.mjs — keep the two in sync."""
    aliases = [course_id]
    segments = [s.strip() for s in course_id.split("/")]
    if len(segments) < 2:
        return aliases
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
            return aliases  # unparseable segment: no expansion
    for i in range(1, len(subjects)):  # bare numbers inherit subject from the left
        if subjects[i] is None:
            subjects[i] = subjects[i - 1]
    for i in range(len(numbers) - 2, -1, -1):  # bare subjects inherit number from the right
        if numbers[i] is None:
            numbers[i] = numbers[i + 1]
    for subj, num in zip(subjects, numbers):
        if subj and num:
            aliases.append(f"{subj} {num}")
    return aliases


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


def get_course(code: str) -> Optional[dict]:
    return load_catalog().get(_normalize(code))


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
    """Structured prereqs for a canonical course_id (as returned by get_course)."""
    return load_prereq_graph().get(course_id)


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
                   limit: int = 10):
    """Ranked catalog search, mirroring the Express endpoint's tiers:
    exact id > id prefix > name starts-with > name contains > description
    contains, plus a lowest tier where every query token appears somewhere.
    Empty query with filters = browse mode. Returns (courses, total_matches)."""
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


# Matches "CSE 100", "MATH 20C", "CSE100" in uppercase text
_COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,5})\s?(\d{1,3}[A-Z]{0,2})\b")


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
