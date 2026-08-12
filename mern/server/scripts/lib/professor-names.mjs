// Joins Schedule of Classes instructor names to RateMyProfessors pages.
//
// The two sources spell the same person differently, and the gaps are not
// cosmetic — they decide whether a course shows ratings at all:
//
//   SoC "Porter, Leonard Emerson"  RMP has BOTH "Leonard Porter" (0 ratings,
//                                  a stub page) and "Leo Porter" (45 ratings).
//                                  Exact-first-name matching picks the stub.
//   SoC "Jones, Miles E"           RMP has two "Miles Jones" pages, one under
//                                  Computer Science and one under Mathematics.
//   SoC "Weng, Olivia"             RMP has no Olivia Weng, only Lily Weng — a
//                                  different person. Falling back to surname
//                                  alone would attach a stranger's ratings.
//   SoC "Cho, Hyun Keun"           RMP has no Hyun Keun Cho, only Hyunmi Cho
//                                  (Theater). Reading the compound given name
//                                  as just "Hyun" made it a prefix of "Hyunmi"
//                                  and put a Theater lecturer's 1.7 stars on
//                                  MATH 213 and PHB 248.
//   SoC "Erdmann, Dean"            RMP has Deanna Erdmann. "Dean" is a prefix
//                                  of "Deanna" exactly the way "Leo" is a
//                                  prefix of "Leonard", so the two directions
//                                  cannot both be trusted.
//
// So: match on surname AND a compatible given name, never surname alone, and
// prefer a page that actually has ratings over an exact-spelled stub — an
// unrated page carries none of the information this join exists to attach.
//
// The compatible-given-name rules, in the order they are tried:
//   exact        the whole given name, bare initials dropped ("Miles E" is
//                Miles; "Chung Kuan" is Chung Kuan, NOT Chung)
//   middle-name  one source spells middle names the other omits, at TOKEN
//                boundaries only ("Michael" ~ "Michael William")
//   nickname     an explicit pair from the table below
//   short-form   a character prefix, and ONLY with the RMP page carrying the
//                shorter form ("Leo" for SoC's "Leonard Emerson")
//   truncated    the SoC column clipped the tail off a long name, with every
//                earlier token matching exactly ("Adalbert Geral" is Gerald)
//
// That last rule used to run in both directions, which is what let "Hyun"
// claim "Hyunmi", "Xia" claim "Xiaolong Bruce" and "Dean" claim "Deanna". A
// character prefix in that direction cannot be told apart from a genuine short
// form ("Alex" for "Alexander") by any rule, so the genuine ones are listed in
// NICKNAMES instead and everything else resolves to null. Roughly a third of
// UCSD instructors have no RMP page at all, so null is the ordinary answer —
// and a missing professor is far better than a stranger's ratings.

export const normalizeName = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The given name as tokens, with bare initials dropped: they identify nobody
// ("Jones, M" must not claim every M-name in the department) and both sources
// sprinkle them inconsistently ("Cohen, Seth M" is RMP's "Seth M Cohen" is
// "Seth"). Everything else is KEPT — taking only the first token turned the
// compound given names "Hyun Keun", "Kun Soo" and "Eun Sun" into first
// syllables that the prefix rule then read as short forms of strangers.
export const givenNameOf = (raw) =>
  normalizeName(raw)
    .split(" ")
    .filter((t) => t.length > 1)
    .join(" ");

// "Jones, Miles E" -> { last: "jones", given: "miles" }
// "Gonzalez Gamboa, Ivonne" -> { last: "gonzalez gamboa", given: "ivonne" }
// "Cho, Hyun Keun" -> { last: "cho", given: "hyun keun" }
export function splitSocName(name) {
  const [rawLast, rawRest = ""] = String(name).split(",");
  return { last: normalizeName(rawLast), given: givenNameOf(rawRest) };
}

