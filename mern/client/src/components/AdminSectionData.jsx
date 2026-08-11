// Admin page: control how the shared course schedule stays fresh.
//
// Since the Class Planner migration (Aug 2026), the schedule every student
// reads comes from UCSD's public feed via the server — the admin's job is no
// longer to fetch data by hand but to set the cadence the server re-scrapes
// on, trigger a refresh when something looks off, and keep an eye on the
// feed's health. That is the first card.
//
// The second card is the legacy TSS-capture publish (extension reads TSS,
// this page writes Supabase). It is the dormant fallback the client only
// reads if the server feed is unreachable — kept working, clearly labeled.

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import {
  isBridgeInstalled,
  requestTermSections,
} from "../../../../booking-bridge/core/plannerBridge.js";
import { listPublishedTerms, publishTerm, isAdmin } from "../utils/termSections";
import { API_URL } from "../utils/api";
import { supabase } from "../utils/supabase";

// 0 is "manual only" — the server never self-refreshes, only the button does.
const CADENCES = [
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Daily" },
  { hours: 72, label: "Every 3 days" },
  { hours: 168, label: "Weekly" },
  { hours: 0, label: "Manual only" },
];

async function adminFetch(path, options = {}) {
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const TERMS = [
  { value: "fall", label: "Fall" },
  { value: "winter", label: "Winter" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
];

// An academic year is named for the calendar year its Fall falls in, so
// Jan–Jun (winter/spring) belongs to the previous one.
const defaultTerm = () => {
  const now = new Date();
  const month = now.getMonth();
  return {
    year: String(now.getFullYear() - (month <= 5 ? 1 : 0)),
    term: month <= 2 ? "winter" : month <= 5 ? "spring" : "fall",
  };
};

const relativeTime = (timestamp) => {
  if (!timestamp) return "never";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

// The primary card: the Class Planner feed the whole app reads, and the
// admin's two levers over it — cadence and refresh-now.
const ScheduleFeedCard = ({ admin }) => {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/next-quarter/refresh-status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setError(null);
    } catch (err) {
      setError(`Can't reach the schedule server: ${err.message}`);
    }
  }, []);

  // Poll while a refresh is running so the card follows it live; otherwise a
  // slow ambient poll keeps "last updated" honest if someone leaves the tab up.
  useEffect(() => {
    loadStatus();
    const running = Boolean(status?.running);
    const id = setInterval(loadStatus, running ? 5000 : 60000);
    return () => clearInterval(id);
  }, [loadStatus, status?.running]);

  const setCadence = async (hours) => {
    setSaving(true);
    setError(null);
    try {
      setStatus(await adminFetch(`/next-quarter/refresh-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalHours: hours }),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshNow = async () => {
    setError(null);
    try {
      await adminFetch(`/next-quarter/refresh`, { method: "POST" });
      setStatus((prev) => (prev ? { ...prev, running: true } : prev));
    } catch (err) {
      setError(err.message);
    }
  };

  const scrapedAt = status?.scrapedAt ? new Date(status.scrapedAt).getTime() : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Shared schedule · UCSD Class Planner feed
          </p>
          <p className="text-2xl font-semibold text-slate-800 mt-0.5">
            {status ? relativeTime(scrapedAt) : "…"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {status?.termCode
              ? `${status.termCode} · ${(status.sectionCount ?? 0).toLocaleString()} sections across ` +
                `${(status.courseCount ?? 0).toLocaleString()} courses` +
                (status.nextRunAt
                  ? ` · next auto-refresh ${new Date(status.nextRunAt).toLocaleString()}`
                  : " · auto-refresh off")
              : "No snapshot on the server yet — run a refresh."}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Structure only (times, instructors, rooms). Seat counts refresh live
            per course as students view them, on every cadence setting.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={status?.intervalHours ?? 24}
            onChange={(e) => setCadence(Number(e.target.value))}
            disabled={!admin || saving || !status}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
            aria-label="Auto-refresh cadence"
          >
            {CADENCES.map((c) => (
              <option key={c.hours} value={c.hours}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={refreshNow}
            disabled={!admin || Boolean(status?.running)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy-500 text-white text-sm font-medium hover:bg-navy-600 disabled:opacity-50 disabled:hover:bg-navy-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
          >
            <RefreshCw className={`w-4 h-4 ${status?.running ? "animate-spin" : ""}`} />
            {status?.running ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {status?.lastRun && (
        <p
          className={`flex items-start gap-1.5 text-xs mt-3 ${
            status.lastRun.ok ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {status.lastRun.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          )}
          <span>
            Last refresh {relativeTime(new Date(status.lastRun.at).getTime())}
            {status.lastRun.ok
              ? ` — completed in ${Math.round(status.lastRun.durationMs / 1000)}s.`
              : ` — failed: ${status.lastRun.error}`}
          </span>
        </p>
      )}

      {!admin && (
        <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-3">
          <Clock className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          Read-only: this account isn&rsquo;t an admin, so the controls are disabled.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 mt-3">
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

const AdminSectionData = () => {
  const [{ year, term }, setTarget] = useState(defaultTerm);
  const [published, setPublished] = useState([]);
  const [admin, setAdmin] = useState(null); // null = still checking
  const [bridge, setBridge] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const reload = useCallback(async () => {
    setPublished(await listPublishedTerms());
  }, []);

  useEffect(() => {
    reload();
    isAdmin().then(setAdmin);
    isBridgeInstalled().then((ok) => setBridge(ok ? "connected" : "missing"));
  }, [reload]);

  const current = published.find((p) => p.id === `${year}-${term}`);
  const latest = published[0];

  const refresh = async () => {
    setBusy(true);
    setResult(null);
    setProgress("Asking TSS for the term…");

    const fetched = await requestTermSections({
      year,
      term,
      onProgress: (p) => p?.message && setProgress(p.message),
    });

    if (!fetched?.ok) {
      setBusy(false);
      setProgress(null);
      setResult({
        tone: "error",
        message: fetched?.needsSignIn
          ? "Your TSS sign-in has expired. Sign in at sis.ucsd.edu, then try again."
          : `Couldn't read TSS: ${fetched?.reason || "no response from the extension"}`,
      });
      return;
    }
    if (!fetched.count) {
      setBusy(false);
      setProgress(null);
      setResult({
        tone: "warn",
        message: fetched.diagnosis || "TSS returned nothing for that term.",
      });
      return;
    }

    setProgress("Publishing to TritonPlanner…");
    const byCourse = {};
    for (const section of fetched.sections) {
      (byCourse[section.courseId] ||= []).push(section);
    }
    const saved = await publishTerm({
      year,
      term,
      courses: byCourse,
      truncated: Boolean(fetched.truncated),
    });

    setBusy(false);
    setProgress(null);
    setResult(
      saved.ok
        ? {
            tone: fetched.truncated ? "warn" : "ok",
            message:
              `Published ${saved.sectionCount.toLocaleString()} meetings across ` +
              `${saved.courseCount.toLocaleString()} courses. Everyone sees this now.` +
              (fetched.truncated
                ? " Warning: incomplete — TSS returned more rows than this fetch read."
                : ""),
            // A second line of detail, because the headline number looks the
            // same whether the refresh did anything or silently republished
            // identical data.
            detail: saved.firstPublish
              ? `First publish for this term. ${saved.withSeats.toLocaleString()} meetings ` +
                `report seat counts (${saved.open.toLocaleString()} with seats open, ` +
                `${saved.full.toLocaleString()} full); ` +
                `${saved.withoutSeats.toLocaleString()} report none.`
              : [
                  saved.newCourses
                    ? `${saved.newCourses.toLocaleString()} new course${saved.newCourses === 1 ? "" : "s"}`
                    : null,
                  saved.goneCourses
                    ? `${saved.goneCourses.toLocaleString()} no longer listed`
                    : null,
                  `${saved.seatsChanged.toLocaleString()} seat count${saved.seatsChanged === 1 ? "" : "s"} changed`,
                  `${saved.open.toLocaleString()} of ${saved.withSeats.toLocaleString()} meetings have seats open`,
                ]
                  .filter(Boolean)
                  .join(" · "),
          }
        : { tone: "error", message: saved.reason }
    );
    reload();
  };

  const blocked =
    admin === false
      ? "This account isn't an admin, so it can't publish the schedule."
      : bridge === "missing"
        ? "The TritonPlanner extension isn't detected. It's what reads TSS — load it, then reload this page."
        : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <ScheduleFeedCard admin={admin === true} />

      <div className="bg-white border border-slate-200 rounded-xl shadow-card px-5 py-4">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Fallback publish (legacy TSS capture) — last updated
            </p>
            <p className="text-2xl font-semibold text-slate-800 mt-0.5">
              {relativeTime(latest?.refreshedAt)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {latest
                ? `${TERMS.find((t) => t.value === latest.term)?.label ?? latest.term} ` +
                  `${latest.year} · ${latest.sectionCount.toLocaleString()} meetings across ` +
                  `${latest.courseCount.toLocaleString()} courses` +
                  (latest.refreshedAt ? ` · ${new Date(latest.refreshedAt).toLocaleString()}` : "")
                : "Nothing published. Fine — students read the Class Planner feed above; this copy only matters if that feed goes down."}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={year}
              onChange={(e) => setTarget((t) => ({ ...t, year: e.target.value }))}
              disabled={busy}
              className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
              aria-label="Academic year"
            >
              {[0, 1, 2].map((offset) => {
                const value = String(Number(defaultTerm().year) + offset);
                return (
                  <option key={value} value={value}>
                    {value}–{Number(value) + 1}
                  </option>
                );
              })}
            </select>
            <select
              value={term}
              onChange={(e) => setTarget((t) => ({ ...t, term: e.target.value }))}
              disabled={busy}
              className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
              aria-label="Term"
            >
              {TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              onClick={refresh}
              disabled={busy || Boolean(blocked)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy-500 text-white text-sm font-medium hover:bg-navy-600 disabled:opacity-50 disabled:hover:bg-navy-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Updating…" : "Update course data"}
            </button>
          </div>
        </div>

        {progress && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-3">
            <Clock className="w-3.5 h-3.5" />
            {progress} This takes a minute or two.
          </p>
        )}

        {result && (
          <p
            className={`flex items-start gap-1.5 text-xs mt-3 ${
              result.tone === "ok"
                ? "text-emerald-700"
                : result.tone === "warn"
                  ? "text-amber-700"
                  : "text-red-600"
            }`}
          >
            {result.tone === "ok" ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-px flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
            )}
            <span>
              {result.message}
              {result.detail && (
                <span className="block text-slate-500 mt-0.5">{result.detail}</span>
              )}
            </span>
          </p>
        )}

        {blocked && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 mt-3">
            <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
            {blocked}
          </p>
        )}

        {current && current !== latest && (
          <p className="text-xs text-slate-400 mt-3">
            {TERMS.find((t) => t.value === term)?.label} {year} was last updated{" "}
            {relativeTime(current.refreshedAt)}.
          </p>
        )}
      </div>

      {published.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Published terms
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                <th className="text-left font-medium py-1.5">Term</th>
                <th className="text-right font-medium py-1.5">Courses</th>
                <th className="text-right font-medium py-1.5">Meetings</th>
                <th className="text-right font-medium py-1.5">Updated</th>
              </tr>
            </thead>
            <tbody>
              {published.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-1.5 text-slate-700">
                    {TERMS.find((t) => t.value === row.term)?.label ?? row.term} {row.year}
                    {row.truncated && (
                      <span className="ml-1.5 text-[11px] text-amber-700">incomplete</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">
                    {row.courseCount.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">
                    {row.sectionCount.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right text-slate-500">
                    {relativeTime(row.refreshedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 px-1">
        Publishing replaces the shared copy of times, instructors and rooms — what every
        student sees, with no extension and no TSS login. Seat counts aren&apos;t part of
        it: those change by the minute during enrollment and come from each student&apos;s
        own session.
      </p>
    </div>
  );
};

export default AdminSectionData;
