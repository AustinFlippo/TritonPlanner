/**
 * Service worker: the only thing that persists between the TritonPlanner tab
 * and the TSS tab.
 *
 * Deliberately dumb. It stores a booking plan and the sections scraped out of
 * TSS, and does no network I/O of its own — nothing student-identifying ever
 * leaves the browser through this extension.
 */

const STORE = {
  plan: "bookingPlan",
  sections: "scrapedSections",
  log: "activityLog",
};

async function appendLog(entry) {
  const { [STORE.log]: log = [] } = await chrome.storage.local.get(STORE.log);
  log.push({ ...entry, at: Date.now() });
  // Keep the log short; it exists for debugging a failed window, not history.
  await chrome.storage.local.set({ [STORE.log]: log.slice(-100) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "TPBB_SET_PLAN": {
        await chrome.storage.local.set({ [STORE.plan]: message.payload });
        await appendLog({
          event: "plan-loaded",
          term: message.payload?.termCode,
          steps: message.payload?.steps?.length ?? 0,
        });
        sendResponse({ ok: true });
        break;
      }

      case "TPBB_GET_PLAN": {
        const stored = await chrome.storage.local.get(STORE.plan);
        sendResponse({ ok: true, plan: stored[STORE.plan] || null });
        break;
      }

      case "TPBB_SECTIONS_SCRAPED": {
        const { [STORE.sections]: existing = {} } = await chrome.storage.local.get(STORE.sections);
        // Merge by course id so scraping several search pages accumulates
        // rather than replacing.
        const merged = { ...existing };
        for (const section of message.payload?.sections || []) {
          if (!section.courseId) continue;
          const list = merged[section.courseId] || [];
          const isDuplicate = list.some(
            (s) => s.sectionId === section.sectionId && s.component === section.component
          );
          if (!isDuplicate) list.push(section);
          merged[section.courseId] = list;
        }
        await chrome.storage.local.set({ [STORE.sections]: merged });
        await appendLog({
          event: "sections-scraped",
          count: message.payload?.sections?.length ?? 0,
          courses: Object.keys(merged).length,
        });
        sendResponse({ ok: true, courses: Object.keys(merged).length });
        break;
      }

      case "TPBB_GET_SECTIONS": {
        const stored = await chrome.storage.local.get(STORE.sections);
        sendResponse({ ok: true, sections: stored[STORE.sections] || {} });
        break;
      }

      case "TPBB_CLEAR": {
        await chrome.storage.local.remove([STORE.plan, STORE.sections, STORE.log]);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, reason: `unknown message type '${message?.type}'` });
    }
  })();

  return true; // keep the channel open for the async response
});
