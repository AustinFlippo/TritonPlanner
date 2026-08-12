/**
 * Page-world probe for SAP UI5 metadata.
 *
 * TSS is a Fiori app, so the DOM is generated markup with unstable class
 * soup — but UI5 keeps a control tree with real types (sap.m.Button,
 * sap.ui.table.Table) and developer-assigned ids underneath it. Those are far
 * more durable selector anchors than anything visible in the HTML, and they
 * survive UI5 re-renders that break CSS selectors.
 *
 * Content scripts are isolated from page JS, so this runs in the page world
 * and posts its findings back over window.postMessage.
 */

(() => {
  const token = document.currentScript?.dataset?.token;

  function reply(payload) {
    window.postMessage({ type: "TPBB_UI5_TREE", token, payload }, window.location.origin);
  }

  function getCore() {
    try {
      if (window.sap?.ui?.require) {
        let core = null;
        // UI5 2.x removed sap.ui.getCore(); the Core module is the way in.
        window.sap.ui.require(["sap/ui/core/Core"], (Core) => { core = Core; });
        if (core) return core;
      }
      if (typeof window.sap?.ui?.getCore === "function") return window.sap.ui.getCore();
    } catch {
      /* fall through */
    }
    return null;
  }

  function describe(control, depth) {
    if (!control || depth > 25) return null;

    let type = null;
    let id = null;
    try {
      type = control.getMetadata?.().getName?.() || null;
      id = control.getId?.() || null;
    } catch {
      return null;
    }
    if (!type) return null;

    const node = { type, id };

    // A few universally useful, non-personal properties.
    for (const prop of ["text", "title", "placeholder", "label", "tooltip"]) {
      try {
        const getter = control[`get${prop[0].toUpperCase()}${prop.slice(1)}`];
        if (typeof getter !== "function") continue;
        const value = getter.call(control);
        if (typeof value === "string" && value && value.length <= 60) {
          node[prop] = value;
        }
      } catch {
        /* property not readable — skip */
      }
    }

    try {
      if (typeof control.getEnabled === "function") node.enabled = control.getEnabled();
      if (typeof control.getVisible === "function") node.visible = control.getVisible();
    } catch {
      /* ignore */
    }

    const children = [];
    try {
      const aggregations = control.getMetadata().getAllAggregations?.() || {};
      for (const name of Object.keys(aggregations)) {
        const getter = aggregations[name]._sGetter;
        if (!getter || typeof control[getter] !== "function") continue;
        const value = control[getter]();
        const list = Array.isArray(value) ? value : value ? [value] : [];
        for (const child of list.slice(0, 40)) {
          const built = describe(child, depth + 1);
          if (built) children.push(built);
        }
      }
    } catch {
      /* aggregation walk failed — keep what we have */
    }

    if (children.length) node.children = children;
    return node;
  }

  try {
    const core = getCore();
    if (!core) return reply({ available: false, reason: "UI5 core not reachable" });

    const roots = [];
    try {
      const uiArea = core.getUIArea?.("content") || null;
      if (uiArea) {
        for (const control of uiArea.getContent?.() || []) {
          const built = describe(control, 0);
          if (built) roots.push(built);
        }
      }
    } catch {
      /* ignore */
    }

    // Fall back to walking statically-registered elements when UIArea is empty.
    if (!roots.length) {
      try {
        const registry = window.sap.ui.core?.Element?.registry;
        const seen = [];
        registry?.forEach?.((el) => {
          if (seen.length >= 60) return;
          try {
            if (!el.getParent?.()) seen.push(el);
          } catch { /* ignore */ }
        });
        for (const el of seen) {
          const built = describe(el, 0);
          if (built) roots.push(built);
        }
      } catch {
        /* ignore */
      }
    }

    reply({
      available: true,
      version: window.sap?.ui?.version || null,
      rootCount: roots.length,
      roots,
    });
  } catch (error) {
    reply({ available: false, reason: String(error?.message || error) });
  }
})();
