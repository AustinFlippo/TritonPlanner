/**
 * Guards against the orphaned-content-script state.
 *
 * Reloading an unpacked extension does not reload the pages it is already
 * injected into. Those scripts keep running, but their bridge to the extension
 * is severed: `chrome.runtime` becomes undefined, or `chrome.runtime.id` goes
 * away while the namespace lingers. Every call then dies with
 *
 *   TypeError: Cannot read properties of undefined (reading 'getURL')
 *
 * which says nothing about the actual problem — the page just needs reloading.
 * During development that happens after every single change, so it is worth a
 * named check rather than a stack trace.
 */

(() => {
  /** True while this content script can still reach its extension. */
  function alive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      // Touching chrome.runtime can itself throw once the context is gone.
      return false;
    }
  }

  const STALE_MESSAGE =
    "The extension was reloaded, so this page lost its connection. " +
    "Reload the page (⌘R / Ctrl-R) to reconnect.";

  /**
   * sendMessage that reports a dead context instead of throwing.
   * Resolves { ok, response } or { ok: false, stale: true, reason }.
   */
  function sendMessage(message) {
    return new Promise((resolve) => {
      if (!alive()) {
        resolve({ ok: false, stale: true, reason: STALE_MESSAGE });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const failure = chrome.runtime.lastError;
          if (failure) {
            resolve({ ok: false, stale: true, reason: failure.message });
            return;
          }
          resolve({ ok: true, response });
        });
      } catch (error) {
        resolve({ ok: false, stale: true, reason: String(error?.message || error) });
      }
    });
  }

  /** getURL that returns null on a dead context rather than throwing. */
  function getURL(path) {
    return alive() ? chrome.runtime.getURL(path) : null;
  }

  window.TPBB_runtime = { alive, sendMessage, getURL, STALE_MESSAGE };
})();