// Short forms, in both directions. The prefix-shaped ones (Alex/Alexander,
// Jeff/Jeffrey, Ben/Benjamin) have to be listed explicitly now: the prefix
// rule below only runs when the RMP page holds the shorter form, because in
// the other direction it cannot be told apart from "Dean" claiming "Deanna".
// A prefix-shaped short form that isn't listed here simply yields null — the
// price of never handing a student the wrong professor's ratings.
const NICKNAMES = [
  ["robert", "bob"], ["robert", "rob"], ["william", "bill"], ["william", "will"],
  ["richard", "dick"], ["richard", "rick"], ["richard", "rich"], ["john", "jack"],
  ["james", "jim"], ["charles", "chuck"], ["henry", "hank"], ["edward", "ted"],
  ["edward", "ned"], ["theodore", "ted"], ["theodore", "theo"],
  ["margaret", "peggy"], ["elizabeth", "betty"],
  ["elizabeth", "liz"], ["elizabeth", "beth"], ["anthony", "tony"],
  ["joseph", "joe"], ["michael", "mike"], ["thomas", "tom"], ["stephen", "steve"],
  ["steven", "steve"], ["lawrence", "larry"], ["patricia", "patty"],
  ["patricia", "trish"], ["katherine", "kate"], ["catherine", "cathy"],
  ["susan", "sue"], ["kenneth", "ken"], ["ronald", "ron"], ["donald", "don"],
  ["gerald", "jerry"], ["frederick", "fred"], ["francis", "frank"],
  ["eugene", "gene"], ["arthur", "art"], ["albert", "al"], ["alfred", "al"],
  ["raymond", "ray"], ["walter", "walt"], ["philip", "phil"], ["peter", "pete"],
  // Prefix-shaped, and therefore load-bearing rather than noise.
  ["alexander", "alex"], ["alexandra", "alex"], ["christopher", "chris"],
  ["christopher", "christo"], ["christina", "chris"], ["christine", "chris"],
  ["jeffrey", "jeff"], ["gwendolyn", "gwen"], ["benjamin", "ben"],
  ["daniel", "dan"], ["daniel", "danny"], ["samuel", "sam"], ["samantha", "sam"],
  ["matthew", "matt"], ["nicholas", "nick"], ["timothy", "tim"],
  ["gregory", "greg"], ["andrew", "andy"], ["andrew", "drew"],
  ["jonathan", "jon"], ["david", "dave"], ["katherine", "kathy"],
  ["kathleen", "kathy"], ["rebecca", "becca"], ["joshua", "josh"],
  ["zachary", "zach"], ["nathaniel", "nate"], ["nathan", "nate"],
  ["vincent", "vince"], ["dominic", "dom"], ["gabriel", "gabe"],
  ["martin", "marty"], ["valerie", "val"], ["jessica", "jess"],
  ["jennifer", "jen"], ["jennifer", "jenny"], ["stephanie", "steph"],
  ["maximilian", "max"], ["maxwell", "max"], ["deborah", "deb"],
  ["deborah", "debbie"], ["barbara", "barb"], ["cynthia", "cindy"],
];

