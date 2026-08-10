/**
 * Privacy-safe structural capture of a TSS page.
 *
 * TSS sits behind SSO + Duo, so the selectors this extension needs cannot be
 * discovered from outside. This tool lets a signed-in student export the
 * *shape* of a page — tags, ids, roles, control types, UI chrome labels —
 * with personal data stripped, so selectors can be written without anyone
 * handing over a screenshot of their record.
 *
 * What is kept:   structure, element ids, classes, ARIA roles, SAP UI5 control
 *                 types, short UI labels ("Book/Save", "Waitlist Active").
 * What is scrubbed: emails, student numbers, long digit runs, and any text
 *                 longer than a UI label, which is where record data lives.
 */

(() => {
  const MAX_LABEL = 60;
  const MAX_NODES = 4000;

  // --- redaction -----------------------------------------------------------

  const SCRUBBERS = [
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, "<EMAIL>"],
    [/\bA\d{8}\b/g, "<PID>"], // legacy UCSD PID
    [/\b[UT]\d{7,}\b/gi, "<STUDENTNUM>"], // Triton Student Number shapes
    [/\b\d{3}-\d{2}-\d{4}\b/g, "<SSN>"],
    [/\b\d{7,}\b/g, "<NUM>"],
    // Fiori's shell header labels the avatar "Profile of <Full Name>", which
    // is short enough to survive the length cutoff. Same for the greeting and
    // sign-out variants other Fiori shells use.
    [/\b(Profile|Account|Settings|Sign Out|Log Out|Logged in)\s+(of|for|as)\s+.+/gi, "$1 $2 <NAME>"],
    [/\b(Welcome|Hello|Hi),?\s+[A-Z][\w'’-]+(\s+[A-Z][\w'’-]+)*/g, "$1, <NAME>"],
  ];

  // Course codes are structural, not personal — keep them, they anchor selectors.
  const COURSE_CODE = /^[A-Z]{2,5}[- ]\d{1,3}[A-Z]{0,3}$/;

  function redact(raw) {
    if (!raw) return null;
    let text = String(raw).replace(/\s+/g, " ").trim();
    if (!text) return null;

    if (COURSE_CODE.test(text)) return text;

    for (const [pattern, replacement] of SCRUBBERS) {
      text = text.replace(pattern, replacement);
    }

    // Anything longer than a UI label is prose or record data, not a selector
    // anchor. Keep only its length so layout is still legible.
    if (text.length > MAX_LABEL) return `<TEXT:${text.length}>`;
    return text;
  }

  /** Direct text of a node, excluding its element children. */
  function ownText(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    }
    return redact(out);
  }

  // --- SAP UI5 awareness ---------------------------------------------------

  /**
   * Fiori generates ids like "__xmlview0--bookButton". The generated prefix
   * changes between sessions but the trailing local id is stable, so record
   * both and let selector authoring prefer the stable half.
   */
  function splitUi5Id(id) {
    if (!id) return null;
    const parts = String(id).split("--");
    return {
      full: id,
      local: parts.length > 1 ? parts[parts.length - 1] : id,
      generated: /^__/.test(id),
    };
  }

  function attributesOf(el) {
    const kept = {};
    for (const attr of el.attributes || []) {
      const name = attr.name;
      // Attribute *names* are structural; values may carry data, so redact.
      if (
        name === "id" || name === "class" || name === "type" || name === "role" ||
        name === "name" || name === "placeholder" || name === "title" ||
        name.startsWith("aria-") || name.startsWith("data-sap") || name === "data-testid"
      ) {
        kept[name] = redact(attr.value);
      } else if (name.startsWith("data-")) {
        kept[name] = "<present>";
      }
    }
    return kept;
  }

  const INTERESTING = new Set([
    "input", "button", "select", "textarea", "a", "table", "thead", "tbody",
    "tr", "th", "td", "form", "label", "h1", "h2", "h3", "h4", "li", "option",
  ]);

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERESTING.has(tag)) return true;
    const role = el.getAttribute("role");
    return Boolean(role && /button|link|row|gridcell|columnheader|combobox|checkbox|tab/.test(role));
  }

  // --- tree walk -----------------------------------------------------------

  function snapshot(root = document.body) {
    let visited = 0;
    let truncated = false;

    function walk(el, depth) {
      if (visited++ > MAX_NODES) {
        truncated = true;
        return null;
      }
      if (depth > 30) return null;

      const tag = el.tagName ? el.tagName.toLowerCase() : null;
      if (!tag || tag === "script" || tag === "style" || tag === "svg") return null;

      const children = [];
      for (const child of el.children) {
        const built = walk(child, depth + 1);
        if (built) children.push(built);
      }

      const text = ownText(el);
      const interactive = isInteractive(el);

      // Collapse pure layout wrappers so the output stays readable.
      if (!interactive && !text && children.length === 1 && !el.id) {
        return children[0];
      }
      if (!interactive && !text && children.length === 0) return null;

      const node = { tag, children };
      if (text) node.text = text;

      const id = el.getAttribute("id");
      if (id) node.id = splitUi5Id(id);

      const className = el.getAttribute("class");
      if (className) {
        // SAP class names (sapMBtn, sapUiTable...) are the useful ones.
        const classes = className.split(/\s+/).filter(Boolean);
        const sap = classes.filter((c) => /^sap/i.test(c));
        node.classes = sap.length ? sap.slice(0, 8) : classes.slice(0, 6);
      }

      if (interactive) node.attrs = attributesOf(el);
      if (!node.children.length) delete node.children;
      return node;
    }

    const tree = walk(root, 0);
    return { tree, visited, truncated };
  }

  /**
   * Ask the page world for SAP UI5's control tree. Content scripts run
   * isolated, so this posts a request to an injected page-world script and
   * resolves with whatever it can read from sap.ui.getCore().
   */
  function requestUi5Tree(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const token = `tpbb-${Math.random().toString(36).slice(2)}`;
      let done = false;

      function onMessage(event) {
        if (event.source !== window) return;
        if (event.data?.type !== "TPBB_UI5_TREE" || event.data.token !== token) return;
        done = true;
        window.removeEventListener("message", onMessage);
        resolve(event.data.payload || null);
      }
      window.addEventListener("message", onMessage);

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/ui5-probe.js");
      script.dataset.token = token;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);

      setTimeout(() => {
        if (done) return;
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs);
    });
  }

  async function capture(label = "unlabeled") {
    const dom = snapshot();
    const ui5 = await requestUi5Tree();
    return {
      capturedFor: label,
      // Path only — query strings can carry identifiers.
      url: location.origin + location.pathname,
      hash: location.hash ? location.hash.split("?")[0] : null,
      title: redact(document.title),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      nodesVisited: dom.visited,
      truncated: dom.truncated,
      ui5,
      dom: dom.tree,
    };
  }

  window.__TPBB_capture = capture;
})();
