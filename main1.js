const { FuzzySuggestModal, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, debounce } = require("obsidian");

const DEFAULT_SNIPPETS = [
  ["_alpha", "\\alpha"], ["_beta", "\\beta"], ["_gamma", "\\gamma"], ["_delta", "\\delta"],
  ["_epsilon", "\\epsilon"], ["_theta", "\\theta"], ["_lambda", "\\lambda"], ["_mu", "\\mu"],
  ["_pi", "\\pi"], ["_sigma", "\\sigma"], ["_phi", "\\phi"], ["_omega", "\\omega"],
  ["_Gamma", "\\Gamma"], ["_Delta", "\\Delta"], ["_Theta", "\\Theta"], ["_Lambda", "\\Lambda"],
  ["_Pi", "\\Pi"], ["_Sigma", "\\Sigma"], ["_Phi", "\\Phi"], ["_Omega", "\\Omega"],
  ["times", "\\times"], ["cdot", "\\cdot"], ["div", "\\div"], ["pm", "\\pm"],
  ["approx", "\\approx"], ["neq", "\\neq"], ["leq", "\\leq"], ["geq", "\\geq"],
  ["infty", "\\infty"], ["partial", "\\partial"], ["nabla", "\\nabla"], ["degree", "^\\circ"],
  ["rightarrow", "\\rightarrow"], ["leftarrow", "\\leftarrow"], ["Rightarrow", "\\Rightarrow"],
  ["Leftarrow", "\\Leftarrow"], ["leftrightarrow", "\\leftrightarrow"], ["to", "\\to"],
  ["in", "\\in"], ["notin", "\\notin"], ["subset", "\\subset"], ["subseteq", "\\subseteq"],
  ["cup", "\\cup"], ["cap", "\\cap"], ["emptyset", "\\emptyset"], ["forall", "\\forall"],
  ["exists", "\\exists"], ["neg", "\\neg"], ["land", "\\land"], ["lor", "\\lor"],
  ["sum", "\\sum"], ["prod", "\\prod"], ["int", "\\int"], ["sqrt", "\\sqrt{}"],
  ["frac", "\\frac{}{}"], ["text", "\\text{}"], ["mathrm", "\\mathrm{}"], ["mathbf", "\\mathbf{}"],
  ["sin", "\\sin"], ["cos", "\\cos"], ["tan", "\\tan"], ["log", "\\log"], ["ln", "\\ln"],
  ["lim", "\\lim"], ["min", "\\min"], ["max", "\\max"], ["det", "\\det"],
  ["left", "\\left"], ["right", "\\right"], ["bar", "\\bar{}"], ["hat", "\\hat{}"],
  ["vec", "\\vec{}"], ["dot", "\\dot{}"], ["overline", "\\overline{}"],
  ["begin_matrix", "\\begin{matrix}"], ["end_matrix", "\\end{matrix}"],
  ["begin_bmatrix", "\\begin{bmatrix}"], ["end_bmatrix", "\\end{bmatrix}"],
  ["begin_cases", "\\begin{cases}"], ["end_cases", "\\end{cases}"],
  ["begin_aligned", "\\begin{aligned}"], ["end_aligned", "\\end{aligned}"],
  ["begin_array", "\\begin{array}"], ["end_array", "\\end{array}"],
  ["matrix", ""], ["cases", ""], ["aligned", ""], ["array", ""],
].map(([from, to]) => [from.startsWith("_") ? from : `_${from}`, to]);

// Actions added in later versions. If their default keys are already used by another
// binding in the user's saved settings, they move to the first free alternative, so the
// keys the user already relies on keep working.
const BINDING_GROUPS = [
  { actions: ["nextMarker", "prevMarker"], options: [["n", "N"], ["}", "{"], ["m", "M"]] },
  { actions: ["jumpBack", "jumpForward"], options: [["<", ">"], ["H", "L"]] },
  { actions: ["headingList"], options: [["o"], ["O"], ["H"], ["Ctrl+g"]] },
  { actions: ["linkHints"], options: [["F"], ["e"], ["E"]] },
  { actions: ["markerJump"], options: [["'"], ["`"]] },
  { actions: ["markerList"], options: [["Ctrl+m"], ["Ctrl+k"]] },
  { actions: ["nextHeading", "prevHeading"], options: [["]]", "[["], ["}}", "{{"]] },
];

const BINDING_HINTS = {
  insert: "Switch to Insert (Editing) mode",
  append: "Insert mode, one character to the right",
  top: "Scroll to the top of the note",
  bottom: "Scroll to the end of the note",
  up: "Scroll up by the configured number of lines",
  down: "Scroll down by the configured number of lines",
  newTab: "Create a new note and start in Insert mode",
  nextHeading: "Jump to the next heading",
  prevHeading: "Jump to the previous heading",
  nextMarker: "Jump to the next marker (:> or :name>)",
  prevMarker: "Jump to the previous marker",
  markerList: "List every marker in the note",
  markerJump: "Press this, then a marker's name: ' then m jumps to :m>",
  headingList: "Searchable list of headings",
  jumpBack: "Go back to where you were before the last jump",
  jumpForward: "Go forward again after jumping back",
  linkHints: "Label visible links with letters, type them to open",
};

// Returns a description of each change it made (empty when there was no clash).
function resolveBindingClashes(bindings) {
  const changes = [];
  for (const group of BINDING_GROUPS) {
    if (!group.actions.every((action) => action in bindings)) continue;
    const taken = new Set(
      Object.entries(bindings).filter(([action]) => !group.actions.includes(action)).map(([, key]) => key),
    );
    const isDefault = group.actions.every((action, i) => bindings[action] === group.options[0][i]);
    if (!isDefault || !group.options[0].some((key) => taken.has(key))) continue;
    const free = group.options.find((keys) => keys.every((key) => !taken.has(key)));
    if (!free) continue;
    const clash = Object.entries(bindings).find(([action, key]) => !group.actions.includes(action) && group.options[0].includes(key));
    group.actions.forEach((action, i) => { bindings[action] = free[i]; });
    changes.push(`${group.actions.join("/")} → ${free.join(" ")} ("${group.options[0].join(" ")}" is used by ${clash ? clash[0] : "another action"})`);
  }
  return changes;
}

const HINT_ALPHABET = "asdfghjklqwertyuiop";

const DEFAULT_VIM_BINDINGS = {
  insert: "i", append: "a", top: "gg", bottom: "G",
  up: "k", down: "j", settings: "s",
  sidebar: "b", fileSwitcher: "f", search: "/",
  close: "q", closeAlt: "x", commandPalette: ":", rename: "r", newTab: "t",
  pageDown: "Ctrl+d", pageUp: "Ctrl+u",
  nextHeading: "]]", prevHeading: "[[",
  nextMarker: "n", prevMarker: "N", markerList: "Ctrl+m",
  linkHints: "F",
  markerJump: "'", headingList: "o", jumpBack: "<", jumpForward: ">",
};

const DEFAULT_SETTINGS = {
  convertDisplayMath: true,
  convertInlineMath: true,
  normalizeEscapedCommands: true,
  fixAsteriskSubscripts: true,
  markUncertain: false,
  enableVimBindings: false,
  vimMoveLines: 1,
  vimBindings: DEFAULT_VIM_BINDINGS,
  snippets: DEFAULT_SNIPPETS.map(([from, to]) => `${from}=${to}`).join("\n"),
  knownDefaultSnippets: [],
  resumePosition: true,
  showModeIndicator: true,
  convertOnPaste: false,
  previewBeforeConvert: false,
  markerOpen: ":",
  markerClose: ">",
  convertUnicodeMath: true,
  citationMode: "keep",
  maxRememberedFiles: 300,
  positions: {},
  shortcut: "",
};

const MIN_REMEMBERED_FILES = 10;
const MAX_REMEMBERED_FILES = 5000;

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function clampRememberedFiles(value) {
  return clampInteger(
    value,
    DEFAULT_SETTINGS.maxRememberedFiles,
    MIN_REMEMBERED_FILES,
    MAX_REMEMBERED_FILES,
  );
}

function clampVimMoveLines(value) {
  return clampInteger(value, DEFAULT_SETTINGS.vimMoveLines, 1, 50);
}

function parseSnippets(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf("=");
      return separator < 0
        ? [line.trim(), ""]
        : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
    .filter(([from, to]) => from && from.length <= 80 && (!to || to.length <= 200))
    .map(([from, to = ""]) => [from, to]);
}

// Add only defaults the user has never seen. Defaults they deleted stay deleted.
function mergeDefaultSnippets(value, knownDefaults) {
  const existing = parseSnippets(value);
  const existingKeys = new Set(existing.map(([from]) => from));
  const known = new Set(knownDefaults);
  return [
    ...existing,
    ...DEFAULT_SNIPPETS.filter(([from]) => !existingKeys.has(from) && !known.has(from)),
  ];
}

function serializeSnippets(snippets) {
  return snippets
    .filter(([from]) => from.trim())
    .map(([from, to]) => `${from.trim()}=${to.trim()}`)
    .join("\n");
}

class NotebookLMToObsidianPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    await this.migratePositions(this.storedLegacyPositions);
    this.storedLegacyPositions = undefined;
    this.vimPendingKey = "";
    if (this.bindingChanges?.length) {
      // A phone must never write the shared data.json; it re-derives the same keys on each start.
      if (!Platform.isMobile) await this.saveSettings();
      this.app.workspace.onLayoutReady(() => {
        new Notice(
          `Fixy moved ${this.bindingChanges.length} new key${this.bindingChanges.length === 1 ? "" : "s"} so your existing keys keep working: ${this.bindingChanges.join("; ")}. Change them under Settings → Fixy → Vim keybindings.`,
          15000,
        );
      });
    }

    this.addCommand({
      id: "convert-notebooklm-markdown",
      name: "Fixy: Convert NotebookLM Markdown to Obsidian",
      editorCallback: (editor) => this.convertMarkdown(editor),
    });
    this.addCommand({
      id: "preview-notebooklm-conversion",
      name: "Fixy: Preview conversion before applying",
      editorCallback: (editor) => this.convertMarkdown(editor, { preview: true }),
    });
    this.addCommand({
      id: "check-math",
      name: "Fixy: Check math for problems",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) this.openMathCheck(view);
        return true;
      },
    });

    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor) => this.handlePaste(event, editor)));
    this.registerDomEvent(document, "keydown", (event) => this.handleShortcut(event), true);
    this.addSettingTab(new NotebookLMToObsidianSettingTab(this.app, this));
    this.setUpResumePosition();
    this.setUpLinkAwareness();
    this.setUpModeIndicator();
    this.setUpNavigation();
  }

  onunload() {
    this.flushPosition();
  }

  async loadSettings() {
    const stored = (await this.loadData()) || {};
    this.storedLegacyPositions = stored.positions;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    // Never share the default object: positions are mutated in place.
    this.settings.positions = Object.assign({}, this.settings.positions);
    this.settings.maxRememberedFiles = clampRememberedFiles(this.settings.maxRememberedFiles);
    if (!["keep", "strip", "footnotes"].includes(this.settings.citationMode)) this.settings.citationMode = "keep";
    for (const key of ["markerOpen", "markerClose"]) {
      const value = this.settings[key];
      if (typeof value !== "string" || !value || value.length > 3 || /\s/.test(value)) this.settings[key] = DEFAULT_SETTINGS[key];
    }
    this.settings.vimMoveLines = clampVimMoveLines(this.settings.vimMoveLines);
    this.settings.vimBindings = Object.assign({}, DEFAULT_VIM_BINDINGS, this.settings.vimBindings);
    // Ctrl+o is Obsidian's own quick-switcher hotkey and never reaches Fixy. Move the
    // old default pair; a binding the user chose themselves is left alone.
    const bindings = this.settings.vimBindings;
    if (bindings.jumpBack === "Ctrl+o" && bindings.jumpForward === "Ctrl+i") {
      bindings.jumpBack = DEFAULT_VIM_BINDINGS.jumpBack;
      bindings.jumpForward = DEFAULT_VIM_BINDINGS.jumpForward;
    }
    this.bindingChanges = resolveBindingClashes(bindings);
    for (const key of ["lineStart", "lineEnd", "wordForward", "wordBackward", "next", "previous", "undo", "redo"]) {
      delete this.settings.vimBindings[key];
    }
    // First run of this version: treat every current default as already seen so
    // snippets the user removed earlier are not silently re-added on each start.
    const known = Array.isArray(stored.knownDefaultSnippets)
      ? stored.knownDefaultSnippets
      : DEFAULT_SNIPPETS.map(([from]) => from);
    this.settings.snippets = serializeSnippets(
      typeof stored.snippets === "string" || Array.isArray(stored.knownDefaultSnippets)
        ? mergeDefaultSnippets(this.settings.snippets, known)
        : DEFAULT_SNIPPETS,
    );
    this.settings.knownDefaultSnippets = DEFAULT_SNIPPETS.map(([from]) => from);
    delete this.settings.enableBasicMath;
  }

  // ---------------------------------------------------------------------
  // Navigation in Reading mode: headings (]] and [[), markers (n, N and the
  // Ctrl+m list) and link hints (F).
  // ---------------------------------------------------------------------
  setUpNavigation() {
    this.navJump = null;
    this.hintSession = null;
    this.awaitingMarkerName = false;
    this.jumpLists = new Map();
    for (const [id, name, run] of [
      ["list-headings", "List headings", (view) => this.openHeadingList(view)],
      ["jump-back", "Jump back to the previous position", (view) => this.jumpHistory(view, -1)],
      ["jump-forward", "Jump forward again", (view) => this.jumpHistory(view, 1)],
    ]) {
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view?.file) return false;
          if (!checking) run(view);
          return true;
        },
      });
    }
    this.addCommand({
      id: "list-markers",
      name: "List markers",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) this.openMarkerList(view);
        return true;
      },
    });
    this.register(() => this.cancelHints());
  }

  getReadingScroll(view) {
    try {
      const value = view?.previewMode?.getScroll?.() ?? view?.currentMode?.getScroll?.();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  // Where "next" and "previous" start from. Right after a jump we continue from
  // the line we jumped to (the section can begin above it). Once the reader has
  // scrolled away, we continue from what is on screen.
  navigationBase(view) {
    const now = this.getReadingScroll(view);
    const last = this.navJump;
    if (last && last.path === view.file?.path) {
      if (!Number.isFinite(last.scroll) || (now !== null && Math.abs(now - last.scroll) <= 3)) return last.line;
    }
    return now ?? 0;
  }

  jumpListFor(view) {
    const path = view.file.path;
    if (!this.jumpLists) this.jumpLists = new Map();
    if (!this.jumpLists.has(path)) this.jumpLists.set(path, { back: [], forward: [] });
    return this.jumpLists.get(path);
  }

  currentLine(view) {
    if (view.getMode() === "source" && view.editor) return view.editor.getCursor().line;
    return this.getReadingScroll(view) ?? 0;
  }

  // Remember where the reader was before a jump, like Vim's jump list.
  recordJump(view, target) {
    if (!view.file) return;
    const here = this.currentLine(view);
    if (Number.isFinite(target) && Math.abs(here - target) < 1) return;
    const list = this.jumpListFor(view);
    if (list.back[list.back.length - 1] !== here) list.back.push(here);
    if (list.back.length > 100) list.back.shift();
    list.forward.length = 0;
  }

  jumpHistory(view, direction) {
    if (!view.file) return;
    const list = this.jumpListFor(view);
    const from = direction < 0 ? list.back : list.forward;
    const to = direction < 0 ? list.forward : list.back;
    const target = from.pop();
    if (target === undefined) {
      new Notice(direction < 0 ? "Fixy: nothing earlier to jump back to." : "Fixy: nothing to jump forward to.");
      return;
    }
    to.push(this.currentLine(view));
    this.goToLine(view, target, { record: false });
  }

  scrollReadingTo(view, line, { record = true } = {}) {
    const target = Math.max(0, line);
    if (record) this.recordJump(view, target);
    let applied = false;
    try {
      if (typeof view.previewMode?.applyScroll === "function") {
        view.previewMode.applyScroll(target);
        applied = true;
      }
    } catch (error) {
      console.error("Fixy: applyScroll failed", error);
    }
    if (!applied && typeof view.setEphemeralState === "function") view.setEphemeralState({ scroll: target });
    this.navJump = { path: view.file.path, line: target, scroll: null };
    window.setTimeout(() => {
      if (this.navJump?.line !== target) return;
      const active = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.file?.path === view.file.path) this.navJump.scroll = this.getReadingScroll(active);
    }, 300);
  }

  goToLine(view, line, options = {}) {
    if (view.getMode() === "source" && view.editor) {
      const target = { line: Math.min(Math.max(0, line), Math.max(0, view.editor.lastLine())), ch: 0 };
      if (options.record !== false) this.recordJump(view, target.line);
      view.editor.setCursor(target);
      view.editor.scrollIntoView({ from: target, to: target }, true);
      return;
    }
    this.scrollReadingTo(view, line, options);
  }

  getHeadings(view) {
    const cached = this.app.metadataCache.getFileCache(view.file)?.headings;
    if (cached?.length) {
      return cached
        .map((h) => ({ line: h.position.start.line, level: h.level, heading: h.heading }))
        .sort((a, b) => a.line - b.line);
    }
    const text = typeof view.data === "string" ? view.data : view.editor?.getValue?.() ?? "";
    const headings = [];
    let fence = null;
    text.split(/\r?\n/).forEach((line, index) => {
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) { fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]; return; }
      const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (h) headings.push({ line: index, level: h[1].length, heading: h[2] });
    });
    return headings;
  }

  openHeadingList(view) {
    if (!view.file) return;
    const headings = this.getHeadings(view);
    if (headings.length === 0) {
      new Notice("Fixy: this note has no headings.");
      return;
    }
    new PickerModal(this.app, {
      items: headings,
      placeholder: "Jump to a heading",
      text: (heading) => heading.heading,
      render: renderHeadingRow,
      onChoose: (heading) => this.jumpAfterPicker(view, heading.line),
    }).open();
  }

  // Let the picker close first so the note is the active view again, then jump.
  jumpAfterPicker(view, line) {
    window.setTimeout(() => {
      const active = this.app.workspace.getActiveViewOfType(MarkdownView) ?? view;
      if (active.file?.path === view.file.path) this.goToLine(active, line);
    }, 50);
  }

  // Vim's 'a: jump to the marker named a. Repeating cycles through markers that share a name.
  jumpToNamedMarker(view, name) {
    if (!view.file) return;
    const markers = this.getMarkers(view);
    let matches = markers.filter((marker) => marker.name === name);
    if (matches.length === 0) matches = markers.filter((marker) => marker.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) {
      const known = [...new Set(markers.map((marker) => marker.name).filter(Boolean))];
      new Notice(known.length
        ? `Fixy: no marker named "${name}". Named markers here: ${known.join(", ")}.`
        : `Fixy: no marker named "${name}". Write one like ${this.settings.markerOpen}${name}${this.settings.markerClose}.`);
      return;
    }
    const lines = [...new Set(matches.map((marker) => marker.line))];
    const base = this.navigationBase(view);
    this.scrollReadingTo(view, lines.find((line) => line > base) ?? lines[0]);
  }

  jumpToHeading(view, direction) {
    if (!view.file) return;
    const headings = (this.app.metadataCache.getFileCache(view.file)?.headings ?? [])
      .map((heading) => heading.position.start.line)
      .sort((a, b) => a - b);
    if (headings.length === 0) {
      new Notice("Fixy: this note has no headings.");
      return;
    }
    const base = this.navigationBase(view);
    const target = direction > 0
      ? headings.find((line) => line > base)
      : [...headings].reverse().find((line) => line < base);
    if (target === undefined) {
      new Notice(direction > 0 ? "Fixy: no more headings below." : "Fixy: no more headings above.");
      return;
    }
    this.scrollReadingTo(view, target);
  }

  getMarkers(view) {
    const text = typeof view.data === "string" ? view.data : view.editor?.getValue?.() ?? "";
    return findMarkers(text, this.settings);
  }

  markerExample() {
    const { markerOpen, markerClose } = this.settings;
    return `${markerOpen}${markerClose} or ${markerOpen}m${markerClose}`;
  }

  jumpToMarker(view, direction) {
    if (!view.file) return;
    const lines = [...new Set(this.getMarkers(view).map((marker) => marker.line))];
    if (lines.length === 0) {
      new Notice(`Fixy: no markers in this note. Write one like ${this.markerExample()}.`);
      return;
    }
    const base = this.navigationBase(view);
    let target = direction > 0
      ? lines.find((line) => line > base)
      : [...lines].reverse().find((line) => line < base);
    if (target === undefined) {
      target = direction > 0 ? lines[0] : lines[lines.length - 1];
      new Notice(direction > 0 ? "Fixy: last marker passed, wrapped to the first." : "Fixy: first marker passed, wrapped to the last.");
    }
    this.scrollReadingTo(view, target);
  }

  openMarkerList(view) {
    if (!view.file) return;
    const markers = this.getMarkers(view);
    if (markers.length === 0) {
      new Notice(`Fixy: no markers in this note. Write one like ${this.markerExample()}.`);
      return;
    }
    new PickerModal(this.app, {
      items: markers,
      placeholder: "Jump to a marker: type its name or its text",
      text: (marker) => `${marker.name} ${marker.text}`,
      render: renderMarkerRow,
      onChoose: (marker) => this.jumpAfterPicker(view, marker.line),
    }).open();
  }

  // Link hints: label every visible link, type its letters to open it.
  // Shift on the last letter opens it in a new tab.
  startLinkHints(view) {
    this.cancelHints();
    const root = view.containerEl?.querySelector?.(".markdown-preview-view") ?? view.previewMode?.containerEl;
    if (!root) return;
    const scroller = this.getPreviewScroller(view) || root;
    const bounds = scroller.getBoundingClientRect();
    const seen = new Set();
    const links = [];
    for (const el of root.querySelectorAll("a[href], a.internal-link, a.tag")) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = el.getClientRects()[0];
      if (!rect || rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      links.push({ el, rect });
    }
    if (links.length === 0) {
      new Notice("Fixy: no visible links.");
      return;
    }
    let length = 1;
    while (HINT_ALPHABET.length ** length < links.length) length += 1;
    const hints = links.map(({ el, rect }, index) => {
      let n = index;
      let label = "";
      for (let k = 0; k < length; k += 1) {
        label = HINT_ALPHABET[n % HINT_ALPHABET.length] + label;
        n = Math.floor(n / HINT_ALPHABET.length);
      }
      const badge = document.createElement("div");
      badge.textContent = label.toUpperCase();
      Object.assign(badge.style, {
        position: "fixed",
        left: `${Math.max(0, rect.left)}px`,
        top: `${Math.max(0, rect.top - 2)}px`,
        zIndex: "10000",
        padding: "0 4px",
        borderRadius: "3px",
        fontFamily: "var(--font-monospace)",
        fontSize: "12px",
        fontWeight: "700",
        lineHeight: "16px",
        background: "var(--text-accent)",
        color: "var(--background-primary)",
        pointerEvents: "none",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
      });
      document.body.appendChild(badge);
      return { el, label, badge };
    });
    const onScroll = () => this.cancelHints();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    this.hintSession = { view, hints, typed: "", scroller, onScroll };
    this.updateModeIndicator();
  }

  handleHintKey(event, view) {
    const session = this.hintSession;
    if (!view || view !== session.view || view.getMode() === "source") {
      this.cancelHints();
      return false;
    }
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return false;
    this.consumeKey(event);
    if (event.key === "Escape") {
      this.cancelHints();
      return true;
    }
    if (event.key === "Backspace") {
      session.typed = session.typed.slice(0, -1);
      this.refreshHints();
      return true;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return true;
    const key = keyFromEvent(event).toLowerCase();
    if (key.length !== 1 || !HINT_ALPHABET.includes(key)) return true;
    const typed = session.typed + key;
    const matches = session.hints.filter((hint) => hint.label.startsWith(typed));
    if (matches.length === 0) return true;
    session.typed = typed;
    if (matches.length === 1 && matches[0].label === typed) {
      this.activateHint(matches[0], event.shiftKey);
      return true;
    }
    this.refreshHints();
    return true;
  }

  refreshHints() {
    const session = this.hintSession;
    if (!session) return;
    for (const hint of session.hints) {
      const matches = hint.label.startsWith(session.typed);
      hint.badge.style.display = matches ? "" : "none";
      hint.badge.textContent = hint.label.slice(session.typed.length).toUpperCase();
    }
    this.updateModeIndicator();
  }

  activateHint(hint, newTab) {
    const view = this.hintSession?.view;
    const el = hint.el;
    this.cancelHints();
    try {
      const href = el.getAttribute("data-href");
      if (el.classList.contains("internal-link") && href && view?.file) {
        this.app.workspace.openLinkText(href, view.file.path, Boolean(newTab));
      } else {
        el.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          ctrlKey: Boolean(newTab) && !Platform.isMacOS,
          metaKey: Boolean(newTab) && Platform.isMacOS,
        }));
      }
    } catch (error) {
      console.error("Fixy: could not open link", error);
      new Notice("Fixy could not open that link.");
    }
  }

  cancelHints() {
    const session = this.hintSession;
    if (!session) return;
    this.hintSession = null;
    session.scroller?.removeEventListener?.("scroll", session.onScroll);
    for (const hint of session.hints) hint.badge.remove();
    this.updateModeIndicator();
  }

  // ---------------------------------------------------------------------
  // Links: when a note is opened through [[note#heading]], a search result or
  // history navigation, Obsidian already knows where to go. That target must win
  // over the remembered position. Fixy notes such opens and skips its restore.
  // ---------------------------------------------------------------------
  setUpLinkAwareness() {
    this.explicitTargets = new Map();
    const workspace = this.app.workspace;

    const originalOpenLink = workspace.openLinkText;
    if (typeof originalOpenLink === "function") {
      const hadOwn = Object.prototype.hasOwnProperty.call(workspace, "openLinkText");
      const patched = (linktext, sourcePath, ...rest) => {
        try {
          const text = String(linktext ?? "");
          const hash = text.indexOf("#");
          if (hash >= 0) {
            const linkpath = text.slice(0, hash);
            const dest = linkpath
              ? this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath || "")
              : this.app.workspace.getActiveFile();
            if (dest?.path) this.explicitTargets.set(dest.path, Date.now());
          }
        } catch (error) {
          console.error("Fixy: could not inspect link", error);
        }
        return originalOpenLink.call(workspace, linktext, sourcePath, ...rest);
      };
      workspace.openLinkText = patched;
      this.register(() => {
        if (workspace.openLinkText !== patched) return;
        if (hadOwn) workspace.openLinkText = originalOpenLink;
        else delete workspace.openLinkText;
      });
    }

    // Search results, the quick switcher's heading search and back/forward
    // navigation open files through the leaf with an explicit target state.
    this.app.workspace.onLayoutReady(() => {
      try {
        const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(false);
        const proto = leaf && Object.getPrototypeOf(leaf);
        const originalOpenFile = proto?.openFile;
        if (typeof originalOpenFile !== "function") return;
        const hadOwn = Object.prototype.hasOwnProperty.call(proto, "openFile");
        const patched = function (file, openState, ...rest) {
          try {
            const state = openState?.eState;
            if (
              file?.path && state &&
              ((typeof state.subpath === "string" && state.subpath) ||
                Number.isFinite(state.line) ||
                state.match != null ||
                Number.isFinite(state.scroll))
            ) {
              plugin.explicitTargets.set(file.path, Date.now());
            }
          } catch (error) {
            console.error("Fixy: could not inspect navigation", error);
          }
          return originalOpenFile.call(this, file, openState, ...rest);
        };
        const plugin = this;
        proto.openFile = patched;
        this.register(() => {
          if (proto.openFile !== patched) return;
          if (hadOwn) proto.openFile = originalOpenFile;
          else delete proto.openFile;
        });
      } catch (error) {
        console.error("Fixy: link awareness unavailable", error);
      }
    });
  }

  hasExplicitTarget(path) {
    const stamp = this.explicitTargets?.get(path);
    if (stamp === undefined) return false;
    if (Date.now() - stamp < 4000) return true;
    this.explicitTargets.delete(path);
    return false;
  }

  // ---------------------------------------------------------------------
  // Status bar: NORMAL (Reading mode) or INSERT (Editing mode) while Vim
  // navigation is on.
  // ---------------------------------------------------------------------
  setUpModeIndicator() {
    this.modeIndicatorEl = this.addStatusBarItem();
    this.modeIndicatorEl.style.display = "none";
    const refresh = () => this.updateModeIndicator();
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerInterval(window.setInterval(refresh, 400));
    refresh();
  }

  updateModeIndicator() {
    const el = this.modeIndicatorEl;
    if (!el) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (this.hintSession && (view !== this.hintSession.view || view?.getMode() === "source")) {
      this.cancelHints();
      return;
    }
    if (!this.settings.enableVimBindings || !this.settings.showModeIndicator || !view) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    const insert = view.getMode() === "source";
    const hinting = Boolean(this.hintSession);
    const label = hinting
      ? `HINT ${this.hintSession.typed.toUpperCase()}`.trim()
      : insert ? "INSERT" : `NORMAL${this.vimPendingKey ? ` ${this.vimPendingKey}` : ""}`;
    if (el.style.display === "none") el.style.display = "";
    if (el.textContent !== label) el.textContent = label;
    el.style.fontWeight = "600";
    el.style.color = hinting ? "var(--color-orange)" : insert ? "var(--color-green)" : "var(--text-accent)";
  }

  // ---------------------------------------------------------------------
  // Resume position: remember the cursor line per note and jump back to it
  // the next time the note is opened. Positions live in the plugin's
  // data.json, never inside the note itself.
  // ---------------------------------------------------------------------
  setUpResumePosition() {
    this.restoringPath = null;
    this.restoreSequence = 0;
    this.scrollTrackedViews = new WeakSet();
    // Last good position per view, so a Reading <-> Editing switch can carry it over.
    this.viewModes = new WeakMap();
    // Use trailing debounce so the latest cursor position is persisted after
    // the user stops moving, rather than only saving the first sampled change.
    this.saveSoon = debounce(() => this.saveSettings(), 3000);
    this.savePositionsSoon = debounce(() => this.savePositions(), 3000);
    // The vault index may not be populated when the plugin loads. Checking
    // immediately can mistake every saved path for a deleted file.
    this.app.workspace.onLayoutReady(() => this.removePositionsForMissingFiles());

    this.registerEvent(this.app.workspace.on("file-open", (file) => this.restorePosition(file)));
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.editor === editor) this.rememberPosition(view);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const file = leaf?.view instanceof MarkdownView ? leaf.view.file : null;
        // lastActiveView can be a PDF/graph/canvas view; only Markdown views have positions.
        if (this.lastActiveView instanceof MarkdownView) this.rememberPosition(this.lastActiveView);
        this.lastActiveView = leaf?.view instanceof MarkdownView ? leaf.view : null;
        this.trackViewScroll(leaf?.view);
        if (file && file.path !== this.restoringPath) this.restorePosition(file);
      }),
    );
    this.registerEvent(this.app.workspace.on("quit", () => this.flushPosition()));
    // Phones kill background apps without a "quit": save as soon as the app is hidden.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushPosition();
    });
    this.registerDomEvent(window, "pagehide", () => this.flushPosition());
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const positions = this.settings.positions;
        if (positions[oldPath]) {
          positions[file.path] = positions[oldPath];
          delete positions[oldPath];
          this.savePositionsSoon();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.settings.positions[file.path]) {
          delete this.settings.positions[file.path];
          this.savePositionsSoon();
        }
      }),
    );

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.trackViewScroll(activeView);
    // Obsidian does not expose one consistent mode-change event, so sample
    // cheaply and restore again when a note switches between Source/Reading.
    this.registerInterval(window.setInterval(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      this.trackViewScroll(view);
      this.rememberPosition(view);
    }, Platform.isMobile ? 1000 : 400));
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.rememberPosition(this.app.workspace.getActiveViewOfType(MarkdownView));
      }),
    );
  }

  trackViewScroll(view) {
    if (!(view instanceof MarkdownView) || this.scrollTrackedViews.has(view)) return;
    this.scrollTrackedViews.add(view);
    this.registerDomEvent(view.containerEl, "scroll", () => this.rememberPosition(view), true);
  }

  getPreviewScroller(view) {
    const root = view?.containerEl;
    const candidates = [
      root?.querySelector?.(".view-content"),
      root?.querySelector?.(".markdown-reading-view"),
      root?.querySelector?.(".markdown-preview-view"),
      view?.previewMode?.containerEl,
      root,
    ].filter(Boolean);
    const overflowing = (element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1;
    const cssScrollable = candidates.find((element) => {
      if (!overflowing(element)) return false;
      try {
        const overflowY = window.getComputedStyle(element).overflowY;
        return overflowY === "auto" || overflowY === "scroll";
      } catch {
        return false;
      }
    });
    return cssScrollable || candidates.find(overflowing) || candidates.find((element) => element.clientHeight > 0) || null;
  }

  rememberPosition(view = this.app.workspace.getActiveViewOfType(MarkdownView)) {
    if (!this.trackingPositions() || !(view instanceof MarkdownView) || !view.file) return;
    const path = view.file.path;
    if (path === this.restoringPath) return;
    const mode = view.getMode() === "source" ? "source" : "preview";
    const reading = view.currentMode?.getScroll?.();
    const scroll = Number.isFinite(reading) ? Number(reading.toFixed(4)) : undefined;
    let cursor;
    if (mode === "source" && view.editor) {
      const from = view.editor.getCursor("anchor");
      const to = view.editor.getCursor("head");
      cursor = { from: { line: from.line, ch: from.ch }, to: { line: to.line, ch: to.ch } };
    }

    // Reading <-> Editing switch: do NOT save what the new mode happens to show
    // (often the top or the end). Carry the position the user was just at.
    const tracked = this.viewModes.get(view);
    const sameNote = tracked?.path === path;
    if (sameNote && tracked.mode !== mode) {
      this.viewModes.set(view, { ...tracked, mode });
      this.carryAcrossModes(view, tracked);
      return;
    }
    if (scroll === undefined) return;
    this.viewModes.set(view, { path, mode, scroll, cursor: cursor ?? (sameNote ? tracked.cursor : undefined) });

    const positions = this.settings.positions;
    const previous = positions[path] || {};
    const modePositions = { ...previous.modePositions };
    const previousMode = modePositions[mode];
    this.lastActiveView = view;
    if (previousMode?.scroll === scroll && JSON.stringify(previousMode?.cursor ?? null) === JSON.stringify(cursor ?? null)) return;

    const at = Date.now();
    modePositions[mode] = { ...previousMode, scroll, ...(cursor ? { cursor } : {}), at };
    positions[path] = { ...previous, scroll, at, modePositions };
    this.pruneOldPositions();
    this.savePositionsSoon();
  }

  pruneOldPositions() {
    const entries = Object.entries(this.settings.positions);
    if (entries.length <= this.settings.maxRememberedFiles) return;
    entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    this.settings.positions = Object.fromEntries(entries.slice(0, this.settings.maxRememberedFiles));
  }

  removePositionsForMissingFiles() {
    const currentFiles = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    const positions = this.settings.positions;
    let changed = false;

    for (const path of Object.keys(positions)) {
      if (!currentFiles.has(path)) {
        delete positions[path];
        changed = true;
      }
    }

    const beforeCount = Object.keys(positions).length;
    this.pruneOldPositions();
    if (changed || Object.keys(positions).length !== beforeCount) this.savePositions();
  }

  restorePosition(file) {
    if (file?.path && file.path === this.restoringPath) return;
    const sequence = ++this.restoreSequence;
    this.restoringPath = null;
    // A heading/block link or search result carries its own target, which wins.
    if (!this.trackingPositions() || !file || file.extension !== "md" || this.hasExplicitTarget(file.path)) return;
    const saved = this.settings.positions[file.path];
    if (!saved) return;

    this.restoringPath = file.path;
    const finish = () => {
      if (this.restoringPath === file.path && sequence === this.restoreSequence) this.restoringPath = null;
    };
    const restore = (attempt) => {
      if (sequence !== this.restoreSequence || this.restoringPath !== file.path) return;
      let restored = false;
      try {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        // The leaf can change before the matching view is active: keep waiting for it.
        if (view?.file?.path === file.path) {
          this.trackViewScroll(view);
          const mode = view.getMode() === "source" ? "source" : "preview";
          const entry = saved.modePositions?.[mode];
          const scroll = entry?.scroll ?? saved.scroll;
          const editor = mode === "source" ? view.editor : null;
          const range = editor && entry?.cursor?.from && entry.cursor.to
            ? { from: clampToEditor(editor, entry.cursor.from), to: clampToEditor(editor, entry.cursor.to) }
            : null;
          if (range) editor.setSelection(range.from, range.to);
          if (Number.isFinite(scroll)) {
            view.setEphemeralState({ scroll, ...(range ? { cursor: range } : {}) });
            if (range) editor.scrollIntoView(range, true);
            restored = true;
          }
        }
      } catch {
        // Obsidian may still be building the editor or preview DOM.
      }
      if (restored || attempt >= 30) finish();
      else window.setTimeout(() => restore(attempt + 1), 250);
    };
    window.setTimeout(() => restore(0), 150);
  }

  // Keep the reader where they were when the note switches between Reading and
  // Editing. Reading has no cursor, so entering Editing puts it on the first
  // visible line; leaving Editing keeps the scroll and the cursor as they were.
  carryAcrossModes(view, from) {
    const file = view.file;
    if (!this.trackingPositions() || !file || !Number.isFinite(from.scroll)) return;
    const sequence = ++this.restoreSequence;
    this.restoringPath = file.path;

    const finish = () => {
      if (this.restoringPath === file.path && sequence === this.restoreSequence) this.restoringPath = null;
      const active = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.file?.path === file.path) {
        this.viewModes.set(active, {
          path: file.path,
          mode: active.getMode() === "source" ? "source" : "preview",
          scroll: from.scroll,
          cursor: from.cursor,
        });
        this.rememberPosition(active);
      }
    };

    const step = (attempt) => {
      if (sequence !== this.restoreSequence || this.restoringPath !== file.path) return;
      let done = false;
      try {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active?.file?.path === file.path) {
          if (active.getMode() === "source" && active.editor) {
            active.editor.setCursor(clampToEditor(active.editor, from.cursor?.to ?? { line: Math.floor(from.scroll), ch: 0 }));
          }
          active.setEphemeralState({ scroll: from.scroll });
          const now = active.currentMode?.getScroll?.();
          done = !Number.isFinite(now) || Math.abs(now - from.scroll) <= 2;
        }
      } catch {
        // The new mode may still be building its DOM; try again.
      }
      if (done || attempt >= 12) finish();
      else window.setTimeout(() => step(attempt + 1), 120);
    };
    window.setTimeout(() => step(0), 60);
  }

  flushPosition() {
    if (!this.settings) return;
    this.rememberPosition();
    this.savePositions();
  }

  // data.json holds settings only. Positions change constantly, so syncing them (Syncthing,
  // Obsidian Sync, ...) between a desktop and a phone creates endless conflicts. They live in
  // this device's local storage instead.
  async saveSettings() {
    const settings = { ...this.settings };
    delete settings.positions;
    await this.saveData(settings);
  }

  trackingPositions() {
    return Boolean(this.settings?.resumePosition);
  }

  // Each device (desktop, phone, tablet) keeps its own positions in its own local storage,
  // which lives outside the vault, so sync tools never see it.
  positionsStorageKey() {
    return `fixy-positions:${this.app.appId ?? this.app.vault.getName?.() ?? ""}`;
  }

  loadPositions() {
    try {
      const raw = typeof this.app.loadLocalStorage === "function"
        ? this.app.loadLocalStorage("fixy-positions")
        : window.localStorage.getItem(this.positionsStorageKey());
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.error("Fixy: could not read saved positions", error);
      return {};
    }
  }

  savePositions() {
    if (!this.settings) return;
    try {
      const raw = JSON.stringify(this.settings.positions);
      if (typeof this.app.saveLocalStorage === "function") this.app.saveLocalStorage("fixy-positions", raw);
      else window.localStorage.setItem(this.positionsStorageKey(), raw);
    } catch (error) {
      console.error("Fixy: could not save positions", error);
    }
  }

  // Read this device's positions. On desktop, adopt any left in data.json by older versions and
  // drop them from that file. A phone or tablet starts with its own empty set and never
  // writes the shared data.json at start-up.
  async migratePositions(storedPositions) {
    if (Platform.isMobile) {
      this.settings.positions = this.loadPositions();
      return;
    }
    const merged = this.loadPositions();
    const legacy = storedPositions && typeof storedPositions === "object" ? storedPositions : {};
    for (const [path, entry] of Object.entries(legacy)) {
      if (!merged[path] || (entry?.at || 0) > (merged[path]?.at || 0)) merged[path] = entry;
    }
    this.settings.positions = merged;
    if (Object.keys(legacy).length > 0) {
      this.savePositions();
      await this.saveSettings();
    }
  }

  beginShortcutCapture(input, button) {
    this.cancelShortcutCapture();
    this.shortcutCapture = { input, button };
    button.setButtonText("Press shortcut…");
  }

  cancelShortcutCapture() {
    if (!this.shortcutCapture) return;
    this.shortcutCapture.button.setButtonText("Record shortcut");
    this.shortcutCapture = null;
  }

  async handleShortcut(event) {
    if (this.shortcutCapture) {
      if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const { input, button } = this.shortcutCapture;
      this.shortcutCapture = null;
      button.setButtonText("Record shortcut");

      if (event.key === "Escape") {
        new Notice("Shortcut recording cancelled.");
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        this.settings.shortcut = "";
        input.setValue("");
        await this.saveSettings();
        new Notice("Custom shortcut cleared.");
        return;
      }

      const shortcut = shortcutFromEvent(event);
      if (!shortcut) {
        new Notice("Use a shortcut with Ctrl, Cmd, or Alt plus a key.");
        return;
      }

      this.settings.shortcut = shortcut;
      input.setValue(shortcut);
      await this.saveSettings();
      new Notice(`Shortcut set to ${shortcut}.`);
      return;
    }

    if (this.settings.enableVimBindings) {
      try {
        if (this.handleVimKey(event)) return;
      } catch (error) {
        console.error("Fixy: Vim key handling failed", error);
      }
    }
    if (!matchesShortcut(event, this.settings.shortcut)) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.convertMarkdown(view.editor);
  }

  // Normal mode is simply "this note is in Reading mode". Deriving it from the
  // view (instead of a separate flag) means the mode button, Obsidian's own
  // commands and Fixy's keys can never leave the plugin out of sync.
  handleVimKey(event) {
    if (event.isComposing || event.defaultPrevented) return false;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || this.isTypingOutsideEditor(event)) return false;
    if (this.hintSession) return this.handleHintKey(event, view);

    if (view.getMode() === "source") {
      const plainEscape =
        event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      // Escape also closes link suggestions, menus and modals: let those win.
      if (!plainEscape || this.hasOpenPopup()) return false;
      this.vimPendingKey = "";
      this.consumeKey(event);
      this.enterReadingMode();
      return true;
    }

    if (event.key === "Escape") {
      this.vimPendingKey = "";
      this.awaitingMarkerName = false;
      this.updateModeIndicator();
      return false;
    }

    if (this.awaitingMarkerName) {
      // Shift is pressed before a capital letter: keep waiting for the name.
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return false;
      this.awaitingMarkerName = false;
      this.vimPendingKey = "";
      if (event.key !== "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const name = keyFromEvent(event);
        if (name.length === 1) {
          this.consumeKey(event);
          // '' is Vim's "back to the previous position".
          if (name === "'") this.jumpHistory(view, -1);
          else this.jumpToNamedMarker(view, name);
          this.updateModeIndicator();
          return true;
        }
      }
      this.updateModeIndicator();
      return false;
    }

    if (this.vimMatches(event, "insert") || this.vimMatches(event, "append")) {
      const append = this.vimMatches(event, "append");
      this.vimPendingKey = "";
      this.consumeKey(event);
      this.enterSourceMode(append);
      return true;
    }

    const prefixActions = [
      ["top", () => this.moveToDocumentEdge(view, false)],
      ["nextHeading", () => this.jumpToHeading(view, 1)],
      ["prevHeading", () => this.jumpToHeading(view, -1)],
    ];
    for (const [action, run] of prefixActions) {
      if (!this.vimMatchesPrefix(event, action)) continue;
      this.consumeKey(event);
      const prefix = this.settings.vimBindings[action][0];
      if (this.vimPendingKey === prefix) {
        this.vimPendingKey = "";
        run();
      } else {
        this.vimPendingKey = prefix;
        window.setTimeout(() => {
          if (this.vimPendingKey === prefix) this.vimPendingKey = "";
          this.updateModeIndicator();
        }, 800);
      }
      this.updateModeIndicator();
      return true;
    }

    const actions = [
      ["pageDown", () => this.scrollPreview(view, true, false, 0.8)],
      ["pageUp", () => this.scrollPreview(view, false, false, 0.8)],
      ["search", () => this.executeVimCommand(["editor:open-search", "global-search:open"], "open search")],
      ["bottom", () => this.moveToDocumentEdge(view, true)],
      ["close", () => this.executeVimCommand(["workspace:close", "file:close"], "close the current tab")],
      ["closeAlt", () => this.executeVimCommand(["workspace:close", "file:close"], "close the current tab")],
      ["commandPalette", () => this.executeVimCommand("app:open-command-palette", "open the command palette")],
      ["rename", () => this.executeVimCommand(["file-rename", "file:rename", "markdown:rename-file"], "rename the current note")],
      ["newTab", () => this.openNewNoteInInsertMode()],
      ["settings", () => this.executeVimCommand("app:open-settings", "open Settings")],
      ["sidebar", () => this.executeVimCommand(["app:toggle-left-sidebar", "workspace:toggle-left-sidebar"], "toggle the left sidebar")],
      ["fileSwitcher", () => this.executeVimCommand("switcher:open", "open the file switcher")],
      ["nextMarker", () => this.jumpToMarker(view, 1)],
      ["prevMarker", () => this.jumpToMarker(view, -1)],
      ["markerList", () => this.openMarkerList(view)],
      ["headingList", () => this.openHeadingList(view)],
      ["jumpBack", () => this.jumpHistory(view, -1)],
      ["jumpForward", () => this.jumpHistory(view, 1)],
      ["markerJump", () => {
        const token = Symbol("marker");
        this.awaitingMarkerName = token;
        this.vimPendingKey = this.settings.vimBindings.markerJump;
        window.setTimeout(() => {
          if (this.awaitingMarkerName !== token) return;
          this.awaitingMarkerName = false;
          this.vimPendingKey = "";
          this.updateModeIndicator();
        }, 1500);
      }],
      ["linkHints", () => this.startLinkHints(view)],
      ["up", () => this.scrollPreview(view, false, false, this.settings.vimMoveLines / 10)],
      ["down", () => this.scrollPreview(view, true, false, this.settings.vimMoveLines / 10)],
    ];
    for (const [action, run] of actions) {
      if (!this.vimMatches(event, action)) continue;
      this.vimPendingKey = "";
      this.consumeKey(event);
      run();
      return true;
    }

    // Unbound keys (and every Ctrl/Cmd/Alt shortcut such as copy) pass through untouched.
    this.vimPendingKey = "";
    return false;
  }

  consumeKey(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  isTypingOutsideEditor(event) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return false;
    if (target.closest("input, textarea, select")) return true;
    // Inline title, Properties fields and similar contenteditable widgets; the
    // note editor itself (.cm-content) is the one editable area Vim keys apply to.
    const editable = target.closest("[contenteditable='true'], [contenteditable='plaintext-only']");
    return Boolean(editable && !editable.classList.contains("cm-content"));
  }

  hasOpenPopup() {
    return Boolean(document.querySelector(".modal-container, .suggestion-container, .menu, .prompt"));
  }

  executeVimCommand(commandId, action) {
    try {
      if (action === "rename the current note") {
        const file = this.app.workspace.getActiveFile?.();
        const promptRename = this.app.fileManager?.promptForFileRename;
        if (file && typeof promptRename === "function") {
          promptRename.call(this.app.fileManager, file);
          return;
        }
      }
      const execute = this.app.commands?.executeCommandById;
      if (typeof execute !== "function") {
        new Notice(`Fixy could not ${action}. Use the command palette.`);
        return;
      }
      const commandIds = Array.isArray(commandId) ? commandId : [commandId];
      const available = commandIds.find((id) => this.app.commands.commands?.[id]);
      if (!available) {
        new Notice(`Fixy could not ${action}. Use the command palette.`);
        return;
      }
      execute.call(this.app.commands, available);
    } catch (error) {
      console.error(`Fixy: could not ${action}`, error);
      new Notice(`Fixy could not ${action}. Use the command palette.`);
    }

  }

  openNewNoteInInsertMode() {
    try {
      const execute = this.app.commands?.executeCommandById;
      const available = ["file:new", "workspace:new-tab", "file-new"]
        .find((id) => this.app.commands.commands?.[id]);
      if (typeof execute !== "function" || !available) {
        new Notice("Fixy could not open a new note. Use the command palette.");
        return;
      }
      execute.call(this.app.commands, available);
      window.setTimeout(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.getMode() !== "source") this.enterSourceMode();
      }, 100);
    } catch (error) {
      console.error("Fixy: could not open a new note", error);
      new Notice("Fixy could not open a new note. Use the command palette.");
    }
  }

  vimMatches(event, action) {
    const binding = this.settings.vimBindings[action];
    if (!isValidVimBinding(binding)) return false;
    const wantsCtrl = binding.startsWith("Ctrl+");
    const key = wantsCtrl ? binding.slice(5) : binding;
    if (key.length !== 1) return false;
    return (
      keyFromEvent(event) === key &&
      event.ctrlKey === wantsCtrl &&
      !event.altKey &&
      !event.metaKey
    );
  }

  vimMatchesPrefix(event, action) {
    const binding = this.settings.vimBindings[action];
    return (
      isValidVimBinding(binding) &&
      binding.length === 2 &&
      !binding.includes("+") &&
      !event.ctrlKey && !event.altKey && !event.metaKey &&
      keyFromEvent(event) === binding[0]
    );
  }

  switchMarkdownMode(mode) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return false;
    if (view.getMode() === mode) return true;

    const commands = this.app.commands;
    if (typeof commands?.executeCommandById === "function" && commands.commands?.["markdown:toggle-preview"]) {
      if (commands.executeCommandById("markdown:toggle-preview")) return true;
    }
    // Fallback: merge into the existing state. Replacing it wholesale would
    // drop the file and leave an empty tab.
    const leaf = view.leaf;
    if (!leaf?.getViewState || !leaf?.setViewState) return false;
    const state = leaf.getViewState();
    leaf.setViewState({ ...state, state: { ...state.state, mode } });
    return true;
  }

  enterSourceMode(append = false) {
    try {
      if (!this.switchMarkdownMode("source")) return false;

      window.setTimeout(() => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.getMode() !== "source") return;
        activeView.editor.focus();
        if (append) {
          const cursor = activeView.editor.getCursor();
          this.placeCursor(activeView.editor, cursor.line, cursor.ch + 1);
        }
      }, 100);
      return true;
    } catch (error) {
      console.error("Fixy: could not enter source mode", error);
      new Notice("Fixy could not enter edit mode. Use Obsidian's edit-mode command.");
      return false;
    }
  }

  enterReadingMode() {
    try {
      if (!this.switchMarkdownMode("preview")) return false;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return true;
    } catch (error) {
      console.error("Fixy: could not enter reading mode", error);
      new Notice("Fixy could not enter reading mode. Use Obsidian's preview-mode command.");
      return false;
    }
  }

  moveToDocumentEdge(view, bottom) {
    if (view.file && view.getMode() !== "source") {
      const lastLine = typeof view.data === "string" ? view.data.split("\n").length - 1 : null;
      this.recordJump(view, bottom ? lastLine : 0);
    }
    if (view.getMode() === "source") {
      this.placeCursor(view.editor, bottom ? view.editor.lastLine() : 0, 0);
    } else {
      this.scrollPreview(view, bottom, true);
    }
  }

  scrollPreview(view, down, edge = false, pageRatio = 0.35) {
    const preview = this.getPreviewScroller(view);
    if (!preview) return;
    if (edge) {
      preview.scrollTop = down ? preview.scrollHeight : 0;
    } else {
      preview.scrollTop += (down ? 1 : -1) * preview.clientHeight * pageRatio;
    }
  }

  placeCursor(editor, line, ch) {
    const target = Math.max(0, Math.min(editor.lastLine(), line));
    editor.setCursor({ line: target, ch: Math.max(0, Math.min(editor.getLine(target).length, ch)) });
    editor.scrollIntoView({ from: editor.getCursor(), to: editor.getCursor() }, true);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.editor === editor) this.rememberPosition(view);
  }

  convertMarkdown(editor, options = {}) {
    const selection = editor.getSelection();
    const hasSelection = selection.length > 0;
    const original = hasSelection ? selection : editor.getValue();
    let result;
    try {
      result = convertNotebookLMMarkdown(original, this.settings, { selection: hasSelection });
    } catch (error) {
      console.error("Fixy: conversion failed", error);
      new Notice("Fixy hit an unexpected error. Nothing was changed. See the developer console for details.");
      return;
    }
    const warning = result.unbalancedDisplayMath
      ? " Warning: an unmatched $$ was found, so check the note's math."
      : "";
    const skipped = result.skippedMath
      ? ` ${result.skippedMath} ambiguous math span(s) were left unchanged: check them by hand.`
      : "";

    if (result.text === original) {
      new Notice(`Fixy: no changes needed.${warning}${skipped}`);
      return;
    }

    // Safety guard: conversion may change Markdown/LaTeX punctuation, but it
    // must never silently remove or reorder the note's actual words/numbers.
    // If the content check fails, leave the editor untouched.
    if (!preservesDocumentContent(original, result.text, this.settings)) {
      const mismatch = findContentMismatch(original, result.text, this.settings);
      console.warn("Fixy: content check failed", mismatch);
      new Notice("Fixy stopped: this conversion might remove content. Nothing was changed. Details are in the developer console.");
      return;
    }

    const apply = () => {
      if (hasSelection) {
        editor.replaceSelection(result.text);
      } else {
        // Replace only the changed span so scroll position, folds and the cursor survive.
        applyMinimalEdit(editor, original, result.text);
      }
      new Notice(summarizeResult(result) + warning + skipped + (result.uncertainMath ? ` ${result.uncertainMath} uncertain item(s) marked for review.` : ""));
    };

    if (options.preview ?? this.settings.previewBeforeConvert) {
      new ConversionPreviewModal(this.app, original, result.text, summarizeResult(result) + warning + skipped, () => {
        const unchanged = hasSelection ? editor.getSelection() === original : editor.getValue() === original;
        if (!unchanged) {
          new Notice("Fixy: the note changed while the preview was open. Nothing was applied; run the conversion again.");
          return;
        }
        apply();
      }).open();
      return;
    }
    apply();
  }

  // Optional (off by default): clean NotebookLM text as it is pasted.
  handlePaste(event, editor) {
    if (!this.settings.convertOnPaste || event.defaultPrevented) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text || text.length > 200000 || this.isPasteTargetProtected(editor)) return;
    let result;
    try {
      result = convertNotebookLMMarkdown(text, this.settings, { selection: true });
    } catch (error) {
      console.error("Fixy: paste conversion failed", error);
      return;
    }
    // Nothing to fix, or the safety check objects: let Obsidian paste normally.
    if (result.text === text || !preservesDocumentContent(text, result.text, this.settings)) return;

    event.preventDefault();
    const from = editor.getCursor("from");
    editor.replaceSelection(result.text);
    const to = editor.getCursor("to");

    const fragment = document.createDocumentFragment();
    fragment.append(`${summarizeResult(result)} `);
    const button = document.createElement("button");
    button.textContent = "Paste original instead";
    fragment.append(button);
    const notice = new Notice(fragment, 8000);
    button.addEventListener("click", () => {
      if (editor.getRange(from, to) !== result.text) {
        new Notice("Fixy: the text changed since the paste, so it was left alone.");
        return;
      }
      editor.replaceRange(text, from, to);
      notice.hide();
    });
  }

  // No paste conversion inside frontmatter, code blocks or display math.
  isPasteTargetProtected(editor) {
    const cursorLine = editor.getCursor("from").line;
    let frontmatter = false;
    let fence = null;
    let displayFences = 0;
    for (let index = 0; index <= cursorLine; index += 1) {
      const line = editor.getLine(index) ?? "";
      if (index === 0 && /^---[ \t]*$/.test(line)) { frontmatter = true; continue; }
      if (frontmatter) {
        if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) frontmatter = false;
        continue;
      }
      if (index === cursorLine) break;
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) { fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]; continue; }
      if (!fence) displayFences += (line.match(/\$\$/g) || []).length;
    }
    return frontmatter || fence !== null || displayFences % 2 === 1;
  }

  openMathCheck(view) {
    const text = typeof view.data === "string" ? view.data : view.editor?.getValue?.() ?? "";
    const issues = checkMath(text);
    if (issues.length === 0) {
      new Notice("Fixy: no math problems found.");
      return;
    }
    new PickerModal(this.app, {
      items: issues,
      placeholder: `${issues.length} possible math problem${issues.length === 1 ? "" : "s"}: pick one to jump to it`,
      text: (issue) => `${issue.message} ${issue.snippet}`,
      render: renderIssueRow,
      onChoose: (issue) => this.jumpAfterPicker(view, issue.line),
    }).open();
  }
}