const NICKNAME_PAIRS = new Set(NICKNAMES.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/**
 * How the query's given name relates to an RMP page's, or null when they are
 * different people as far as this join can tell.
 *
 * ARGUMENT ORDER IS LOAD-BEARING: `queried` is the name the Schedule of
 * Classes or Class Planner wrote, `page` is the RateMyProfessors spelling. The
 * short-form rule is directional and reading them the wrong way round
 * reintroduces the Hyunmi Cho bug.
 */
function givenNameMatch(queried, page) {
  if (!queried || !page) return null;
  if (queried === page) return "exact";
  // The same name with the internal space moved or dropped: SoC's "Hye Jin",
  // "Sheng-Yang" and "Wan-Lu" are RMP's "Hyejin", "ShengYang" and "Wanlu".
  // Safe because every character still has to line up, so it rescues those
  // without letting "Hyun Keun" near "Hyunmi".
  if (squash(queried) === squash(page)) return "exact";

  // One source spells middle names the other omits. Compared token by token,
  // never character by character: "Michael" is "Michael William", but "Hyun"
  // is not "Hyunmi" and "Xia" is not "Xiaolong Bruce".
  const qt = queried.split(" ");
  const pt = page.split(" ");
  const [fewer, more] = qt.length <= pt.length ? [qt, pt] : [pt, qt];
  if (fewer.every((t, i) => t === more[i])) return "middle-name";

  if (NICKNAME_PAIRS.has(`${qt[0]}|${pt[0]}`)) return "nickname";

  // The Schedule of Classes clips its instructor column, so a long name can
  // arrive with its tail cut off: "Soosai Raj, Adalbert Geral" is Adalbert
  // GeralD, and he teaches six CSE courses under no other spelling. Allowed
  // only when every earlier token already matches exactly and the clipped one
  // still carries 4+ characters, which is what keeps "Eun Sun" away from "Eun
  // Sung" and single-token "Dean" away from "Deanna".
  const cut = qt.length - 1;
  if (
    qt.length >= 2 &&
    pt.length > cut &&
    qt.slice(0, cut).every((t, i) => t === pt[i]) &&
    qt[cut].length >= 4 &&
    pt[cut].startsWith(qt[cut])
  ) {
    return "truncated";
  }

  // The RMP page carries the short form of a longer given name the query
  // spells out: SoC's "Porter, Leonard Emerson" is RMP's "Leo Porter". 3+
  // characters, so a stray initial cannot claim a whole department. The
  // reverse direction is deliberately absent — see the header.
  if (pt.length === 1 && page.length >= 3 && qt[0].startsWith(page)) {
    return "short-form";
  }
  return null;
}

const squash = (s) => s.replace(/ /g, "");

// Index RMP professors by normalized surname, and by that surname with its
// spaces closed up: the Schedule of Classes writes "De Sa, Virginia" where RMP
// writes "Virginia Desa", and one space cost COGS 118B its instructor.
export function indexProfessors(professors) {
  const bySurname = new Map();
  const add = (key, p) => {
    if (!key) return;
    const list = bySurname.get(key) ?? [];
    if (!list.includes(p)) list.push(p);
    bySurname.set(key, list);
  };
  for (const p of professors) {
    const key = normalizeName(p.last_name);
    add(key, p);
    add(squash(key), p);
  }
  return bySurname;
}

// Pages filed under a surname, as written or with its spaces closed up.
const candidatesFor = (bySurname, surname) =>
  bySurname.get(surname) ?? bySurname.get(squash(surname)) ?? null;

// RMP departments are self-reported and coarse — one CSE lecturer picks
// "Computer Science", the next "Engineering" — so they can only ever break a
// tie, never reject a match. What they are good for is the case the rules
// above cannot see: two same-surname colleagues who both match the given name,
// where the course's own subject says which one is standing in the room.
// Listed per subject code, most specific first; a subject with no entry simply
// gets no tiebreak.
const SUBJECT_DEPARTMENTS = {
  CSE: ["Computer Science", "Electrical Engineering & Computer Science", "Engineering"],
  DSC: ["Data Science", "Computer Science", "Mathematics"],
  COGS: ["Cognitive Science", "Cognitive Science & Computer Engineering", "Psychology"],
  MATH: ["Mathematics"],
  PHYS: ["Physics"],
  CHEM: ["Chemistry", "Chemical Engineering"],
  BILD: ["Biology", "Biological Sciences"],
  BIMM: ["Biology", "Biological Sciences"],
  BIBC: ["Biology", "Biological Sciences"],
  BICD: ["Biology", "Biological Sciences"],
  BIPN: ["Biology", "Biological Sciences"],
  BENG: ["Bioengineering", "Engineering"],
  ECE: ["Electrical Engineering & Computer Science", "Engineering"],
  MAE: ["Mechanical Engineering", "Engineering"],
  NANO: ["Engineering"],
  SE: ["Engineering"],
  ECON: ["Economics", "Business", "Finance"],
  MGT: ["Management", "Business", "Marketing", "Accounting", "Finance"],
  POLI: ["Political Science"],
  PSYC: ["Psychology"],
  SOCI: ["Sociology"],
  ANTH: ["Anthropology"],
  HIST: ["History"],
  HILD: ["History"],
  HIUS: ["History"],
  HIEU: ["History"],
  PHIL: ["Philosophy"],
  LIGN: ["Linguistics"],
  LTWL: ["Literature", "English"],
  LTEN: ["Literature", "English"],
  MUS: ["Music"],
  TDGE: ["Theater", "Theatre & Dance", "Dance"],
  TDAC: ["Theater", "Theatre & Dance", "Dance"],
  VIS: ["Visual Arts", "Art", "Fine Arts", "Art History", "Film", "Design"],
  ETHN: ["Ethnic Studies"],
  USP: ["Urban Studies", "Urban Planning"],
  SIO: ["Oceanography", "Geology", "Geophysics", "Environment"],
  SIOG: ["Oceanography", "Geology", "Geophysics", "Environment"],
  PHB: ["Public Health", "Health Science", "Medicine"],
  FMPH: ["Public Health", "Health Science", "Medicine"],
  EDS: ["Education"],
  COMM: ["Communication"],
  WCWP: ["Writing"],
};

// "CSE 100" / "SIO 104/SIOG 255" -> ["Computer Science", ...]. Takes the first
// subject of a cross-listing, which is the one the catalog files it under.
export const departmentsForCourse = (courseId) =>
  SUBJECT_DEPARTMENTS[String(courseId || "").match(/^[A-Z]+/)?.[0]] ?? [];

// Best page among one surname's candidates, or null if none is compatible.
// `departments` is an optional, purely advisory hint (see SUBJECT_DEPARTMENTS).
function pickBest(candidates, given, departments = []) {
  const scored = [];
  for (const p of candidates ?? []) {
    const kind = givenNameMatch(given, givenNameOf(p.first_name));
    if (kind) scored.push({ p, kind });
  }
  if (!scored.length) return null;

  // An unrated page tells the student nothing, so it only wins when it is the
  // only thing on offer. This is what separates "Leo Porter" (45 ratings, a
  // short-form match) from the exact-spelled "Leonard Porter" stub.
  const rated = scored.filter((s) => s.p.num_ratings > 0);
  const pool = rated.length ? rated : scored;

  const rank = { exact: 3, "middle-name": 2, nickname: 1, "short-form": 1, truncated: 1 };
  const onSubject = (s) => (departments.includes(s.p.department) ? 1 : 0);
  pool.sort(
    (a, b) =>
      rank[b.kind] - rank[a.kind] ||
      onSubject(b) - onSubject(a) ||
      b.p.num_ratings - a.p.num_ratings,
  );
  return pool[0].p;
}

// Returns the best RMP page for a SoC instructor name, or null when the person
// has no page. Null is the correct, common answer — roughly a third of UCSD
// instructors have never been rated — and is far better than a wrong match.
export function matchProfessor(socName, bySurname, departments = []) {
  const { last, given } = splitSocName(socName);
  if (!last || !given) return null;
  return pickBest(candidatesFor(bySurname, last), given, departments);
}

// Class Planner writes preferred display names ("Leo Porter"), where the
// surname boundary is not marked. Multi-word surnames make the split genuinely
// ambiguous — "Adalbert Gerald Soosai Raj" is Adalbert Gerald / Soosai Raj, not
// Adalbert / Gerald Soosai Raj — so instead of guessing, try every split and
// let the RMP surname index decide. Longest surname first, because the longer
// match is the more specific one.
export function matchDisplayName(displayName, bySurname, departments = []) {
  const tokens = normalizeName(displayName).split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  for (let start = 1; start < tokens.length; start++) {
    // Everything left of the surname is the given name — all of it. Passing
    // only tokens[0] made "Adalbert Gerald" look like a prefix of itself, and
    // the same shape is what let "Xia" claim "Xiaolong Bruce".
    const given = givenNameOf(tokens.slice(0, start).join(" "));
    const surname = tokens.slice(start).join(" ");
    const hit = pickBest(candidatesFor(bySurname, surname), given, departments);
    if (hit) return hit;
  }
  return null;
}

// Dispatches on the one reliable difference between the two sources: the
// Schedule of Classes writes "Last, First", Class Planner writes "First Last".
// `departments` is the advisory subject hint from departmentsForCourse.
export function matchInstructor(name, bySurname, departments = []) {
  return String(name).includes(",")
    ? matchProfessor(name, bySurname, departments)
    : matchDisplayName(name, bySurname, departments);
}

// v5.json's professors entries are all strings, and ProfessorInfo.jsx renders
// them verbatim ("⭐ {quality_rating}", "Ratings: {num_ratings}"), so the shape
// below is byte-compatible with the data it replaces. Missing values become
// "N/A" rather than "null" reaching the UI.
// An instructor with no RateMyProfessors page. They still teach the course, so
// they are listed by name with the rating fields explicitly "N/A" and no
// profile link — the UI hides the RMP link when it is null.
export function toV5Unrated(name) {
  const tidy = String(name).replace(/\s+/g, " ").trim();
  // Class Planner is inconsistent about case ("dean erdmann"), and this name
  // is rendered as-is next to properly capitalised ones. Only an all-lowercase
  // name is touched, so "McKee" and "Jor-El" survive intact.
  const cased = /[A-Z]/.test(tidy)
    ? tidy
    : tidy.replace(/(^|[\s-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  return {
    name: cased,
    quality_rating: "N/A",
    num_ratings: "No ratings",
    would_take_again: "N/A",
    difficulty: "N/A",
    profile_link: null,
    department: "",
  };
}

export function toV5Professor(p) {
  const round = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : null);
  return {
    name: `${p.first_name} ${p.last_name}`.replace(/\s+/g, " ").trim(),
    quality_rating: round(p.quality_rating) ?? "N/A",
    num_ratings: `${p.num_ratings} rating${p.num_ratings === 1 ? "" : "s"}`,
    would_take_again: p.would_take_again == null ? "N/A" : `${Math.round(p.would_take_again)}%`,
    difficulty: round(p.difficulty) ?? "N/A",
    profile_link: `https://www.ratemyprofessors.com/professor/${p.legacy_id}`,
    department: p.department || "",
  };
}
