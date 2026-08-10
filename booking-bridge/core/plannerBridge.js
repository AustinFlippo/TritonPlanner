/**
 * TritonPlanner-side connector.
 *
 * Import this from the React app to send a booking plan to the extension and
 * to pull back section data the extension scraped out of TSS. Everything goes
 * through CustomEvents on window; the extension's content script relays them.
 *
 * Deliberately standalone — drop it in without editing existing components.
 * Wiring it up is one import plus a button handler; see the README.
 */

import { buildBookingPlan } from "./bookingPlan.js";
import { indexCatalog } from "./catalog.js";

const EVENTS = {
  send: "tritonplanner:booking-plan",
  ack: "tritonplanner:booking-plan-ack",
  requestSections: "tritonplanner:request-sections",
  sections: "tritonplanner:sections",
  ready: "tritonplanner:bridge-ready",
};

/** Resolves true if the extension announced itself, false after `timeoutMs`. */
export function isBridgeInstalled(timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ready, onReady);
      resolve(value);
    };
    const onReady = () => done(true);
    window.addEventListener(EVENTS.ready, onReady);
    // The extension fires `ready` at document_idle, which may already have
    // passed; re-dispatching the request is harmless if it has not.
    setTimeout(() => done(false), timeoutMs);
  });
}

/** Send a plan to the extension. Resolves with the ack, or null on timeout. */
export function sendPlanToBridge(plan, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const onAck = (event) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ack, onAck);
      resolve(event.detail);
    };
    window.addEventListener(EVENTS.ack, onAck);
    window.dispatchEvent(new CustomEvent(EVENTS.send, { detail: plan }));
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.ack, onAck);
      resolve(null);
    }, timeoutMs);
  });
}

/** Pull back section data scraped from TSS, keyed by course id. */
export function requestScrapedSections(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const onSections = (event) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.sections, onSections);
      resolve(event.detail || {});
    };
    window.addEventListener(EVENTS.sections, onSections);
    window.dispatchEvent(new CustomEvent(EVENTS.requestSections));
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EVENTS.sections, onSections);
      resolve({});
    }, timeoutMs);
  });
}

/**
 * One-call convenience: build a plan from the live grid and hand it over.
 *
 * @param {object}   options
 * @param {object[]} options.grid        the planner's schedule state
 * @param {number}   options.yearIndex   which year row to book
 * @param {string}   options.term        "fall" | "winter" | "spring"
 * @param {string}   options.termCode    TSS term label, e.g. "FA26"
 * @param {object[]} options.catalogJson raw v5.json course array
 * @param {number}   options.pass        1 or 2
 */
export async function planAndSend({
  grid,
  yearIndex,
  term,
  termCode,
  catalogJson,
  pass = 1,
  level = "undergrad",
  preferences = {},
  alreadyBooked = [],
}) {
  const catalog = indexCatalog(catalogJson);

  // Use whatever TSS data the extension already has, so the plan is ranked on
  // real seat counts and meeting times when they are available.
  const sectionsByCourse = await requestScrapedSections();

  const plan = buildBookingPlan({
    grid,
    yearIndex,
    term,
    termCode,
    catalog,
    sectionsByCourse,
    pass,
    level,
    preferences,
    alreadyBooked,
  });
  plan.generatedAt = Date.now();

  const ack = await sendPlanToBridge(plan);
  return { plan, delivered: Boolean(ack?.ok) };
}

export { EVENTS as BRIDGE_EVENTS };