const SUMMARY_LABELS = [
  ["displayMath", "display math"],
  ["inlineMath", "inline math"],
  ["repairedMathDelimiters", "math delimiter fix", "math delimiter fixes"],
  ["snippetConversions", "snippet", "snippets"],
  ["repairedTables", "table"],
  ["normalizedTableSeparators", "table separator"],
  ["fixedMatrixRows", "matrix row"],
  ["convertedArrays", "array table"],
  ["promotedMatrices", "matrix display block"],
  ["repairedMatrixBlocks", "repaired matrix block"],
  ["wrappedMatrices", "unwrapped matrix", "unwrapped matrices"],
  ["spacedMathBlocks", "display-math spacing fix", "display-math spacing fixes"],
  ["normalizedCommands", "escaped TeX command"],
  ["unicodeConversions", "Unicode symbol"],
  ["citations", "citation marker"],
];

function summarizeResult(result) {
  const parts = [];
  for (const [key, singular, plural] of SUMMARY_LABELS) {
    const count = result[key];
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural || singular + "s"}`);
  }
  return parts.length > 0
    ? `Fixy: ${parts.join(", ")}.`
    : "Fixy: cleaned up spacing and formatting.";
}

// Keep a saved position inside the note, in case it was edited elsewhere since.
function clampToEditor(editor, position) {
  const line = Math.max(0, Math.min(editor.lastLine(), Math.round(position.line)));
  return { line, ch: Math.max(0, Math.min((editor.getLine(line) || "").length, Math.round(position.ch))) };
}

function applyMinimalEdit(editor, before, after) {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const replacement = after.slice(prefix, after.length - suffix);
  editor.replaceRange(
    replacement,
    editor.offsetToPos(prefix),
    editor.offsetToPos(before.length - suffix),
  );
}

function addToggleSetting(container, plugin, key, name, description) {
  new Setting(container)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings[key])
        .onChange(async (value) => {
          plugin.settings[key] = value;
          await plugin.saveSettings();
        }),
    );
}

class NotebookLMToObsidianSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide() {
    // A pending recording must not swallow the next keystroke after the tab closes.
    this.plugin.cancelShortcutCapture();
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Fixy").setHeading();
    containerEl.createEl("p", {
      text: "Convert NotebookLM and basic math into Obsidian-compatible Markdown and LaTeX.",
    });

    addToggleSetting(containerEl, this.plugin, "convertDisplayMath", "Convert display math", "Convert \\[ ... \\] and escaped variants to Obsidian $$ blocks.");
    addToggleSetting(containerEl, this.plugin, "convertInlineMath", "Convert inline math", "Convert \\( ... \\) and escaped variants to Obsidian $...$ math.");
    addToggleSetting(containerEl, this.plugin, "normalizeEscapedCommands", "Normalize escaped TeX commands", "Inside math, change double-escaped commands such as \\\\alpha to \\alpha. TeX line breaks are left alone.");
    addToggleSetting(containerEl, this.plugin, "fixAsteriskSubscripts", "Fix asterisk subscripts", "Inside math, change NotebookLM's X*k and ALE*{prior} to X_{prior}. Turn this off if your notes use X*k to mean multiplication, such as W*x.");
    addToggleSetting(containerEl, this.plugin, "convertUnicodeMath", "Convert Unicode symbols in math", "Inside math, change pasted symbols such as ≤, ×, α and x² into LaTeX (\\leq, \\times, \\alpha, x^2). Text inside \\text{} is left alone.");
    new Setting(containerEl)
      .setName("Citation markers")
      .setDesc("NotebookLM leaves markers like [1] or [2, 3] in the text. Keep them, remove them, or turn them into footnotes (only numbers that have a matching “[n] source text” line in the note). Reference lines at the start of a line are never removed.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("keep", "Keep")
          .addOption("strip", "Remove")
          .addOption("footnotes", "Footnotes")
          .setValue(this.plugin.settings.citationMode)
          .onChange(async (value) => {
            this.plugin.settings.citationMode = value;
            await this.plugin.saveSettings();
          }),
      );
    addToggleSetting(containerEl, this.plugin, "previewBeforeConvert", "Preview before converting", "Show every change in a review window first, with Apply and Cancel. The command “Fixy: Preview conversion before applying” always shows it. Off by default.");
    addToggleSetting(containerEl, this.plugin, "convertOnPaste", "Convert on paste", "Clean NotebookLM text as you paste it into a note. A notice offers “Paste original instead”. Not applied inside code blocks, frontmatter or display math. Off by default.");
    addToggleSetting(containerEl, this.plugin, "markUncertain", "Mark uncertain math", "Add an HTML marker beside equation-like lines Fixy did not confidently convert.");
    new Setting(containerEl)
      .setName("Enable Vim navigation")
      .setDesc("Opt in to Vim-style navigation for Reading mode. Press i/a for Insert mode, Escape to return to Reading mode, and use gg, G, j/k, ]] and [[ (headings), n and N (markers), 'a (jump to marker :a>), Ctrl+m (marker list), o (heading list), < and > (jump back and forward), F (link hints), b, s, f, /, q/x, :, r, t, and Ctrl+d/u. t opens a new note in Insert mode.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableVimBindings)
          .onChange(async (value) => {
            this.plugin.settings.enableVimBindings = value;
            this.plugin.vimPendingKey = "";
            await this.plugin.saveSettings();
            this.plugin.updateModeIndicator();
          }),
      );

    for (const [key, name, description] of [
      ["markerOpen", "Marker start", "A marker in your note looks like :> (jump with n and N) or :m> (named m, listed with Ctrl+m). This is the text before the name."],
      ["markerClose", "Marker end", "The text after the name. One to three characters, no spaces."],
    ]) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText((text) => {
          text.setValue(this.plugin.settings[key]);
          text.inputEl.addEventListener("change", async () => {
            const value = text.getValue().trim();
            if (!value || value.length > 3 || /\s/.test(value)) {
              new Notice("Fixy: a marker part must be 1 to 3 characters with no spaces.");
              text.setValue(this.plugin.settings[key]);
              return;
            }
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl)
      .setName("Show Vim mode in the status bar")
      .setDesc("Show NORMAL (Reading mode) or INSERT (Editing mode) while Vim navigation is on.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showModeIndicator)
          .onChange(async (value) => {
            this.plugin.settings.showModeIndicator = value;
            await this.plugin.saveSettings();
            this.plugin.updateModeIndicator();
          }),
      );

    new Setting(containerEl)
      .setName("Vim keybindings")
      .setDesc("View and customize the keys used by Vim Normal mode.")
      .addButton((button) =>
        button.setButtonText("Open keybinding editor")
          .onClick(() => new VimBindingModal(this.app, this.plugin).open()),
      );

    new Setting(containerEl)
      .setName("Vim j/k movement")
      .setDesc("Number of lines moved by j and k in Source mode. Reading mode scrolls proportionally. (1-50)")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.vimMoveLines));
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "50";
        text.inputEl.step = "1";
        text.onChange(async (value) => {
          this.plugin.settings.vimMoveLines = clampVimMoveLines(value);
          text.setValue(String(this.plugin.settings.vimMoveLines));
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Math snippets")
      .setDesc("Open the snippet dictionary to see and configure the words Fixy recognizes.")
      .addButton((button) =>
        button
          .setButtonText("Open snippet dictionary")
          .onClick(() => new MathSnippetModal(this.app, this.plugin).open()),
      );

    addToggleSetting(containerEl, this.plugin, "resumePosition", "Resume where I left off", "Remember separate scroll positions for Editing (Source) and Reading (Preview), plus the cursor in Source mode. Positions are kept separately on each device (desktop, phone, tablet), not in your notes and not in the synced plugin data, so Syncthing or Obsidian Sync never has to merge them. Each device remembers its own place.");

    let rememberedFilesSlider;
    let rememberedFilesInput;
    const setRememberedFiles = async (value) => {
      const count = clampRememberedFiles(value);
      this.plugin.settings.maxRememberedFiles = count;
      rememberedFilesSlider?.setValue(count);
      rememberedFilesInput?.setValue(String(count));
      this.plugin.pruneOldPositions();
      await this.plugin.saveSettings();
    };

    new Setting(containerEl)
      .setName("Remembered files")
      .setDesc(`Maximum number of Markdown files with saved cursor positions. Drag the slider or type a number. The oldest positions are removed first. (${MIN_REMEMBERED_FILES}-${MAX_REMEMBERED_FILES})`)
      .addSlider((slider) =>
        (rememberedFilesSlider = slider)
          .setLimits(MIN_REMEMBERED_FILES, MAX_REMEMBERED_FILES, 10)
          .setValue(this.plugin.settings.maxRememberedFiles)
          .onChange((value) => setRememberedFiles(value)))
      .addText((text) => {
        rememberedFilesInput = text;
        text.setValue(String(this.plugin.settings.maxRememberedFiles));
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_REMEMBERED_FILES);
        text.inputEl.max = String(MAX_REMEMBERED_FILES);
        text.inputEl.step = "1";
        text.onChange((value) => {
          if (value.trim() !== "") setRememberedFiles(value);
        });
      });

    let shortcutInput;
    new Setting(containerEl)
      .setName("Keyboard shortcut")
      .setDesc("Record a shortcut here. Use Ctrl, Cmd, or Alt with a key. Press Escape to cancel, or Backspace/Delete to clear it. Fixy listens before editor hotkeys.")
      .addText((text) => {
        shortcutInput = text;
        text
          .setValue(this.plugin.settings.shortcut)
          .setPlaceholder("Not set");
        text.inputEl.readOnly = true;
      })
      .addButton((button) =>
        button
          .setButtonText("Record shortcut")
          .onClick(() => this.plugin.beginShortcutCapture(shortcutInput, button)),
      );

    new Setting(containerEl)
      .setName("Run the converter")
      .setDesc("Use your shortcut or open the command palette and choose “Fixy: Convert NotebookLM Markdown to Obsidian”. With text selected, only the selection is converted; otherwise the whole open note is converted.");
  }
}

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A marker is "<open><name><close>", for example ":>" or ":m>". The name is
// optional, up to 20 letters, digits, "_" or "-".
function markerPattern(settings) {
  const open = settings.markerOpen || ":";
  const close = settings.markerClose || ">";
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeForRegExp(open)}([\\p{L}\\p{N}_-]{0,20})${escapeForRegExp(close)}`,
    "gu",
  );
}

