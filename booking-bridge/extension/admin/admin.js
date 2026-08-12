/**
 * Admin view over the extension's stored section data.
 *
 * Exists for the two weeks a year that matter: during enrollment, seat counts
 * move by the minute and you want to re-read them on demand and know exactly
 * how old the numbers on screen are. Times and instructors barely change once a
 * schedule publishes, so this deliberately refreshes what is already tracked
 * rather than offering a search.
 *
 * All TSS access goes through the service worker so there is one implementation
 * of the fetch, not two.
 */

const $ = (id) => document.getElementById(id);

const send = (type, payload) =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

/** Coarse on purpose — the data is only as fresh as the last read. */
function relativeTime(timestamp) {
  if (!timestamp) return "never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function setResult(message, tone) {
  const node = $("result");
  node.textContent = message;
  node.className = `result ${tone}`;
  node.classList.remove("hidden");
}

function renderCourses(courses) {
  const body = $("courses").querySelector("tbody");
  body.innerHTML = "";
  $("course-count").textContent = courses.length ? `· ${courses.length}` : "";
  $("courses").classList.toggle("hidden", courses.length === 0);
  $("empty").classList.toggle("hidden", courses.length > 0);

  for (const course of courses) {
    const row = document.createElement("tr");

    const cell = (text, className) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      row.appendChild(td);
      return td;
    };

    cell(course.courseId);
    cell([course.term, course.year].filter(Boolean).join(" ") || "—");
    cell(String(course.sectionCount), "num");

    // -1 is the sentinel for "no section reported a number", which is not the
    // same as zero seats and must not be shown as though it were.
    const seats = course.seatsAvailable;
    const seatCell = cell(seats < 0 ? "—" : String(seats), "num");
    if (seats > 0) seatCell.classList.add("seats-open");
    else if (seats === 0) seatCell.classList.add("seats-none");

    cell(relativeTime(course.seenAt), "num");
    body.appendChild(row);
  }
}

function renderLog(entries) {
  const list = $("log");
  list.innerHTML = "";
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "Nothing yet.";
    list.appendChild(item);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    const what = document.createElement("span");
    const { event, at, ...rest } = entry;
    const detail = Object.entries(rest)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
    what.textContent = detail ? `${event} — ${detail}` : event;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = relativeTime(at);
    item.append(what, when);
    list.appendChild(item);
  }
}

function setTermResult(message, tone) {
  const node = $("term-result");
  node.textContent = message;
  node.className = `result ${tone}`;
  node.classList.remove("hidden");
}

function renderTerms(terms) {
  if (!terms?.length) {
    $("term-summary").textContent = "not fetched";
    $("term-detail").textContent =
      "No whole-term schedule stored yet — this is the copy other students would read.";
    return;
  }
  const latest = terms[0];
  const termName = latest.term.charAt(0).toUpperCase() + latest.term.slice(1);
  $("term-summary").textContent = `${latest.sectionCount.toLocaleString()} meetings`;
  $("term-detail").textContent =
    `${termName} ${latest.year} · ${latest.courseCount.toLocaleString()} courses · ` +
    `fetched ${relativeTime(latest.fetchedAt)}` +
    (latest.truncated ? " · INCOMPLETE, hit a page cap" : "");
}

/**
 * Poll progress while a term fetch runs.
 *
 * The fetch is one long message round trip, so it cannot report anything until
 * it finishes. The worker writes progress to storage instead and this reads it —
 * otherwise the button sits dead for two minutes, which is indistinguishable
 * from a hang.
 */
function watchTermProgress(stop) {
  const tick = async () => {
    if (stop.done) return;
    const { progress } = (await send("TPBB_GET_TERM_PROGRESS")) || {};
    if (progress?.running && progress.message) {
      const seconds = Math.round((Date.now() - progress.startedAt) / 1000);
      setTermResult(`${progress.message} (${seconds}s)`, "");
    }
    if (!stop.done) setTimeout(tick, 700);
  };
  tick();
}

$("fetch-term").addEventListener("click", async () => {
  const year = $("term-year").value.trim();
  const term = $("term-term").value;
  if (!/^\d{4}$/.test(year)) {
    setTermResult("Enter the academic year's start, e.g. 2026 for Fall 2026.", "bad");
    return;
  }

  const button = $("fetch-term");
  button.disabled = true;
  button.textContent = "Fetching…";
  const stop = { done: false };
  watchTermProgress(stop);

  const result = await send("TPBB_FETCH_TERM_SECTIONS", { year, term });

  stop.done = true;
  button.disabled = false;
  button.textContent = "Fetch entire term";

  if (!result?.ok) {
    setTermResult(
      result?.needsSignIn
        ? "Your TSS sign-in has expired. Sign in at sis.ucsd.edu and try again."
        : `Failed: ${result?.reason || "no response"}`,
      "bad"
    );
  } else if (!result.count) {
    setTermResult(result.diagnosis || "TSS returned nothing for that term.", "warn");
  } else {
    const seconds = Math.round((result.elapsedMs || 0) / 1000);
    setTermResult(
      `${result.count.toLocaleString()} meetings across ` +
        `${result.coursesWithMeetings.toLocaleString()} courses in ${seconds}s.` +
        (result.truncated ? " Incomplete — hit a page cap." : ""),
      result.truncated ? "warn" : "ok"
    );
  }
  load();
});

async function load() {
  const status = await send("TPBB_GET_STATUS");
  if (!status?.ok) {
    setResult("Could not read from the extension. Try reloading it.", "bad");
    return;
  }
  $("version").textContent = `v${status.version}`;
  $("freshness").textContent = relativeTime(status.updatedAt);
  $("freshness-exact").textContent = status.updatedAt
    ? new Date(status.updatedAt).toLocaleString()
    : "No section data has been fetched yet.";
  renderCourses(status.courses);
  renderTerms(status.terms);
  renderLog(status.log);

  // Default to the term you would actually be enrolling in, matching
  // QuarterlyView's currentQuarter(). An academic year is named for the calendar
  // year its Fall falls in, so Jan–Jun (winter/spring) belongs to the *previous*
  // one, while summer points at the Fall about to start.
  if (!$("term-year").value) {
    const now = new Date();
    const month = now.getMonth();
    $("term-year").value = String(now.getFullYear() - (month <= 5 ? 1 : 0));
    $("term-term").value = month <= 2 ? "winter" : month <= 5 ? "spring" : "fall";
  }
}

$("refresh").addEventListener("click", async () => {
  const button = $("refresh");
  button.disabled = true;
  button.textContent = "Refreshing…";
  setResult("Reading TSS…", "");

  const result = await send("TPBB_REFRESH_STORED");

  button.disabled = false;
  button.textContent = "Refresh seat counts";

  if (!result) {
    setResult("No response from the extension.", "bad");
  } else if (result.needsSignIn) {
    setResult(
      "Your TSS sign-in has expired, so nothing was updated. Sign in at sis.ucsd.edu and try again.",
      "bad"
    );
  } else if (result.failures?.length) {
    setResult(`Some terms failed: ${result.failures.join(" · ")}`, "warn");
  } else if (!result.refreshed) {
    setResult(result.note || "Nothing to refresh yet.", "warn");
  } else {
    setResult(
      `Updated ${result.refreshed} section${result.refreshed === 1 ? "" : "s"} ` +
        `across ${result.terms} term${result.terms === 1 ? "" : "s"}.`,
      "ok"
    );
  }
  load();
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Clear all stored plans and section data? It can all be fetched again.")) return;
  await send("TPBB_CLEAR");
  setResult("Cleared.", "ok");
  load();
});

load();