// Markers inside frontmatter, fenced code and `inline code` do not count.
function findMarkers(text, settings) {
  const pattern = markerPattern(settings);
  const lines = String(text).split(/\r?\n/);
  let index = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
    if (end > 0) index = end + 1;
  }
  const markers = [];
  let fence = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const scanned = line.replace(/`[^`\n]*`/g, (code) => " ".repeat(code.length));
    const found = [...scanned.matchAll(pattern)];
    if (found.length === 0) continue;
    const rest = line.replace(pattern, "").replace(/\s+/g, " ").trim();
    for (const match of found) {
      markers.push({ line: index, name: match[1], text: rest || "(marker only)" });
    }
  }
  return markers;
}

// A line diff for the preview. Shared head and tail are trimmed first, so the
// table stays small even for long notes; very large changes fall back to counts.
function buildDiffHunks(before, after, context = 1) {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if ((x.length + 1) * (y.length + 1) > 6000000) return { tooLarge: true, removed: x.length, added: y.length, hunks: [] };

  const width = y.length + 1;
  const table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = x[i] === y[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops = [];
  for (let k = 0; k < head; k += 1) ops.push({ t: " ", s: a[k], line: k });
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { ops.push({ t: " ", s: x[i], line: head + i }); i += 1; j += 1; }
    else if (j < y.length && (i === x.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { ops.push({ t: "+", s: y[j], line: head + i }); j += 1; }
    else { ops.push({ t: "-", s: x[i], line: head + i }); i += 1; }
  }
  for (let k = a.length - tail; k < a.length; k += 1) ops.push({ t: " ", s: a[k], line: k });

  const changed = ops.map((op, index) => (op.t === " " ? -1 : index)).filter((index) => index >= 0);
  const hunks = [];
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else hunks.push({ from, to });
  }
  return {
    tooLarge: false,
    hunks: hunks.map(({ from, to }) => ({ line: ops[from].line + 1, ops: ops.slice(from, to + 1) })),
  };
}

class ConversionPreviewModal extends Modal {
  constructor(app, before, after, summary, onApply) {
    super(app);
    this.before = before;
    this.after = after;
    this.summary = summary;
    this.onApply = onApply;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Review Fixy's changes");
    contentEl.createEl("p", { text: this.summary });

    const diff = buildDiffHunks(this.before, this.after);
    const box = contentEl.createDiv();
    box.style.maxHeight = "55vh";
    box.style.overflow = "auto";
    box.style.fontFamily = "var(--font-monospace)";
    box.style.fontSize = "12px";
    box.style.whiteSpace = "pre-wrap";
    box.style.border = "1px solid var(--background-modifier-border)";
    box.style.borderRadius = "6px";
    box.style.padding = "6px";

    if (diff.tooLarge) {
      box.createDiv({ text: `Too large to show line by line: about ${diff.removed} lines change into ${diff.added}. Apply to accept, or cancel to leave the note alone.` });
    } else {
      const shown = diff.hunks.slice(0, 200);
      for (const hunk of shown) {
        const head = box.createDiv({ text: `@@ line ${hunk.line} @@` });
        head.style.color = "var(--text-faint)";
        head.style.marginTop = "6px";
        for (const op of hunk.ops) {
          const row = box.createDiv({ text: `${op.t} ${op.s}` });
          if (op.t === "-") { row.style.background = "rgba(255, 80, 80, 0.18)"; }
          if (op.t === "+") { row.style.background = "rgba(80, 200, 120, 0.2)"; }
        }
      }
      if (diff.hunks.length > shown.length) {
        box.createDiv({ text: `… and ${diff.hunks.length - shown.length} more changed section(s).` });
      }
    }

    const buttons = contentEl.createDiv();
    buttons.style.display = "flex";
    buttons.style.justifyContent = "flex-end";
    buttons.style.gap = "8px";
    buttons.style.marginTop = "12px";
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const apply = buttons.createEl("button", { text: "Apply changes", cls: "mod-cta" });
    apply.addEventListener("click", () => {
      this.close();
      this.onApply();
    });
    apply.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Commands MathJax (as bundled with Obsidian) understands. Anything else is reported as a
// possible problem, never changed.
const MATHJAX_EXTRA_COMMANDS = (
  
  "omicron varpi varrho varsigma varkappa digamma coth injlim projlim varinjlim varprojlim varlimsup varliminf " +
  "coprod iiiint idotsint bigcup bigcap bigvee bigwedge bigoplus bigotimes bigodot biguplus bigsqcup " +
  "cap cup uplus sqcap sqcup smallsetminus wr diamond bigtriangleup bigtriangledown triangleleft triangleright lhd rhd " +
  "ominus oslash bigcirc dagger ddagger amalg barwedge veebar curlywedge curlyvee divideontimes ltimes rtimes " +
  "intercal circledast circledcirc circleddash boxplus boxminus boxtimes boxdot dotplus centerdot Cap Cup " +
  "lll ggg sqsubset sqsupset sqsubseteq sqsupseteq vdash dashv models mid nmid nparallel asymp doteq prec succ preceq succeq " +
  "precsim succsim lesssim gtrsim leqslant geqslant nleq ngeq nless ngtr lneq gneq approxeq thicksim thickapprox backsim " +
  "backsimeq eqcirc circeq triangleq bumpeq Bumpeq risingdotseq fallingdotseq subsetneq supsetneq subseteqq supseteqq " +
  "nsubseteq nsupseteq vDash Vdash Vvdash nvdash nvDash lesseqgtr gtreqless between pitchfork smile frown bowtie " +
  "longleftarrow Longleftarrow Longrightarrow Longleftrightarrow longleftrightarrow longmapsto uparrow downarrow updownarrow " +
  "Uparrow Downarrow Updownarrow nearrow searrow swarrow nwarrow hookleftarrow hookrightarrow leftharpoonup leftharpoondown " +
  "rightharpoonup rightharpoondown rightleftharpoons leadsto gets iff impliedby implies leftrightarrows rightleftarrows " +
  "leftleftarrows rightrightarrows twoheadrightarrow twoheadleftarrow rightsquigarrow nrightarrow nleftarrow nRightarrow " +
  "nLeftarrow curvearrowleft curvearrowright circlearrowleft circlearrowright xleftarrow xrightarrow dashrightarrow dashleftarrow " +
  "nexists lnot emptyset measuredangle sphericalangle triangledown square blacksquare blacktriangle blacklozenge lozenge " +
  "diamondsuit heartsuit clubsuit spadesuit flat natural sharp beth gimel daleth hslash wp imath jmath eth mho complement " +
  "backprime surd dag ddag copyright pounds yen circledR dotsb dotsc dotsi dotsm dotso Box Diamond " +
  "bigl Bigl biggl Biggl bigr Bigr biggr Biggr lbrace rbrace lbrack rbrack lgroup rgroup ulcorner urcorner llcorner lrcorner vert Vert backslash " +
  "check widecheck acute grave breve dddot ddddot mathring overrightarrow overleftarrow overleftrightarrow underrightarrow " +
  "underleftarrow underleftrightarrow overgroup undergroup mathscr mathfrak mathnormal pmb textsf texttt textnormal textup textmd " +
  "emph mbox hbox fbox rm bf it sf tt cal frak Bbb bold oldstyle mathop mathrel mathbin mathord mathopen mathclose mathpunct mathinner " +
  "scriptstyle scriptscriptstyle nolimits quad qquad enspace thinspace medspace thickspace negthinspace negmedspace negthickspace " +
  "hspace hskip kern mkern mskip phantom hphantom vphantom smash llap rlap clap mathstrut strut raise lower rule Rule " +
  "nonumber notag tag label eqref ref cfrac dbinom tbinom genfrac over atop choose brace brack root of substack sideset " +
  "bcancel xcancel cancelto color textcolor colorbox fcolorbox href class cssId style mathchoice hline cline hdashline cr newline " +
  "operatorname sin cos tan cot sec csc coth sgn rightleftharpoons"
);

// Built on first use: KNOWN_TEX_COMMANDS is declared further down the file.
let mathjaxCommands = null;
function getMathjaxCommands() {
  if (!mathjaxCommands) {
    mathjaxCommands = new Set([...KNOWN_TEX_COMMANDS, ...MATHJAX_EXTRA_COMMANDS.split(/\s+/).filter(Boolean)]);
  }
  return mathjaxCommands;
}


function stripTextGroups(span) {
  let output = "";
  let cursor = 0;
  const pattern = new RegExp(TEXT_MODE_GROUP.source, "g");
  let match;
  while ((match = pattern.exec(span)) !== null) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < span.length && depth > 0) {
      if (span[end] === "\\") end += 1;
      else if (span[end] === "{") depth += 1;
      else if (span[end] === "}") depth -= 1;
      end += 1;
    }
    output += `${span.slice(cursor, match.index)}T`;
    cursor = end;
    pattern.lastIndex = end;
  }
  return output + span.slice(cursor);
}

// Report things MathJax is likely to refuse. Nothing is ever changed.
function checkMath(text) {
  const issues = [];
  const source = String(text);
  // Blank out frontmatter, fenced code and `inline code` (same length, so offsets and lines still match).
  const blank = (value) => value.replace(/[^\n]/g, " ");
  let scan = source;
  const front = scan.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (front) scan = blank(front[0]) + scan.slice(front[0].length);
  scan = scan.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[`~]*[ \t]*(?=\n|$)|$)/gm, (m) => blank(m));
  scan = scan.replace(/`[^`\n]*`/g, (m) => blank(m));

  const lineStarts = [0];
  for (let i = 0; i < scan.length; i += 1) if (scan[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const add = (offset, message, snippet) => {
    issues.push({ line: lineOf(offset), message, snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 80) });
  };

  const tokens = tokenizeMath(scan);
  let outside = "";
  for (const token of tokens) {
    if (!token.math) { outside += token.raw; continue; }
    outside += blank(token.raw);
    const content = token.content ?? token.raw;
    const display = token.delimiter === "$$";
    if (!content.trim()) { add(token.start, "Empty math", token.raw); continue; }
    if (display && /\n[ \t]*\n/.test(content)) add(token.start, "Blank line inside display math", content);

    const plain = stripTextGroups(content).replace(/\\\\/g, "  ");
    const unescaped = plain.replace(/\\[{}]/g, "  ");
    const opens = (unescaped.match(/{/g) || []).length;
    const closes = (unescaped.match(/}/g) || []).length;
    if (opens !== closes) add(token.start, `Unbalanced braces ({ ${opens}, } ${closes})`, content);

    const lefts = (plain.match(/\\left(?![A-Za-z])/g) || []).length;
    const rights = (plain.match(/\\right(?![A-Za-z])/g) || []).length;
    if (lefts !== rights) add(token.start, `\\left and \\right do not match (${lefts} vs ${rights})`, content);

    const stack = [];
    for (const env of plain.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
      if (env[1] === "begin") stack.push(env[2]);
      else if (stack.pop() !== env[2]) { add(token.start, `\\end{${env[2]}} has no matching \\begin`, content); stack.length = 0; break; }
    }
    if (stack.length) add(token.start, `\\begin{${stack[stack.length - 1]}} is never closed`, content);

    const unknown = new Set();
    for (const command of plain.matchAll(/\\([A-Za-z]+)/g)) {
      if (!getMathjaxCommands().has(command[1]) && !["begin", "end"].includes(command[1])) unknown.add(command[1]);
    }
    if (unknown.size) add(token.start, `Unknown command${unknown.size > 1 ? "s" : ""}: ${[...unknown].map((c) => `\\${c}`).join(", ")}`, content);
  }

  // Display fences pair in order: an odd count leaves the last one open.
  const fences = [...outside.matchAll(/\$\$/g)];
  if (fences.length % 2 === 1) add(fences[fences.length - 1].index, "Unclosed $$ (display math never ends)", outside.slice(fences[fences.length - 1].index));

  // Leftover delimiters Fixy has not converted (citations like \[1\] are fine).
  for (const m of outside.matchAll(/\\{1,2}[([]/g)) {
    const after = outside.slice(m.index, m.index + 24);
    if (/^\\{1,2}\[\s*\d{1,3}\s*\\{0,2}\]/.test(after)) continue;
    add(m.index, "Unconverted \\( or \\[ delimiter: run Fixy's conversion", outside.slice(m.index));
  }

  // A lone $ next to LaTeX usually means a span that never closed. Currency has no commands.
  outside.split("\n").forEach((line, index) => {
    if (/(?<!\\)\$/.test(line) && /\\[A-Za-z]+|[_^]\{/.test(line)) {
      issues.push({ line: index, message: "Possible unclosed $ beside LaTeX", snippet: line.trim().slice(0, 80) });
    }
  });

  return issues.sort((x, y) => x.line - y.line);
}

// One searchable list serves the marker, heading and math-problem pickers.
class PickerModal extends FuzzySuggestModal {
  constructor(app, { items, placeholder, text, render, onChoose }) {
    super(app);
    Object.assign(this, { items, itemText: text, renderItem: render, onChoose });
    this.setPlaceholder(placeholder);
  }

  getItems() { return this.items; }
  getItemText(item) { return this.itemText(item); }
  renderSuggestion(match, el) { this.renderItem(match.item, el); }
  onChooseItem(item) { this.onChoose(item); }
}

const styled = (el, css) => {
  Object.assign(el.style, css);
  return el;
};

function renderMarkerRow(marker, el) {
  const row = styled(el.createDiv(), { display: "flex", gap: "10px", alignItems: "baseline" });
  styled(row.createSpan({ text: marker.name || "•" }), { fontFamily: "var(--font-monospace)", fontWeight: "700", color: "var(--text-accent)", minWidth: "2.5em" });
  styled(row.createSpan({ text: `L${marker.line + 1}` }), { color: "var(--text-faint)", fontSize: "var(--font-smaller)" });
  row.createSpan({ text: marker.text.length > 90 ? `${marker.text.slice(0, 89)}…` : marker.text });
}

function renderIssueRow(issue, el) {
  const row = el.createDiv();
  const head = row.createDiv();
  styled(head.createSpan({ text: `L${issue.line + 1}  ` }), { color: "var(--text-faint)", fontFamily: "var(--font-monospace)" });
  head.createSpan({ text: issue.message });
  styled(row.createDiv({ text: issue.snippet }), { color: "var(--text-muted)", fontFamily: "var(--font-monospace)", fontSize: "var(--font-smaller)" });
}

function renderHeadingRow(heading, el) {
  styled(el.createDiv({ text: heading.heading }), { paddingLeft: `${(heading.level - 1) * 14}px`, fontWeight: heading.level === 1 ? "700" : "" });
}

class VimBindingModal extends Modal {
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Vim keybindings" });
    contentEl.createEl("p", { text: "Edit the key for each Vim Normal-mode action. Use values such as j, gg, or Ctrl+d." });
    this.rowsEl = contentEl.createDiv();
    this.bindings = Object.assign({}, this.plugin.settings.vimBindings);
    this.renderRows();
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Restore defaults").onClick(async () => {
        this.bindings = Object.assign({}, DEFAULT_VIM_BINDINGS);
        this.renderRows();
        await this.save();
      }))
      .addButton((button) => button.setButtonText("Done").onClick(() => this.close()));
  }

  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  renderRows() {
    this.rowsEl.empty();
    for (const [action, key] of Object.entries(this.bindings)) {
      const clash = Object.entries(this.bindings).find(([other, bound]) => other !== action && bound === key);
      const setting = new Setting(this.rowsEl)
        .setName(action.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`))
        .setDesc(clash ? `Also used by “${clash[0]}” — the first matching action wins. Change one of them.` : BINDING_HINTS[action] ?? "");
      if (clash) setting.descEl.style.color = "var(--text-error)";
      setting.addText((text) => {
        text.setValue(key);
        // Commit on change (not on every keystroke) so "Ctrl+" never counts as a binding.
        text.inputEl.addEventListener("change", async () => {
          const value = text.getValue().trim();
          if (!isValidVimBinding(value)) {
            new Notice(`Fixy: "${value}" is not a valid key. Use one character (j), a doubled key (gg) or Ctrl+<character>.`);
            text.setValue(this.bindings[action]);
            return;
          }
          this.bindings[action] = value;
          await this.save();
          this.renderRows();
        });
      });
    }
  }

  async save() {
    this.plugin.settings.vimBindings = Object.assign({}, DEFAULT_VIM_BINDINGS, this.bindings);
    await this.plugin.saveSettings();
  }
}

class MathSnippetModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.snippets = parseSnippets(plugin.settings.snippets);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Math snippet dictionary" });
    contentEl.createEl("p", {
      text: "Type the word or shorthand in the first box and the LaTeX it should become in the second. Snippets are applied inside math and are saved automatically.",
    });

    this.rowsEl = contentEl.createDiv({ cls: "fixy-snippet-rows" });
    this.renderRows();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Add snippet")
          .setCta()
          .onClick(() => {
            this.snippets.push(["", ""]);
            this.renderRows();
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Restore defaults")
          .onClick(async () => {
            this.snippets = parseSnippets(DEFAULT_SETTINGS.snippets);
            this.renderRows();
            await this.save();
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Done")
          .onClick(() => this.close()),
      );
  }

  renderRows() {
    this.rowsEl.empty();
    if (this.snippets.length === 0) {
      this.rowsEl.createEl("p", { text: "No snippets configured." });
      return;
    }

    this.snippets.forEach(([from, to], index) => {
      const row = this.rowsEl.createDiv({ cls: "fixy-snippet-row" });
      const fromInput = row.createEl("input", {
        type: "text",
        placeholder: "shorthand, e.g. _alpha (the _ is added if missing)",
        value: from,
      });
      row.createSpan({ text: " → " });
      const toInput = row.createEl("input", {
        type: "text",
        placeholder: "LaTeX, e.g. \\alpha",
        value: to,
      });
      const remove = row.createEl("button", { text: "Remove" });

      fromInput.addEventListener("input", () => {
        this.snippets[index][0] = fromInput.value;
        this.save();
      });
      toInput.addEventListener("input", () => {
        this.snippets[index][1] = toInput.value;
        this.save();
      });
      remove.addEventListener("click", async () => {
        this.snippets.splice(index, 1);
        this.renderRows();
        await this.save();
      });
    });
  }

  async save() {
    this.plugin.settings.snippets = serializeSnippets(this.snippets);
    this.plugin.saveSoon();
  }

  async onClose() {
    this.plugin.settings.snippets = serializeSnippets(this.snippets);
    await this.plugin.saveSettings();
  }
}

// Letters on a non-Latin layout (Arabic, Russian, ...) arrive as non-ASCII
// characters, so Vim keys would never match. Fall back to the physical key.
function keyFromEvent(event) {
  const key = event.key;
  if (typeof key === "string" && key.length === 1 && key.charCodeAt(0) < 128) return key;
  const code = event.code || "";
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return event.shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = code.match(/^Digit(\d)$/);
  if (digit && !event.shiftKey) return digit[1];
  if (code === "Slash" && !event.shiftKey) return "/";
  if (code === "Semicolon" && event.shiftKey) return ":";
  if (code === "Quote") return event.shiftKey ? '"' : "'";
  if (code === "Comma") return event.shiftKey ? "<" : ",";
  if (code === "Period") return event.shiftKey ? ">" : ".";
  if (code === "BracketLeft") return event.shiftKey ? "{" : "[";
  if (code === "BracketRight") return event.shiftKey ? "}" : "]";
  return key;
}

// A binding is one character ("j"), a doubled key ("gg") or "Ctrl+" plus one character.
function isValidVimBinding(value) {
  if (typeof value !== "string") return false;
  return /^Ctrl\+\S$/.test(value) || /^\S$/.test(value) || /^(\S)\1$/.test(value);
}

function shortcutFromEvent(event) {
  const modifiers = [];
  const isPrimaryModifier = Platform.isMacOS ? event.metaKey : event.ctrlKey;
  if (isPrimaryModifier) modifiers.push("Mod");
  if (event.ctrlKey && (Platform.isMacOS || !isPrimaryModifier)) modifiers.push("Ctrl");
  if (event.metaKey && (!Platform.isMacOS || !isPrimaryModifier)) modifiers.push("Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");

  if (!modifiers.some((modifier) => ["Mod", "Ctrl", "Meta", "Alt"].includes(modifier))) {
    return "";
  }

  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

function matchesShortcut(event, shortcut) {
  if (!shortcut) return false;

  const parts = shortcut.split("+");
  const key = parts.pop();
  const wantsMod = parts.includes("Mod");
  const wantsCtrl = parts.includes("Ctrl") || (wantsMod && !Platform.isMacOS);
  const wantsMeta = parts.includes("Meta") || (wantsMod && Platform.isMacOS);
  const eventKey = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;

  return (
    eventKey === key &&
    event.ctrlKey === wantsCtrl &&
    event.metaKey === wantsMeta &&
    event.altKey === parts.includes("Alt") &&
    event.shiftKey === parts.includes("Shift")
  );
}

function contentFingerprint(text, settings = DEFAULT_SETTINGS) {
  const snippets = compileSnippets(settings);
  if (snippets) text = text.replace(snippets.regex, " ");
  // Both sides get the same Unicode mapping, so x² and x^2 compare equal.
  if (settings.convertUnicodeMath) text = unicodeToLatex(text, null);
  // Citation numbers are what the citation option removes or rewrites.
  if (settings.citationMode === "strip" || settings.citationMode === "footnotes") {
    text = text.replace(CITATION_ANY, " ");
  }
  return text
    .replace(/<!-- Fixy: uncertain -->/g, " ")
    // These are indentation artifacts, not document content.
    .replace(/(?:&#x20;|&#32;|&nbsp;)/gi, " ")
    // Array-to-table conversion removes the environment and its column spec.
    .replace(/\\begin\{array\}\s*\{[^}]*\}/g, " ")
    .replace(/\\end\{array\}/g, " ")
    // Command names (\text, \hline, ...) are markup, not words in the note.
    .replace(/\\[A-Za-z]+/g, " ")
    // Compare the ordered words/numbers, ignoring Markdown and math punctuation.
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function preservesDocumentContent(before, after, settings = DEFAULT_SETTINGS) {
  const left = contentFingerprint(before, settings);
  const right = contentFingerprint(after, settings);
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

// For diagnostics: where do the word/number sequences first diverge?
function findContentMismatch(before, after, settings = DEFAULT_SETTINGS) {
  const left = contentFingerprint(before, settings);
  const right = contentFingerprint(after, settings);
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return {
    index,
    before: left.slice(Math.max(0, index - 3), index + 4).join(" "),
    after: right.slice(Math.max(0, index - 3), index + 4).join(" "),
  };
}

function convertNotebookLMMarkdown(input, settings = DEFAULT_SETTINGS, options = {}) {
  settings = Object.assign({}, DEFAULT_SETTINGS, settings);
  const result = {
    text: "",
    displayMath: 0,
    inlineMath: 0,
    repairedMathDelimiters: 0,
    snippetConversions: 0,
    uncertainMath: 0,
    repairedTables: 0,
    normalizedTableSeparators: 0,
    fixedMatrixRows: 0,
    convertedArrays: 0,
    promotedMatrices: 0,
    repairedMatrixBlocks: 0,
    wrappedMatrices: 0,
    spacedMathBlocks: 0,
    normalizedCommands: 0,
    skippedMath: 0,
    citations: 0,
    unicodeConversions: 0,
    unbalancedDisplayMath: false,
  };

  let citationDefinitions = new Set();
  const convertText = (text) => {
    let converted = decodeIndentationEntities(text);

    converted = convertDelimiters(converted, settings, result);
    converted = handleCitations(converted, settings, result, citationDefinitions);
    converted = repairExcessClosingDollars(converted, result);
    converted = repairMatrixDisplayBlocks(converted, result);
    converted = normalizeExcessMathDelimiters(converted, result);
    converted = normalizeNotebookLMBareMath(converted, result, settings);
    converted = normalizeMathSpans(converted, settings, result);

    converted = convertLatexArraysToMarkdownTables(converted, result);
    converted = normalizeMatrixRowBreaks(converted, result);
    converted = promoteMultilineInlineMatrices(converted, result);
    converted = wrapBareMatrices(converted, result);
    // Matrices wrapped just now are new math spans; clean them like the rest so
    // a second run never finds more to change (the cleanup is idempotent).
    converted = normalizeMathSpans(converted, settings, result);
    converted = repairCompactMarkdownTables(converted, result);
    converted = normalizeMarkdownTableSeparators(converted, result);
    converted = ensureMarkdownTableSeparators(converted, result);
    converted = ensureBlankLinesAroundDisplayMath(converted, result);
    return converted;
  };

  // YAML frontmatter is not prose: never rewrite it.
  // A selection that starts with a horizontal rule is not frontmatter.
  const frontmatter = options.selection
    ? null
    : input.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  const head = frontmatter ? frontmatter[0] : "";
  if (settings.citationMode === "footnotes") citationDefinitions = collectCitationDefinitions(input.slice(head.length));
  result.text = head + transformOutsideMarkdownCode(input.slice(head.length), convertText);
  result.unbalancedDisplayMath = hasUnbalancedDisplayMath(result.text);
  return result;
}

// NotebookLM copy/paste sometimes leaves HTML space entities at the start
// of lines. Decode only indentation artifacts, not entities inside prose.
// True when a note has an odd number of $$ fences outside code, which usually
// means a block is open and the surrounding math will not render.
function hasUnbalancedDisplayMath(text) {
  let count = 0;
  transformOutsideMarkdownCode(text, (plain) => {
    for (const match of plain.matchAll(/\$\$/g)) {
      if (!isEscapedAt(plain, match.index)) count += 1;
    }
    return plain;
  });
  return count % 2 === 1;
}

function decodeIndentationEntities(text) {
  return text.replace(/^[ \t]*(?:(?:&#x20;|&#32;|&nbsp;)[ \t]*)+/gim, (prefix) => {
    const entities = (prefix.match(/(?:&#x20;|&#32;|&nbsp;)/gi) || []).length;
    const literalSpaces = (prefix.match(/[ \t]/g) || []).length;
    // Cap to three spaces so an indented equation is not accidentally turned
    // into a Markdown code block.
    return " ".repeat(Math.min(entities + literalSpaces, 3));
  });
}

// ---------------------------------------------------------------------------
// Math span detection
//
// A tolerant scanner that follows Obsidian's own rules: \$ is a literal dollar,
// $$...$$ may span lines, and $...$ must not touch whitespace on the inside,
// must not be followed by a digit, and cannot cross a blank line. A stray
// currency sign ("$5 and $10") therefore stays plain text instead of pairing
// with a later dollar and corrupting everything in between.
// ---------------------------------------------------------------------------
function isEscapedAt(text, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function readMathSpan(text, start) {
  if (text.startsWith("$$", start)) {
    let close = text.indexOf("$$", start + 2);
    while (close >= 0 && isEscapedAt(text, close)) close = text.indexOf("$$", close + 1);
    if (close < 0) return null;
    return { delimiter: "$$", content: text.slice(start + 2, close), end: close + 2 };
  }

  const next = text[start + 1];
  if (next === undefined || /\s/.test(next)) return null;

  const blankLine = /\n[ \t]*\n/g;
  blankLine.lastIndex = start + 1;
  const gap = blankLine.exec(text);
  const limit = gap ? gap.index : text.length;

  for (let j = start + 1; j < limit; j += 1) {
    const c = text[j];
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (c !== "$") continue;
    // A $$ run is a display fence, never the end of an inline span.
    if (text[j + 1] === "$") {
      j += 1;
      continue;
    }
    if (text[j - 1] === "$" || /\s/.test(text[j - 1]) || /\d/.test(text[j + 1] || "")) continue;
    return { delimiter: "$", content: text.slice(start + 1, j), end: j + 1 };
  }
  return null;
}

// Split text into plain and math tokens. Every token has start/end offsets and
// `raw` (its exact source); math tokens also carry `delimiter` and `content`.
function tokenizeMath(text) {
  const tokens = [];
  let plainStart = 0;
  let i = 0;

  const flush = (end) => {
    if (end > plainStart) {
      tokens.push({ math: false, start: plainStart, end, raw: text.slice(plainStart, end) });
    }
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "$") {
      i += 1;
      continue;
    }

    const span = readMathSpan(text, i);
    if (!span) {
      i += text.startsWith("$$", i) ? 2 : 1;
      continue;
    }

    flush(i);
    tokens.push({
      math: true,
      start: i,
      end: span.end,
      raw: text.slice(i, span.end),
      delimiter: span.delimiter,
      content: span.content,
    });
    i = span.end;
    plainStart = i;
  }

  flush(text.length);
  return tokens;
}

function mathRanges(text) {
  return tokenizeMath(text)
    .filter((token) => token.math)
    .map((token) => [token.start, token.end]);
}

function isInRanges(ranges, offset) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

// ---------------------------------------------------------------------------
// Delimiter conversion: \[ \] -> $$ and \( \) -> $
// ---------------------------------------------------------------------------
const CITATION_ONLY = /^\d+(?:\s*[,\u2013-]\s*\d+)*$/;

const BLANK_LINE = /\n[ \t]*\n/;
const MAX_MATH_LENGTH = 6000;

// A span is only converted when it is plainly one formula: no blank line (that
// means the closer belongs to some other paragraph), no second opener inside
// (an unmatched "\[" such as the interval \[0, 1) would swallow text up to a
// later "\]"), and a sane length.
function isPlausibleMathBody(body, opener) {
  if (BLANK_LINE.test(body) || body.length > MAX_MATH_LENGTH) return false;
  return !new RegExp(`\\\\{1,2}\\${opener}`).test(body);
}

function convertDelimiters(text, settings, result) {
  // A doubled backslash is ambiguous: it can be NotebookLM's escaped \[ or a
  // TeX row break followed by a bracket, as in "a \\[2pt] b". Doubled openers
  // that sit inside existing $ math are therefore left alone.
  if (settings.convertDisplayMath) {
    const ranges = mathRanges(text);
    text = text.replace(
      /(\\{1,2})\[(?!\s*-?\d*\.?\d+\s*(?:pt|em|ex|mm|cm|in|bp|mu)\s*\])([\s\S]*?)\\{1,2}\]([.,;:])?/g,
      (match, slashes, math, punctuation, offset, source) => {
        if (slashes.length === 2 && isInRanges(ranges, offset)) return match;
        const body = math.trim();
        // \[1\] is an escaped citation marker, not an equation.
        if (!body || CITATION_ONLY.test(body)) return match;
        if (!isPlausibleMathBody(math, "[")) {
          result.skippedMath += 1;
          return match;
        }

        // Inside a callout/blockquote every line must keep its "> " prefix, and
        // inside a list item the block must stay indented, or the structure breaks.
        const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
        const before = source.slice(lineStart, offset);
        const quote = before.match(/^\s*(?:>[ \t]?)+/);
        if (quote) {
          result.displayMath += 1;
          // One line: later passes leave quoted lines alone, so the prefix survives.
          return `$$${body.replace(/\s*\n\s*/g, " ")}${punctuation || ""}$$`;
        }

        result.displayMath += 1;
        // A literal "$" touching the new fence would form "$$$"; keep it apart.
        const previous = source[offset - 1];
        const next = source[offset + match.length];
        const lead = previous === "$" ? "\n" : "";
        const trail = next === "$" ? "\n" : "";
        // Trailing punctuation belongs inside the block, not in a stray paragraph.
        return `${lead}$$\n${body}${punctuation || ""}\n$$${trail}`;
      },
    );
  } else if (settings.normalizeEscapedCommands) {
    text = text.replace(
      /(\\{1,2}\[)([\s\S]*?)(\\{1,2}\])/g,
      (_match, open, math, close) => `${open}${normalizeTeXCommands(math, result)}${close}`,
    );
  }

  if (settings.convertInlineMath) {
    const ranges = mathRanges(text);
    text = text.replace(/(\\{1,2})\(([\s\S]*?)\\{1,2}\)/g, (match, slashes, math, offset, source) => {
      if (slashes.length === 2 && isInRanges(ranges, offset)) return match;
      let body = math.trim();
      if (!body) return match;
      // A stray "$" inside would end the span early; an unmatched "\(" would
      // pair with a later "\)". Leave both for the author to look at.
      if (!isPlausibleMathBody(math, "(") || /(?<!\\)\$/.test(body)) {
        result.skippedMath += 1;
        return match;
      }
      // Obsidian inline math cannot contain line breaks. Environments such as
      // matrices keep theirs so they can later be promoted to display blocks.
      if (!/\\begin\{/.test(body)) body = body.replace(/\s*\n\s*/g, " ");
      result.inlineMath += 1;
      // "$a$$b$" would read as a display fence, and a "$" followed by a digit
      // does not close inline math in Obsidian: keep a space in both cases.
      const previous = source[offset - 1];
      const next = source[offset + match.length];
      const nextIsInlineOpener = /^\\{1,2}\(/.test(source.slice(offset + match.length, offset + match.length + 3));
      const lead = previous === "$" ? " " : "";
      const trail = next === "$" || nextIsInlineOpener || (next !== undefined && /\d/.test(next)) ? " " : "";
      return `${lead}$${body}$${trail}`;
    });
  } else if (settings.normalizeEscapedCommands) {
    text = text.replace(
      /(\\{1,2}\()([\s\S]*?)(\\{1,2}\))/g,
      (_match, open, math, close) => `${open}${normalizeTeXCommands(math, result)}${close}`,
    );
  }

  return text;
}

// Clean up the inside of every real $...$ / $$...$$ span in one pass.
const UNICODE_TO_TEX = new Map(Object.entries({
  "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≅": "\\cong", "∝": "\\propto",
  "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "·": "\\cdot", "⋅": "\\cdot", "∗": "\\ast", "∘": "\\circ", "∙": "\\bullet",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint",
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto",
  "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "⊇": "\\supseteq",
  "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∖": "\\setminus", "∀": "\\forall", "∃": "\\exists", "¬": "\\neg",
  "∧": "\\land", "∨": "\\lor", "⊕": "\\oplus", "⊗": "\\otimes", "…": "\\ldots", "⋯": "\\cdots",
  "∴": "\\therefore", "∵": "\\because", "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel", "ℓ": "\\ell", "ℏ": "\\hbar",
  "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}",
  "°": "^\\circ", "′": "'", "−": "-", "⟨": "\\langle", "⟩": "\\rangle", "⌈": "\\lceil", "⌉": "\\rceil", "⌊": "\\lfloor", "⌋": "\\rfloor",
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta",
  "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "µ": "\\mu", "ν": "\\nu", "ξ": "\\xi",
  "π": "\\pi", "ρ": "\\rho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\phi", "ϕ": "\\varphi",
  "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma",
  "Υ": "\\Upsilon", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
}));
const UNICODE_CHAR_PATTERN = new RegExp(`[${[...UNICODE_TO_TEX.keys()].join("")}]`, "g");

const SUPERSCRIPTS = new Map(Object.entries({
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
}));
const SUBSCRIPTS = new Map(Object.entries({
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k",
  "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t", "ᵢ": "i", "ⱼ": "j", "ᵣ": "r", "ᵤ": "u", "ᵥ": "v",
}));
const SUPERSCRIPT_RUN = new RegExp(`[${[...SUPERSCRIPTS.keys()].join("")}]+`, "g");
const SUBSCRIPT_RUN = new RegExp(`[${[...SUBSCRIPTS.keys()].join("")}]+`, "g");
const TEXT_MODE_GROUP = /\\(?:text|textbf|textit|textrm|mathrm|mbox|operatorname)\s*\{/g;

function convertUnicodeChunk(chunk, result) {
  const count = () => { if (result) result.unicodeConversions += 1; };
  const script = (map, marker) => (run) => {
    count();
    const plain = [...run].map((c) => map.get(c)).join("");
    return /^[A-Za-z0-9]$/.test(plain) ? `${marker}${plain}` : `${marker}{${plain}}`;
  };
  return chunk
    .replace(/√\s*(?:\(([^()]*)\)|(\d+(?:\.\d+)?|[A-Za-z]+))/g, (_m, group, atom) => {
      count();
      return `\\sqrt{${group ?? atom}}`;
    })
    .replace(SUPERSCRIPT_RUN, script(SUPERSCRIPTS, "^"))
    .replace(SUBSCRIPT_RUN, script(SUBSCRIPTS, "_"))
    .replace(UNICODE_CHAR_PATTERN, (char, offset, whole) => {
      count();
      const command = UNICODE_TO_TEX.get(char);
      // "\leq" followed by a letter would read as the unknown command "\leqy".
      return /[A-Za-z]$/.test(command) && /[A-Za-z]/.test(whole[offset + 1] || "") ? `${command} ` : command;
    });
}

// Convert pasted symbols to LaTeX, leaving \text{...}-style groups verbatim:
// they are text mode, where \alpha and friends do not work.
function unicodeToLatex(math, result) {
  let output = "";
  let cursor = 0;
  TEXT_MODE_GROUP.lastIndex = 0;
  let match;
  while ((match = TEXT_MODE_GROUP.exec(math)) !== null) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < math.length && depth > 0) {
      if (math[end] === "\\") end += 1;
      else if (math[end] === "{") depth += 1;
      else if (math[end] === "}") depth -= 1;
      end += 1;
    }
    output += convertUnicodeChunk(math.slice(cursor, match.index), result) + math.slice(match.index, end);
    cursor = end;
    TEXT_MODE_GROUP.lastIndex = end;
  }
  return output + convertUnicodeChunk(math.slice(cursor), result);
}

// ---------------------------------------------------------------------------
// Citation markers: [1], [2, 3], [1-3]
// ---------------------------------------------------------------------------
const CITATION_NUMBERS = String.raw`\d{1,3}(?:\s*[,;\u2013\u2014-]\s*\d{1,3})*`;
const CITATION_RUN = new RegExp(
  String.raw`(?<![\[^!])( ?)((?:\\{0,2}\[${CITATION_NUMBERS}\\{0,2}\])+)(?![(:\[\]])`,
  "g",
);
const CITATION_MARKER = new RegExp(String.raw`\\{0,2}\[(${CITATION_NUMBERS})\\{0,2}\]`, "g");
const CITATION_ANY = new RegExp(
  String.raw`\\{0,2}\[\^?\d{1,3}(?:\s*[,;\u2013\u2014-]\s*\^?\d{1,3})*\\{0,2}\]`,
  "g",
);
const CITATION_DEFINITION = /^([ \t]*)\\{0,2}\[(\d{1,3})\\{0,2}\](?![(:\[])[ \t]+(?=\S)/gm;

function collectCitationDefinitions(text) {
  const numbers = new Set();
  for (const match of text.matchAll(CITATION_DEFINITION)) numbers.add(Number(match[2]));
  return numbers;
}

function expandCitationNumbers(body) {
  const numbers = [];
  for (const part of body.split(/[,;]/)) {
    const range = part.trim().match(/^(\d+)\s*[\u2013\u2014-]\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > 20) return null;
      for (let n = from; n <= to; n += 1) numbers.push(n);
    } else if (/^\d+$/.test(part.trim())) {
      numbers.push(Number(part.trim()));
    } else {
      return null;
    }
  }
  // Citations are numbered from 1; [0] is array indexing.
  return numbers.some((n) => n < 1) ? null : numbers;
}

function handleCitations(text, settings, result, definitions) {
  const mode = settings.citationMode;
  if (mode !== "strip" && mode !== "footnotes") return text;

  if (mode === "footnotes" && definitions.size > 0) {
    const ranges = mathRanges(text);
    text = text.replace(CITATION_DEFINITION, (match, indent, number, offset) => {
      if (isInRanges(ranges, offset)) return match;
      result.citations += 1;
      return `${indent}[^${number}]: `;
    });
  }

  const ranges = mathRanges(text);
  return text.replace(CITATION_RUN, (match, space, run, offset, source) => {
    if (isInRanges(ranges, offset)) return match;

    // "[1] Author, Title" at the start of a line is the reference list itself.
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)?$/.test(source.slice(lineStart, offset + space.length))) return match;
    // x[1] is indexing, not a citation: a lone one-letter identifier before it.
    const previous = source[offset - 1];
    if (!space && previous && /\w/.test(previous) && !/\w/.test(source[offset - 2] || " ")) return match;

    const numbers = [];
    for (const marker of run.matchAll(CITATION_MARKER)) {
      const expanded = expandCitationNumbers(marker[1]);
      if (!expanded) return match;
      numbers.push(...expanded);
    }

    if (mode === "footnotes") {
      if (numbers.length === 0 || !numbers.every((n) => definitions.has(n))) return match;
      result.citations += numbers.length;
      return `${space}${numbers.map((n) => `[^${n}]`).join("")}`;
    }

    result.citations += numbers.length;
    const following = source[offset + match.length];
    const wordContinues = following !== undefined && /[\p{L}\p{N}("“]/u.test(following);
    // Never glue two words together: "word[1]word" keeps a space.
    const touchesWord = !space && wordContinues && /[\p{L}\p{N}]/u.test(previous || "");
    return (space && wordContinues) || touchesWord ? " " : "";
  });
}

function normalizeMathSpans(text, settings, result) {
  return tokenizeMath(text)
    .map((token) => {
      if (!token.math) return token.raw;
      let math = token.content;
      if (settings.normalizeEscapedCommands) math = normalizeTeXCommands(math, result);
      if (settings.convertUnicodeMath) math = unicodeToLatex(math, result);
      math = normalizeNotebookLMSubscripts(math, settings);
      math = applyConfiguredSnippets(math, settings, result);
      return `${token.delimiter}${math}${token.delimiter}`;
    })
    .join("");
}

function convertLatexArraysToMarkdownTables(text, result) {
  const convertArray = (_match, _columnSpec, body) => {
    const rows = parseLatexArrayRows(body);
    if (rows.length < 2) return _match;

    const columnCount = rows[0].length;
    if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) {
      return _match;
    }

    result.convertedArrays += 1;
    const tableRows = rows.map((row) =>
      `| ${row.map(formatLatexArrayCell).join(" | ")} |`,
    );
    tableRows.splice(1, 0, buildAlignmentSeparator(columnCount));
    return `\n${tableRows.join("\n")}\n`;
  };

  text = text.replace(
    /\$\$\s*\\begin\{array\}\{([^}]*)\}([\s\S]*?)\\end\{array\}\s*\$\$/g,
    convertArray,
  );
  return text.replace(
    /\\begin\{array\}\{([^}]*)\}([\s\S]*?)\\end\{array\}/g,
    convertArray,
  );
}

function promoteMultilineInlineMatrices(text, result) {
  return text.replace(
    /(^|[^$])\$(?!\$)([^$]+?)\$(?!\$)([.,;:]?)/g,
    (match, prefix, math, punctuation, offset, source) => {
      const matrix = math.match(
        /\\begin\{(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}[\s\S]*?\\end\{\1\}/,
      );
      if (!matrix || !math.includes("\n")) return match;

      const lineStart = source.lastIndexOf("\n", offset) + 1;
      const textBeforeMath = source.slice(lineStart, offset + prefix.length);
      const listMarker = textBeforeMath.match(/^(\s*(?:[-+*]|\d+[.)])\s+)/);
      const indent = listMarker ? " ".repeat(listMarker[0].length) : "";
      const formulaLines = `${math.trimEnd()}${punctuation}`
        .trim()
        .split(/\r?\n/)
        .map((line) => `${indent}${line}`)
        .join("\n");

      result.promotedMatrices += 1;
      return `${prefix.trimEnd()}\n${indent}$$\n${formulaLines}\n${indent}$$`;
    },
  );
}

function wrapBareMatrices(text, result) {
  const pattern =
    /\\begin\{(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}[\s\S]*?\\end\{\1\}/g;
  const matches = [...text.matchAll(pattern)];
  const ranges = mathRanges(text);
  let output = "";
  let cursor = 0;

  for (const match of matches) {
    const start = match.index;
    if (isInRanges(ranges, start)) continue;

    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const linePrefix = text.slice(lineStart, start);
    const trimmedPrefix = linePrefix.trimEnd();
    const formulaPrefix = /(?:=|\\approx|\\to|\\mapsto|\\times|\\cdot)$/.test(trimmedPrefix);
    const formulaStart = formulaPrefix ? lineStart : start;
    let formulaEnd = start + match[0].length;
    const punctuation = text[formulaEnd]?.match(/[.,;:]/)?.[0] || "";
    formulaEnd += punctuation.length;

    const formula = text.slice(formulaStart, formulaEnd).trim();
    const before = text.slice(cursor, formulaStart);
    const leadingNewline = before && !before.endsWith("\n") ? "\n" : "";
    const trailingNewline = text[formulaEnd] === "\n" || formulaEnd === text.length ? "" : "\n";

    output += `${before}${leadingNewline}$$\n${formula}\n$$${trailingNewline}`;
    cursor = formulaEnd;
    result.wrappedMatrices += 1;
  }

  return output + text.slice(cursor);
}

function parseLatexArrayRows(body) {
  const rowBreak = "\u0000FIXY_ROW_BREAK\u0000";

  // Standard LaTeX uses \\\\; NotebookLM sometimes emits a single slash
  // followed by whitespace before the next row or \hline.
  body = body.replace(/(?:\\\\)+/g, rowBreak);
  body = body.replace(/(^|[^\\])\\[ \t]+(?=\\hline|[A-Za-z0-9])/g, `$1${rowBreak}`);
  body = body.replace(/\\hline\b/g, "");

  return body
    .split(rowBreak)
    .map((row) => splitLatexArrayCells(row).map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
}

function splitLatexArrayCells(row) {
  const cells = [];
  let cell = "";
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === "&" && (i === 0 || row[i - 1] !== "\\")) {
      cells.push(cell);
      cell = "";
    } else {
      cell += row[i];
    }
  }
  cells.push(cell);
  return cells;
}

function formatLatexArrayCell(cell) {
  const textCell = cell.match(/^\\text\{([^{}]*)\}$/);
  if (textCell) return textCell[1].trim();
  if (!cell) return "";
  if (/^\$[^$]*\$$/.test(cell)) return cell;
  return `$${cell}$`;
}

function repairMatrixDisplayBlocks(text, result) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let inDisplayMath = false;
  let mathIndent = "";
  let mathHasMatrix = false;
  let blockNeedsRepair = false;
  let pendingListIndent = "";
  let afterBlockIndent = "";

  // Fences pair up in order, so with an odd total the last one has no partner.
  // Treating it as an opener would trim and re-flow every line that follows.
  let totalFences = 0;
  let strayLine = -1;
  lines.forEach((line, index) => {
    for (let at = line.indexOf("$$"); at >= 0; at = line.indexOf("$$", at + 2)) {
      totalFences += 1;
      strayLine = index;
    }
  });
  if (totalFences % 2 === 0) strayLine = -1;
  // The one unclosed block Fixy still repairs is a matrix whose closing $$ was
  // dropped: the matrix must start before the next blank line.
  if (strayLine >= 0) {
    let end = strayLine;
    while (end < lines.length && lines[end].trim() !== "") end += 1;
    const block = lines.slice(strayLine, end).join("\n");
    if (/\\begin\{(?:bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/.test(block)) {
      strayLine = -1;
    }
  }

  const addMathLine = (line) => {
    if (line.trim()) output.push(`${mathIndent}${line.trim()}`);
    if (/\\begin\{(?:bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/.test(line)) {
      mathHasMatrix = true;
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (!inDisplayMath && (lineIndex === strayLine || /^\s*>/.test(line))) {
      output.push(line);
      continue;
    }

    if (inDisplayMath && mathHasMatrix && !line.trim()) {
      output.push(`${mathIndent}$$`, "");
      inDisplayMath = false;
      mathIndent = "";
      mathHasMatrix = false;
      result.repairedMatrixBlocks += 1;
      blockNeedsRepair = false;
      pendingListIndent = "";
      continue;
    }

    let cursor = 0;
    let delimiterIndex = line.indexOf("$$");
    if (delimiterIndex < 0) {
      if (inDisplayMath) {
        addMathLine(line);
        const endsMatrix =
          /\\end\{(?:bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}[.,;:]?\s*$/.test(line);
        const nextLine = lines[lineIndex + 1] || "";
        const hasExplicitCloser = nextLine.includes("$$");
        const continuesMath = /^\s*(?:=|\+|\\\\|&|\\(?:begin|times|cdot|approx|to)\b)/.test(nextLine);
        if (mathHasMatrix && endsMatrix && !hasExplicitCloser && !continuesMath) {
          output.push(`${mathIndent}$$`);
          inDisplayMath = false;
          mathIndent = "";
          mathHasMatrix = false;
          result.repairedMatrixBlocks += 1;
          blockNeedsRepair = false;
          pendingListIndent = "";
        }
      } else {
        output.push(line);
        const listMarker = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+)/);
        pendingListIndent = listMarker ? " ".repeat(listMarker[0].length) : "";
      }
      continue;
    }

    let closedDisplayMathOnLine = false;
    while (delimiterIndex >= 0) {
      const segment = line.slice(cursor, delimiterIndex);
      if (inDisplayMath) {
        addMathLine(segment);
        output.push(`${mathIndent}$$`);
        closedDisplayMathOnLine = true;
        if (blockNeedsRepair) result.repairedMatrixBlocks += 1;
        inDisplayMath = false;
        afterBlockIndent = mathIndent;
        mathIndent = "";
        mathHasMatrix = false;
        blockNeedsRepair = false;
      } else {
        if (segment.trim()) {
          output.push(closedDisplayMathOnLine ? `${afterBlockIndent}${segment.trim()}` : segment.trimEnd());
          const listMarker = segment.match(/^(\s*(?:[-+*]|\d+[.)])\s+)/);
          mathIndent = listMarker ? " ".repeat(listMarker[0].length) : pendingListIndent;
          blockNeedsRepair = true;
        } else {
          mathIndent = segment || pendingListIndent;
          blockNeedsRepair = false;
        }
        output.push(`${mathIndent}$$`);
        inDisplayMath = true;
        mathHasMatrix = false;
        pendingListIndent = "";
        closedDisplayMathOnLine = false;
      }

      cursor = delimiterIndex + 2;
      delimiterIndex = line.indexOf("$$", cursor);
    }

    const remainder = line.slice(cursor);
    if (inDisplayMath) {
      addMathLine(remainder);
      if (
        mathHasMatrix &&
        /\\end\{(?:bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}[.,;:]?\s*$/.test(remainder)
      ) {
        output.push(`${mathIndent}$$`);
        inDisplayMath = false;
        mathIndent = "";
        mathHasMatrix = false;
        result.repairedMatrixBlocks += 1;
        blockNeedsRepair = false;
        pendingListIndent = "";
      }
    } else if (remainder.trim()) {
      output.push(closedDisplayMathOnLine ? `${afterBlockIndent}${remainder.trim()}` : remainder.trim());
      const listMarker = remainder.match(/^(\s*(?:[-+*]|\d+[.)])\s+)/);
      pendingListIndent = listMarker ? " ".repeat(listMarker[0].length) : "";
      if (blockNeedsRepair) {
        result.repairedMatrixBlocks += 1;
        blockNeedsRepair = false;
      }
    }
  }

  if (inDisplayMath && mathHasMatrix) {
    output.push(`${mathIndent}$$`);
    result.repairedMatrixBlocks += 1;
  }

  return output.join("\n");
}

// Repair a common NotebookLM error: one parenthesized inline formula with
// each TeX fragment separately wrapped in $, plus an extra closing dollar.
// This must run before the matrix repair, which would otherwise read the
// trailing $$ as a display-math fence and split the line.
function repairExcessClosingDollars(text, result) {
  return text.replace(/\(\$([^\n]*?)\$\$\)/g, (_match, math) => {
    const normalized = stripUnescapedDollarDelimiters(math);
    result.repairedMathDelimiters += 1;
    return "($" + normalized + "$)";
  });
}

function normalizeExcessMathDelimiters(text, result) {
  // Normalize only complete display-math pairs. A broad multiline regex can
  // accidentally pair an unmatched opener with a later block and strip dollars
  // from unrelated inline formulas in between.
  const lines = text.split("\n");
  for (let open = 0; open < lines.length; open += 1) {
    if (lines[open].trim() !== "$$") continue;
    let close = open + 1;
    while (close < lines.length && lines[close].trim() !== "$$") {
      if (!lines[close].trim()) break;
      close += 1;
    }
    if (close >= lines.length || lines[close].trim() !== "$$") continue;

    const math = lines.slice(open + 1, close).join("\n");
    const normalized = stripNestedDisplayMathDelimiters(math, result).split("\n");
    lines.splice(open + 1, close - open - 1, ...normalized);
    close = open + normalized.length + 1;
    open = close;
  }

  return lines.join("\n");
}

function stripNestedDisplayMathDelimiters(math, result) {
  const normalized = stripUnescapedDollarDelimiters(math);
  if (normalized !== math) result.repairedMathDelimiters += 1;
  return normalized;
}

function stripUnescapedDollarDelimiters(text) {
  return text.replace(/(?<!\\)\$/g, "");
}

function normalizeMatrixRowBreaks(text, result) {
  return text.replace(
    /\\begin\{(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g,
    (environment, name, body) => {
      const normalizedBody = body.replace(
        /(^|[^\\])\\(?:[ \t]+(?=(?!(?:\\end\b))(?:\\[A-Za-z]+|[A-Za-z0-9({+-]))|[ \t]*\r?\n[ \t]*(?=(?!(?:\\end\b))(?:\\[A-Za-z]+|[A-Za-z0-9({+-])))/g,
        (_match, prefix) => {
          result.fixedMatrixRows += 1;
          return `${prefix}\\\\\n`;
        },
      );
      return `\\begin{${name}}${normalizedBody}\\end{${name}}`;
    },
  );
}

function repairCompactMarkdownTables(text, result) {
  return text.replace(/^[^\n]*\|[^\n]*$/gm, (line) => {
    const firstPipe = line.indexOf("|");
    const lastPipe = line.lastIndexOf("|");
    if (firstPipe === lastPipe) return line;

    const prefix = line.slice(0, firstPipe);
    const table = line.slice(firstPipe, lastPipe + 1);
    const suffix = line.slice(lastPipe + 1);
    const cells = table.split("|").slice(1, -1).map((cell) => cell.trim());

    let separatorStart = -1;
    let columnCount = 0;
    for (let i = 0; i < cells.length; i += 1) {
      if (!/^:?-{1,}:?$/.test(cells[i])) continue;
      let end = i;
      while (end < cells.length && /^:?-{1,}:?$/.test(cells[end])) end += 1;
      if (end - i >= 2) {
        separatorStart = i;
        columnCount = end - i;
        break;
      }
      i = end - 1;
    }

    if (separatorStart < 0) {
      const firstBoundary = cells.findIndex((cell) => cell === "");
      if (firstBoundary < 2) return line;

      const inferredColumnCount = firstBoundary;
      const inferredRows = [];
      let inferredCursor = 0;
      while (inferredCursor < cells.length) {
        const row = cells.slice(inferredCursor, inferredCursor + inferredColumnCount);
        if (row.length !== inferredColumnCount) return line;
        inferredRows.push(row);
        inferredCursor += inferredColumnCount;
        if (inferredCursor < cells.length) {
          if (cells[inferredCursor] !== "") return line;
          inferredCursor += 1;
        }
      }

      if (inferredRows.length < 2) return line;
      result.repairedTables += 1;
      const formattedRows = [
        inferredRows[0],
        Array(inferredColumnCount).fill("---"),
        ...inferredRows.slice(1),
      ];
      const formattedTable = formattedRows
        .map((row) => `| ${row.join(" | ")} |`)
        .join("\n");
      const heading = prefix.trimEnd();
      return `${heading ? `${heading}\n\n` : ""}${formattedTable}${suffix}`;
    }

    const headerStart = separatorStart - columnCount - 1;
    if (
      headerStart !== 0 ||
      cells[separatorStart - 1] !== "" ||
      cells.slice(headerStart, separatorStart - 1).length !== columnCount
    ) {
      return line;
    }

    const rows = [
      cells.slice(headerStart, headerStart + columnCount),
      cells.slice(separatorStart, separatorStart + columnCount),
    ];
    rows[1] = rows[1].map(() => "---");
    let cursor = separatorStart + columnCount;
    if (cells[cursor] === "") cursor += 1;

    while (cursor < cells.length) {
      const row = cells.slice(cursor, cursor + columnCount);
      if (row.length !== columnCount) return line;
      rows.push(row);
      cursor += columnCount;
      if (cursor < cells.length && cells[cursor] === "") cursor += 1;
    }

    if (rows.length < 3) return line;

    result.repairedTables += 1;
    const formattedTable = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    const heading = prefix.trimEnd();
    return `${heading ? `${heading}\n\n` : ""}${formattedTable}${suffix}`;
  });
}

function normalizeMarkdownTableSeparators(text, result) {
  return text.replace(/^[^\n]*$/gm, (line) => {
    if (!line.includes("|")) return line;

    const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || !cells.every((cell) => /^:?-{1,}:?$/.test(cell))) {
      return line;
    }

    // A separator that already states an alignment (":---", ":---:", "---:") is the author's choice.
    if (cells.some((cell) => cell.includes(":"))) return line;

    const normalized = buildAlignmentSeparator(cells.length);
    if (line.trim() === normalized) return line;
    result.normalizedTableSeparators += 1;
    return `${line.match(/^\s*/)[0]}${normalized}`;
  });
}

function ensureMarkdownTableSeparators(text, result) {
  const lines = text.split("\n");
  const output = [];

  for (let i = 0; i < lines.length; ) {
    const firstRow = getPipeTableCells(lines[i]);
    if (!firstRow || isMarkdownTableSeparator(firstRow)) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const tableRows = [];
    let end = i;
    while (end < lines.length) {
      const cells = getPipeTableCells(lines[end]);
      if (!cells) break;
      tableRows.push({ line: lines[end], cells });
      end += 1;
    }

    // A row without its closing pipe (or with a note after it) still belongs to the
    // table. Treating it as "the end" would insert a blank line and detach it.
    const trailingRows = [];
    while (end < lines.length && lines[end].trim() !== "" && lines[end].includes("|")) {
      trailingRows.push(lines[end]);
      end += 1;
    }

    const columnCount = firstRow.length;
    const isConsistentTable =
      columnCount >= 2 &&
      tableRows.length >= 2 &&
      tableRows.every((row) => row.cells.length === columnCount);

    if (!isConsistentTable) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    if (output.length > 0 && output[output.length - 1].trim() !== "") {
      output.push("");
    }
    output.push(tableRows[0].line);
    if (isMarkdownTableSeparator(tableRows[1].cells)) {
      output.push(...tableRows.slice(1).map((row) => row.line));
    } else {
      const indent = lines[i].match(/^\s*/)[0];
      output.push(`${indent}${buildAlignmentSeparator(columnCount)}`);
      output.push(...tableRows.slice(1).map((row) => row.line));
      result.repairedTables += 1;
    }
    output.push(...trailingRows);
    if (end < lines.length && lines[end].trim() !== "") {
      output.push("");
    }

    i = end;
  }

  return output.join("\n");
}

function getPipeTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

let snippetCache = { source: null, compiled: null };

// Compile the snippet dictionary once into a single alternation. Keys without a
// leading underscore get one, exactly like the built-in defaults.
function compileSnippets(settings) {
  const source = String((settings && settings.snippets) ?? "");
  if (snippetCache.source === source) return snippetCache.compiled;

  const map = new Map();
  for (const [rawFrom, to] of parseSnippets(source)) {
    if (!to) continue;
    const from = rawFrom.startsWith("_") ? rawFrom : `_${rawFrom}`;
    if (from.length < 2) continue;
    map.set(from, to);
  }

  let compiled = null;
  if (map.size > 0) {
    const keys = [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    compiled = {
      map,
      regex: new RegExp(`(?<![A-Za-z0-9\\\\])(?:${keys.join("|")})(?![A-Za-z0-9])`, "g"),
    };
  }
  snippetCache = { source, compiled };
  return compiled;
}

// Snippets run only inside math spans. In prose, "_max_" or "_in_" is ordinary
// Markdown emphasis and must never turn into LaTeX.
function applyConfiguredSnippets(math, settings, result) {
  const snippets = compileSnippets(settings);
  if (!snippets) return math;
  return math.replace(snippets.regex, (match) => {
    result.snippetConversions += 1;
    return snippets.map.get(match);
  });
}

function markUncertainMath(line, result) {
  const candidate = line.trim();
  if (
    !candidate ||
    candidate.startsWith("|") ||
    candidate.includes("<!-- Fixy: uncertain -->") ||
    candidate.includes("$") ||
    !/[=<>^×÷≤≥≠]/.test(candidate) ||
    !/\d/.test(candidate) ||
    !/[A-Za-z]/.test(candidate)
  ) return line;

  result.uncertainMath += 1;
  return `${line} <!-- Fixy: uncertain -->`;
}

function normalizeNotebookLMBareMath(text, result, settings) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let inDisplayMath = false;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    // Never touch lines that already belong to a $$ block.
    const fences = (line.match(/\$\$/g) || []).length;
    if (inDisplayMath || fences % 2 === 1) {
      output.push(line);
      if (fences % 2 === 1) inDisplayMath = !inDisplayMath;
      continue;
    }

    output.push(settings.markUncertain ? markUncertainMath(line, result) : line);
  }

  return output.join("\n");
}

function followsListContext(output) {
  for (let i = output.length - 1; i >= 0; i -= 1) {
    if (output[i].trim() === "") continue;
    return /^\s*(?:[-+*]|\d+[.)])\s+/.test(output[i]) || /^\s+\S/.test(output[i]);
  }
  return false;
}

function ensureBlankLinesAroundDisplayMath(text, result) {
  const lines = text.split(/\r?\n/);
  const output = [];

  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim() !== "$$") {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    // Stray spaces from inline source text must not leak into the delimiter, but
    // $$ inside a list item has to stay indented to remain part of that item.
    const keepIndent = followsListContext(output);
    lines[i] = keepIndent ? lines[i].trimEnd() : "$$";

    let close = i + 1;
    while (close < lines.length && lines[close].trim() !== "$$") close += 1;
    if (close >= lines.length) {
      output.push(...lines.slice(i));
      break;
    }

    lines[close] = keepIndent ? lines[close].trimEnd() : "$$";
    if (!keepIndent) {
      for (let k = i + 1; k < close; k += 1) lines[k] = lines[k].trimStart();
    }

    let blockSpaced = false;
    if (output.length > 0 && output[output.length - 1].trim() !== "") {
      output.push("");
      blockSpaced = true;
    }

    output.push(...lines.slice(i, close + 1));
    if (close + 1 < lines.length && lines[close + 1].trim() !== "") {
      output.push("");
      blockSpaced = true;
    }
    if (blockSpaced) result.spacedMathBlocks += 1;
    i = close + 1;
  }

  return output.join("\n");
}

function isMarkdownTableSeparator(cells) {
  return cells.length >= 2 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function buildAlignmentSeparator(columnCount) {
  const cells = Array.from({ length: columnCount }, (_value, index) => {
    const dashes = "-----";
    if (index === 0) return `:${dashes}`;
    if (index === columnCount - 1) return `${dashes}:`;
    return `:${dashes}:`;
  });
  return `|${cells.join("|")}|`;
}

function normalizeNotebookLMSubscripts(math, settings = DEFAULT_SETTINGS) {
  // Markdown escaping can leave \_ before a real TeX subscript group.
  // Inside math, normalize only this specific form; keep literal underscores elsewhere.
  math = math.replace(/\\_(?=\s*\{)/g, "_");
  if (!settings.fixAsteriskSubscripts) return math;

  return math
    // NotebookLM can put a text command inside the braces: ALE*{\text{prior}}.
    .replace(/(\\text\{[^{}]+\})\*\{(\\text\{[^{}]+\})\}/g, "$1_{$2}")
    // Examples: ALE*{prior} -> ALE_{prior}, X*{k+1} -> X_{k+1}.
    .replace(/\b([A-Z][A-Za-z0-9]*)\*\{([A-Za-z][A-Za-z0-9]*(?:[+\-,][A-Za-z0-9]+|\s+[A-Za-z][A-Za-z0-9]*)*)\}/g, "$1_{$2}")
    // The compact X*k form is accepted only for a single uppercase variable and
    // a conventional index letter (i, j, k, l, m, n, t). Letters such as x, b, y
    // are far more often real products (W*x, A*b) and are left alone.
    .replace(/\b([A-Z])\*([ijklmnt])\b/g, "$1_$2");
}

const KNOWN_TEX_COMMANDS = new Set((
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau " +
  "upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
  "text textbf textit textrm mathrm mathbf mathit mathbb mathcal mathsf mathtt boldsymbol operatorname " +
  "frac dfrac tfrac binom sqrt sum prod int oint iint iiint lim limsup liminf log ln lg exp sin cos tan cot sec csc " +
  "arcsin arccos arctan sinh cosh tanh min max sup inf det dim ker arg gcd Pr deg hom " +
  "times cdot div pm mp ast star circ bullet oplus otimes odot approx neq ne leq le geq ge ll gg equiv sim simeq cong propto " +
  "infty partial nabla to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto longrightarrow " +
  "in notin ni subset subseteq supset supseteq cup cap setminus emptyset varnothing forall exists neg land lor wedge vee " +
  "left right big Big bigg Bigg begin end hat widehat bar vec tilde widetilde dot ddot overline underline overbrace underbrace " +
  "overset underset stackrel quad qquad ldots cdots vdots ddots dots langle rangle lceil rceil lfloor rfloor lvert rvert lVert rVert " +
  "mid perp parallel top bot angle triangle hbar ell Re Im aleph displaystyle textstyle limits bmod pmod mod boxed cancel " +
  "prime therefore because checkmark degree"
).split(" "));

function normalizeTeXCommands(math, result) {
  // Collapse "\\alpha" to "\alpha" only for real TeX command names. A bare
  // "\\" followed by a letter is usually a row break in compact input such as
  // \begin{matrix}a&b\\c&d\end{matrix}, and must survive.
  // If the span also contains ordinary single-backslash commands it is not
  // double-escaped, so short names (pi, in, to, le...) are treated as row breaks.
  const hasPlainCommands = /(?<!\\)\\[A-Za-z]{2,}/.test(math);
  return math.replace(/(?<!\\)\\\\([A-Za-z]+)/g, (match, name) => {
    if (!KNOWN_TEX_COMMANDS.has(name)) return match;
    if (hasPlainCommands && name.length <= 3) return match;
    result.normalizedCommands += 1;
    return `\\${name}`;
  });
}

// Transform ordinary Markdown while preserving fenced and inline code verbatim.
function transformOutsideMarkdownCode(text, transform) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const output = [];
  let markdown = "";
  let fence = null;

  const flushMarkdown = () => {
    if (markdown) {
      output.push(transformOutsideInlineCode(markdown, transform));
      markdown = "";
    }
  };

  for (const line of lines) {
    if (fence) {
      output.push(line);
      const closing = line.match(/^[ ]{0,3}(`{3,}|~{3,})[ \t]*\n?$/);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const opener = line.match(/^[ ]{0,3}(`{3,}|~{3,})/);
    if (opener) {
      flushMarkdown();
      fence = { char: opener[1][0], length: opener[1].length };
      output.push(line);
      continue;
    }

    markdown += line;
  }

  flushMarkdown();
  return output.join("");
}

function transformOutsideInlineCode(text, transform) {
  let output = "";
  let segment = "";
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "`") {
      segment += text[i];
      i += 1;
      continue;
    }

    let run = 1;
    while (text[i + run] === "`") run += 1;

    // A backtick run only opens inline code if a run of the same length closes
    // it within the paragraph. Otherwise it is a literal backtick (an
    // apostrophe typo, say) and must not switch conversion off for the rest of
    // the note.
    const close = findClosingBacktickRun(text, i + run, run);
    if (close < 0) {
      segment += text.slice(i, i + run);
      i += run;
      continue;
    }

    output += transform(segment) + text.slice(i, close + run);
    segment = "";
    i = close + run;
  }

  return output + transform(segment);
}

function findClosingBacktickRun(text, from, length) {
  const blankLine = /\n[ \t]*\n/g;
  blankLine.lastIndex = from;
  const gap = blankLine.exec(text);
  const limit = gap ? gap.index : text.length;

  let j = from;
  while (j < limit) {
    if (text[j] !== "`") {
      j += 1;
      continue;
    }
    let run = 1;
    while (text[j + run] === "`") run += 1;
    if (run === length) return j;
    j += run;
  }
  return -1;
}

module.exports = NotebookLMToObsidianPlugin;
// Pure helpers, exposed so they can be tested outside Obsidian.
Object.assign(module.exports, {
  convertNotebookLMMarkdown, preservesDocumentContent, DEFAULT_SETTINGS, findMarkers, checkMath, resolveBindingClashes, buildDiffHunks,
});
