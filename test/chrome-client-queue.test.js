import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../src/chrome-client.js", import.meta.url);

/** @typedef {{ key: string, file: string, reviewIncarnation?: string, layoutGateEnabled?: boolean, layoutGateMaxHoldMs?: number, modeToggleHotkeyKey?: string, initialAnnotationMode?: boolean, mediaTransportEnabled?: boolean, initialLayoutWarnings?: any[], initialPendingPrompts?: number, chromeLoadToken?: string, initialArtifactRevision?: number, initialArtifactLoadToken?: string, initialArtifactLoadSequence?: number }} HarnessSessionData */
/** @type {HarnessSessionData} */
const defaultSessionData = {
  key: "abc",
  file: "/tmp/artifact.html",
  modeToggleHotkeyKey: "i",
  reviewIncarnation: "review-incarnation-one",
};

function acknowledgedPromptResponse(init, overrides = {}) {
  const body = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({
      status: "queued",
      batch_id: body.batchId,
      review_incarnation: body.reviewIncarnation,
      duplicate: false,
      submitted_prompts: body.prompts.length,
      processed_prompts: body.prompts.length,
      submitted_timestamped_notes: body.prompts.filter((prompt) => prompt.target?.type === "video-timecode").length,
      submitted_messages: body.prompts.filter((prompt) => prompt.tag === "message").length,
      submitted_layout_warnings: body.prompts.filter(
        (prompt) => prompt.tag === "layout-warnings" && prompt.target?.type === "layout-warnings",
      ).length,
      accepted_prompts: body.prompts.length,
      timestamped_notes: body.prompts.filter((prompt) => prompt.target?.type === "video-timecode").length,
      messages: body.prompts.filter((prompt) => prompt.tag === "message").length,
      deduplicated_layout_warnings: 0,
      ...overrides,
    }),
  };
}

async function createChromeHarness({
  fetchImpl = /** @type {(url?: any, init?: any) => Promise<any>} */ (
    async () => ({ ok: true, json: async () => ({}) })
  ),
  sessionData = defaultSessionData,
  artifactSrc = "",
  storage = new Map(),
  beginLoadResponses = [],
  handoffResponses = [],
} = {}) {
  const source = await readFile(sourceUrl, "utf8");
  const postedToFrame = [];
  const postedToWhiteboard = [];
  const inlineWhiteboards = [];
  const eventSources = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const elements = new Map();
  const timers = new Map();
  const srcLoads = [];
  const beginRequests = [];
  const artifactBeginRequests = [];
  const focusLog = [];
  const clipboardWrites = [];
  let nextTimerId = 1;
  let reloadCount = 0;
  let artifactRevision = 0;

  function fakeSetTimeout(fn, ms) {
    const timer = {
      id: nextTimerId++,
      ms,
      fn,
      unref() {},
    };
    timers.set(timer.id, timer);
    return timer;
  }

  function fakeClearTimeout(timer) {
    if (timer && typeof timer === "object") timers.delete(timer.id);
  }

  function runTimers(ms) {
    for (const timer of [...timers.values()]) {
      if (ms !== undefined && timer.ms !== ms) continue;
      timers.delete(timer.id);
      timer.fn();
    }
  }

  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const listeners = new Map();
    const classes = new Set();
    const el = {
      id,
      hidden: false,
      disabled: false,
      checked: false,
      indeterminate: false,
      type: "",
      className: "",
      value: "",
      innerHTML: "",
      textContent: "",
      scrollTop: 0,
      scrollHeight: 0,
      scrolledIntoView: null,
      dataset: {},
      children: [],
      onclick: null,
      onchange: null,
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        remove(...names) {
          for (const name of names) classes.delete(name);
        },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
        contains(name) {
          return classes.has(name);
        },
        toString() {
          return [...classes].join(" ");
        },
      },
      style: {},
      setAttribute(name, value) {
        this[name] = String(value);
      },
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      dispatch(type, event = {}) {
        const handler = listeners.get(type);
        if (handler) handler(event);
      },
      querySelectorAll(selector) {
        const matches = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (typeof selector === "string" && selector.startsWith(".")) {
              if (
                String(child.className || "")
                  .split(/\s+/)
                  .includes(selector.slice(1))
              )
                matches.push(child);
            }
            walk(child);
          }
        };
        walk(this);
        return matches;
      },
      querySelector(selector) {
        if (selector !== "span") return this.querySelectorAll(selector)[0] || null;
        const childId = `${id}:span`;
        if (!elements.has(childId)) element(childId);
        return elements.get(childId);
      },
      contains(node) {
        let current = node;
        while (current) {
          if (current === this) return true;
          current = current.parentElement;
        }
        return false;
      },
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        this.lastAppendedChild = child;
        return child;
      },
      replaceChildren(...next) {
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        for (const child of next) this.appendChild(child);
      },
      click(event = {}) {
        this.clicked = true;
        if (typeof this.onclick === "function") return this.onclick(event);
        return undefined;
      },
      remove() {
        const parent = this.parentElement;
        if (!parent) return;
        parent.children = parent.children.filter((child) => child !== this);
        this.parentElement = null;
      },
      focus() {
        this.focused = true;
        focusLog.push(this.id);
      },
      select() {},
      scrollIntoView(options) {
        this.scrolledIntoView = options;
      },
      listeners,
    };
    elements.set(id, el);
    return el;
  }

  element("lavish-session").textContent = JSON.stringify(sessionData);
  const frame = element("artifact");
  frame.dataset.artifactSrc = artifactSrc;
  Object.defineProperty(frame, "src", {
    get() {
      return this.currentSrc || "";
    },
    set(value) {
      this.currentSrc = String(value);
      srcLoads.push({ src: this.currentSrc, hadMessageListener: windowListeners.has("message") });
    },
  });
  frame.contentWindow = {
    postMessage(message) {
      postedToFrame.push(message);
    },
  };
  element("whiteboardOverlay").hidden = true;
  element("shareDialog").hidden = true;
  element("moreMenu").hidden = true;
  element("warningsDrawer").hidden = true;
  const whiteboardFrame = element("whiteboardFrame");
  whiteboardFrame.contentWindow = {
    postMessage(message) {
      postedToWhiteboard.push(message);
    },
  };

  const harnessFetch = async (url, init) => {
    if (String(url).includes("/chrome-loads/begin")) {
      beginRequests.push({ url, init });
      if (handoffResponses.length > 0) return handoffResponses.shift();
      return {
        ok: true,
        json: async () => ({ chrome_load_token: "harness-chrome-refresh", artifact_revision: artifactRevision }),
      };
    }
    if (String(url).includes("/artifact-loads/begin")) {
      artifactBeginRequests.push({ url, init });
      if (beginLoadResponses.length > 0) return beginLoadResponses.shift();
      artifactRevision += 1;
      return {
        ok: true,
        json: async () => ({
          artifact_revision: artifactRevision,
          artifact_load_token: `harness-load-${artifactRevision}`,
        }),
      };
    }
    return fetchImpl(url, init);
  };

  const context = {
    clearTimeout: fakeClearTimeout,
    console,
    fetch: harnessFetch,
    location: {
      reload() {
        reloadCount += 1;
      },
    },
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(String(value));
        },
      },
    },
    setTimeout: fakeSetTimeout,
    URL: {
      createObjectURL() {
        return "blob:lavish-test";
      },
      revokeObjectURL() {},
    },
    EventSource: class FakeEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        eventSources.push(this);
      }

      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    },
    document: {
      body: element("body"),
      getElementById(id) {
        return element(id);
      },
      addEventListener(type, handler, capture) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push({ handler, capture: Boolean(capture) });
      },
      createElement(tag) {
        const el = element(`${tag}-${elements.size}`);
        el.tagName = tag.toUpperCase();
        return el;
      },
      execCommand() {
        return true;
      },
    },
    sessionStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    window: {
      clearTimeout: fakeClearTimeout,
      setTimeout: fakeSetTimeout,
      addEventListener(type, handler) {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(handler);
      },
    },
  };

  vm.runInNewContext(source, context, { filename: "chrome-client.js" });
  await flushPromises();
  if (artifactSrc) frame.dispatch("load");

  function frameLoadToken() {
    const match = String(frame.src).match(/[?&]artifact_load_token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  return {
    element,
    frame,
    postedToFrame,
    postedToWhiteboard,
    createInlineWhiteboard() {
      const posted = [];
      const source = {
        postMessage(message) {
          posted.push(message);
        },
      };
      const whiteboard = { source, posted };
      inlineWhiteboards.push(whiteboard);
      return whiteboard;
    },
    eventSource() {
      assert.equal(eventSources.length, 1);
      return eventSources[0];
    },
    sendFrameMessage(data) {
      const handlers = windowListeners.get("message") || [];
      assert.ok(handlers.length > 0, "chrome-client registered a message handler");
      const message =
        artifactSrc && !Object.hasOwn(data || {}, "artifact_load_token")
          ? { ...data, artifact_load_token: frameLoadToken() }
          : data;
      for (const handler of handlers) handler({ source: frame.contentWindow, data: message });
    },
    sendWhiteboardMessage(data) {
      const handlers = windowListeners.get("message") || [];
      assert.ok(handlers.length > 0, "chrome-client registered a message handler");
      for (const handler of handlers) handler({ source: whiteboardFrame.contentWindow, data });
    },
    sendInlineWhiteboardMessage(whiteboard, data) {
      const handlers = windowListeners.get("message") || [];
      assert.ok(handlers.length > 0, "chrome-client registered a message handler");
      for (const handler of handlers) handler({ source: whiteboard.source, data });
    },
    dispatchDocumentKeydown(eventProps) {
      const handlers = documentListeners.get("keydown") || [];
      assert.ok(handlers.length > 0, "chrome-client registered a document keydown handler");
      const event = {
        key: "",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
        ...eventProps,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const { handler } of handlers) handler(event);
      return event;
    },
    queued() {
      return JSON.parse(storage.get("lavish-axi:queued:abc") || "[]");
    },
    reloadCount() {
      return reloadCount;
    },
    focusLog,
    clipboardWrites,
    storage,
    warningRows() {
      return element("warningsList").children.filter((child) => String(child.className).startsWith("warning-row"));
    },
    dispatchDocumentMousedown(target) {
      for (const { handler } of documentListeners.get("mousedown") || []) handler({ target });
    },
    runTimers,
    srcLoads,
    beginRequests,
    artifactBeginRequests,
    artifactLoadToken: frameLoadToken,
  };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("chrome client re-handshakes once after a missing reviewer handoff", async () => {
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    sessionData: {
      ...defaultSessionData,
      chromeLoadToken: "expired-handoff",
      initialArtifactRevision: 1,
      initialArtifactLoadToken: "old-load",
    },
    beginLoadResponses: [{ ok: false, status: 409, json: async () => ({ status: "no-handoff" }) }],
    handoffResponses: [
      {
        ok: true,
        json: async () => ({
          chrome_load_token: "fresh-handoff",
          artifact_revision: 1,
          artifact_load_token: "",
          artifact_load_sequence: 0,
        }),
      },
    ],
  });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.beginRequests.length, 1);
  assert.equal(chrome.artifactBeginRequests.length, 2);
  assert.match(chrome.artifactBeginRequests[0].init.body, /expired-handoff/);
  assert.match(chrome.artifactBeginRequests[1].init.body, /fresh-handoff/);
  assert.equal(chrome.element("handoffBanner").hidden, true);
});

test("chrome client surfaces a superseded reviewer without re-handshaking", async () => {
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    sessionData: { ...defaultSessionData, chromeLoadToken: "old-handoff" },
    beginLoadResponses: [{ ok: false, status: 409, json: async () => ({ status: "superseded" }) }],
  });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.beginRequests.length, 0);
  assert.equal(chrome.artifactBeginRequests.length, 1);
  assert.equal(chrome.element("handoffBanner").hidden, false);
  chrome.element("handoffTakeover").click();
  assert.equal(chrome.reloadCount(), 1);
});

test("stale re-handshake responses cannot overwrite a newer load", async () => {
  /** @type {((value: any) => void) | undefined} */
  let resolveOldHandoff;
  const oldHandoffJson = new Promise((resolve) => {
    resolveOldHandoff = resolve;
  });
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    sessionData: {
      ...defaultSessionData,
      chromeLoadToken: "old-handoff",
      initialArtifactRevision: 1,
      initialArtifactLoadToken: "old-load",
    },
    beginLoadResponses: [
      { ok: false, status: 409, json: async () => ({ status: "no-handoff" }) },
      { ok: false, status: 409, json: async () => ({ status: "no-handoff" }) },
    ],
    handoffResponses: [
      { ok: true, json: async () => oldHandoffJson },
      {
        ok: true,
        json: async () => ({
          chrome_load_token: "new-handoff",
          artifact_revision: 1,
          artifact_load_token: "",
          artifact_load_sequence: 0,
        }),
      },
    ],
  });

  await flushPromises();
  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  await flushPromises();

  assert.ok(resolveOldHandoff);
  resolveOldHandoff({
    chrome_load_token: "old-recovery",
    artifact_revision: 1,
    artifact_load_token: "",
    artifact_load_sequence: 0,
  });
  await flushPromises();
  await flushPromises();

  chrome.element("reloadArtifact").click();
  await flushPromises();
  await flushPromises();

  const lastRequest = chrome.artifactBeginRequests.at(-1);
  assert.match(lastRequest.init.body, /new-handoff/);
  assert.doesNotMatch(lastRequest.init.body, /old-recovery/);
  assert.equal(chrome.element("handoffBanner").hidden, true);
});

test("chrome client replaces queued prompts with the same internal key", async () => {
  const chrome = await createChromeHarness();

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Use plan A", selector: "input#plan-a", tag: "choice", text: "Plan A", _lavishQueueKey: "plan" },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Use plan B", selector: "input#plan-b", tag: "choice", text: "Plan B", _lavishQueueKey: "plan" },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Apply dark mode", selector: "button#dark", tag: "choice", text: "Dark" },
  });

  assert.deepEqual(
    chrome.queued().map((prompt) => prompt.prompt),
    ["Use plan B", "Apply dark mode"],
  );
  assert.match(chrome.element("annotationPills").innerHTML, /Use plan B/);
  assert.doesNotMatch(chrome.element("annotationPills").innerHTML, /Use plan A/);
});

test("chrome client scrolls new chat bubbles into view above queued prompts", async () => {
  const chrome = await createChromeHarness();
  const panelScroll = chrome.element("panelScroll");
  panelScroll.scrollHeight = 1800;

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Review the title", selector: "h1", tag: "annotation", text: "Title" },
  });
  assert.equal(panelScroll.scrollTop, 1800);

  panelScroll.scrollTop = 640;
  chrome.eventSource().listeners.get("agent-reply")({
    data: JSON.stringify({ text: "I updated the title." }),
  });

  const bubble = chrome.element("chatLog").lastAppendedChild;
  assert.equal(bubble.scrolledIntoView.block, "nearest");
  assert.equal(bubble.scrolledIntoView.inline, "nearest");
  assert.equal(panelScroll.scrollTop, 640);
});

function warningPayload(overrides = {}) {
  return {
    id: "w1",
    fingerprint: "w1",
    rule: "page-horizontal-overflow",
    severity: "error",
    status: "open",
    status_label: "Open",
    title: "Page scrolls sideways",
    explanation: "The page is 18px wider than the 720px viewport, so content sits off-screen.",
    selector: "html",
    component: "html",
    axis: "horizontal",
    overflow_px: 18,
    viewport_class: "compact",
    viewport_label: "Tablet / compact",
    viewport_width: 720,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    last_seen_revision: 1,
    queued_at: "",
    queue_attempts: 0,
    active: true,
    selectable: true,
    outstanding: false,
    history: [],
    ...overrides,
  };
}

function diagnosticsHarness(warningsByCall) {
  const posts = [];
  let call = 0;
  return {
    posts,
    fetchImpl: async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      posts.push({ url, body, method: init?.method || "GET" });
      const warnings = warningsByCall[Math.min(call, warningsByCall.length - 1)] || [];
      call += 1;
      return { ok: true, json: async () => ({ warnings, prompt: null }) };
    },
  };
}

test("chrome client posts a completed diagnostic pass and never queues feedback from it", async () => {
  const { posts, fetchImpl } = diagnosticsHarness([[warningPayload()]]);
  const chrome = await createChromeHarness({ fetchImpl });

  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    artifact_revision: 7,
    complete: true,
    target_presence_complete: true,
    viewport_width: 720,
    findings: [{ selector: "html", kind: "page-horizontal-overflow", overflowPx: 18, severity: "error" }],
  });
  await flushPromises();

  const diagnostics = posts.filter((post) => post.url === "/api/abc/layout-diagnostics");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].body.artifact_revision, 7);
  assert.equal(diagnostics[0].body.complete, true);
  assert.equal(diagnostics[0].body.target_presence_complete, true);
  assert.equal(diagnostics[0].body.viewport_width, 720);
  assert.equal(diagnostics[0].body.findings.length, 1);
  // Detection must never touch the prompt queue.
  assert.equal(
    posts.some((post) => post.url === "/api/abc/prompts"),
    false,
  );
  assert.deepEqual(chrome.queued(), []);
});

test("a failed diagnostic pass reports its incompleteness rather than an empty result", async () => {
  const { posts, fetchImpl } = diagnosticsHarness([[warningPayload({ status: "unverified" })]]);
  const chrome = await createChromeHarness({ fetchImpl });

  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: false, viewport_width: 720, findings: [] });
  await flushPromises();

  assert.equal(posts[0].body.complete, false);
  assert.equal(chrome.element("warningsWrap").hidden, false);
  assert.equal(chrome.element("layoutGateOverlay").hidden, false);
});

test("warning-only observations are discarded before they reach the server", async () => {
  const { posts, fetchImpl } = diagnosticsHarness([[]]);
  await createChromeHarness({ fetchImpl });

  const chrome = await createChromeHarness({ fetchImpl });
  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    complete: true,
    viewport_width: 720,
    findings: [
      { selector: ".card", kind: "clipped-text", overflowPx: 2, severity: "warning" },
      { selector: ".unproven", kind: "clipped-text", overflowPx: 200 },
    ],
  });
  await flushPromises();

  assert.deepEqual(posts.at(-1).body.findings, []);
});

test("the warning button hides at zero and shows a deduplicated unresolved count", async () => {
  const chrome = await createChromeHarness();

  assert.equal(chrome.element("warningsWrap").hidden, true, "no button without unresolved work");

  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload(), warningPayload({ id: "w2", selector: "p" })] }),
  });

  assert.equal(chrome.element("warningsWrap").hidden, false);
  assert.equal(chrome.element("warningsCount").textContent, "2");
  assert.equal(chrome.element("warningsButton")["aria-label"], "2 unresolved layout issues");
  assert.equal(chrome.warningRows().length, 2);

  // The same warnings arriving again must not inflate anything.
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload(), warningPayload({ id: "w2", selector: "p" })] }),
  });
  assert.equal(chrome.element("warningsCount").textContent, "2");
  assert.equal(chrome.warningRows().length, 2);
});

test("resolved warnings drop out of the active count and hide the button", async () => {
  const chrome = await createChromeHarness();
  const source = chrome.eventSource().listeners.get("layout-warnings");

  source({ data: JSON.stringify({ warnings: [warningPayload()] }) });
  assert.equal(chrome.element("warningsWrap").hidden, false);

  source({
    data: JSON.stringify({ warnings: [warningPayload({ status: "resolved", active: false, selectable: false })] }),
  });
  assert.equal(chrome.element("warningsWrap").hidden, true);
  assert.equal(chrome.element("warningsCount").textContent, "0");
});

test("nothing is selected by default and Select all is an explicit action", async () => {
  const chrome = await createChromeHarness();
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload(), warningPayload({ id: "w2" })] }),
  });

  assert.equal(chrome.element("warningsSelectAll").checked, false);
  assert.equal(chrome.element("warningsSelected").textContent, "None selected");
  assert.equal(chrome.element("warningsQueueButton").disabled, true);
  for (const row of chrome.warningRows()) {
    assert.equal(row.children[0].checked, false);
  }

  chrome.element("warningsSelectAll").checked = true;
  chrome.element("warningsSelectAll").onchange();
  assert.equal(chrome.element("warningsSelected").textContent, "2 selected");
  assert.equal(chrome.element("warningsQueueButton").disabled, false);
});

test("queueing a selected subset produces exactly one ordinary prompt with only those warnings", async () => {
  const posts = [];
  const queuedWarnings = [
    warningPayload({ status: "queued", status_label: "Queued for fix", selectable: false, outstanding: true }),
    warningPayload({ id: "w2", selector: "p" }),
  ];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          queued_count: 1,
          warnings: queuedWarnings,
          prompt: {
            prompt: "Fix this layout issue the browser detected in this artifact:\n1. [w1] ...",
            text: "Layout issue: 1 selected",
            target: { type: "layout-warnings", warnings: [{ id: "w1", rule: "page-horizontal-overflow" }] },
          },
        }),
      };
    },
  });
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload(), warningPayload({ id: "w2", selector: "p" })] }),
  });

  const [first] = chrome.warningRows();
  first.children[0].checked = true;
  first.children[0].dispatch("change");
  assert.equal(chrome.element("warningsSelected").textContent, "1 selected");

  await chrome.element("warningsQueueButton").onclick();
  await flushPromises();

  const queueCall = posts.find((post) => post.url === "/api/abc/layout-warnings/queue");
  assert.deepEqual(queueCall.body, { ids: ["w1"] });

  const queued = chrome.queued();
  assert.equal(queued.length, 1, "one ordinary queued prompt");
  assert.equal(queued[0].tag, "layout-warnings");
  assert.equal(queued[0].target.warnings.length, 1);
  assert.equal(queued[0].target.warnings[0].id, "w1");

  // Queueing does not clear the warning; it stays counted and becomes unselectable.
  assert.equal(chrome.element("warningsCount").textContent, "2");
  assert.equal(chrome.warningRows()[0].children[0].disabled, true);
  assert.equal(chrome.warningRows()[0].children[1].children.at(-1).children.at(-1).disabled, true);
  assert.equal(chrome.warningRows()[0].children[1].children[2].children[1].textContent, "Queued for send");
  assert.equal(chrome.element("warningsSelected").textContent, "None selected");
});

test("a stale queued layout prompt remains available for user re-decision", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/layout-warnings/queue")) {
        return {
          ok: true,
          json: async () => ({
            queued_count: 1,
            warnings: [warningPayload()],
            prompt: {
              prompt: "Fix this layout issue",
              text: "Layout issue: 1 selected",
              target: { type: "layout-warnings", artifact_revision: 1, warnings: [{ id: "w1" }] },
            },
          }),
        };
      }
      if (url.endsWith("/prompts")) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ warnings: [warningPayload({ status: "recurring", status_label: "Still present" })] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload()] }),
  });

  const [row] = chrome.warningRows();
  row.children[0].checked = true;
  row.children[0].dispatch("change");
  await chrome.element("warningsQueueButton").onclick();
  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "" });
  await flushPromises();

  assert.ok(posts.some((post) => post.url === "/api/abc/prompts"));
  assert.equal(chrome.queued().length, 1);
  assert.equal(chrome.warningRows()[0].children[1].children[2].children[1].textContent, "Queued for send");
});

test("dismissing a warning asks the server and never clears it locally on failure", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return { ok: false, json: async () => ({}) };
    },
  });
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload()] }),
  });

  const [row] = chrome.warningRows();
  const dismiss = row.children[1].children.at(-1).children.at(-1);
  dismiss.dispatch("click");
  await flushPromises();

  assert.ok(posts.some((post) => post.url === "/api/abc/layout-warnings/dismiss" && post.body.id === "w1"));
  assert.equal(chrome.element("warningsCount").textContent, "1", "a failed dismissal must not look like a resolution");
});

test("Reveal asks the artifact iframe to highlight the affected element", async () => {
  const chrome = await createChromeHarness();
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload({ selector: "p#copy" })] }),
  });

  const [row] = chrome.warningRows();
  const reveal = row.children[1].children.at(-1).children[0];
  reveal.dispatch("click");

  const revealMessage = chrome.postedToFrame.at(-1);
  assert.equal(revealMessage.type, "lavish:revealElement");
  assert.equal(revealMessage.selector, "p#copy");
});

test("the drawer manages focus and closes on Escape", async () => {
  const chrome = await createChromeHarness();
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload()] }),
  });

  assert.equal(chrome.element("warningsDrawer").hidden, true);
  chrome.element("warningsButton").click();
  assert.equal(chrome.element("warningsDrawer").hidden, false);
  assert.equal(chrome.element("warningsButton")["aria-expanded"], "true");
  assert.equal(chrome.focusLog.at(-1), "warningsSelectAll", "focus moves into the drawer");

  chrome.dispatchDocumentKeydown({ key: "Escape" });
  assert.equal(chrome.element("warningsDrawer").hidden, true);
  assert.equal(chrome.element("warningsButton")["aria-expanded"], "false");
  assert.equal(chrome.focusLog.at(-1), "warningsButton", "focus returns to the trigger");
});

test("a click outside the drawer closes it", async () => {
  const chrome = await createChromeHarness();
  chrome.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload()] }),
  });
  chrome.element("warningsButton").click();
  assert.equal(chrome.element("warningsDrawer").hidden, false);

  chrome.dispatchDocumentMousedown(chrome.element("chatInput"));
  assert.equal(chrome.element("warningsDrawer").hidden, true);
});

test("warning state and selection survive a chrome reload of the same session", async () => {
  const first = await createChromeHarness();
  first.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload(), warningPayload({ id: "w2" })] }),
  });
  const [row] = first.warningRows();
  row.children[0].checked = true;
  row.children[0].dispatch("change");
  assert.equal(first.element("warningsSelected").textContent, "1 selected");

  // A browser refresh re-bootstraps from the server, and the chrome's own selection is restored
  // from per-session storage.
  const reloaded = await createChromeHarness({
    storage: first.storage,
    sessionData: {
      key: "abc",
      file: "/tmp/artifact.html",
      modeToggleHotkeyKey: "i",
      initialLayoutWarnings: [warningPayload(), warningPayload({ id: "w2" })],
    },
  });
  assert.equal(reloaded.element("warningsCount").textContent, "2");
  assert.equal(reloaded.element("warningsSelected").textContent, "1 selected");
});

test("warning state does not leak across review sessions", async () => {
  const first = await createChromeHarness();
  first.eventSource().listeners.get("layout-warnings")({
    data: JSON.stringify({ warnings: [warningPayload()] }),
  });
  const [row] = first.warningRows();
  row.children[0].checked = true;
  row.children[0].dispatch("change");

  const other = await createChromeHarness({
    storage: first.storage,
    sessionData: { key: "zzz", file: "/tmp/other.html", modeToggleHotkeyKey: "i" },
  });
  assert.equal(other.element("warningsWrap").hidden, true);
  assert.equal(other.element("warningsSelected").textContent, "None selected");
});

test("chrome client surfaces export warnings from the server response", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          if (name.toLowerCase() === "x-lavish-export-warning-count") return "1";
          return null;
        },
      },
      blob: async () => ({}),
    }),
  });

  await chrome.element("exportArtifact").onclick();
  await flushPromises();

  assert.equal(chrome.element("exportArtifact").querySelector("span").textContent, "Exported with 1 unresolved asset");
});

test("chrome client surfaces export notices from the server response", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          if (name.toLowerCase() === "x-lavish-export-warning-count") return "0";
          if (name.toLowerCase() === "x-lavish-export-notice-count") return "1";
          return null;
        },
      },
      blob: async () => ({}),
    }),
  });

  await chrome.element("exportArtifact").onclick();
  await flushPromises();

  assert.equal(chrome.element("exportArtifact").querySelector("span").textContent, "Exported with 1 notice");
});

test("chrome client includes export notices alongside unresolved assets", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          if (name.toLowerCase() === "x-lavish-export-warning-count") return "2";
          if (name.toLowerCase() === "x-lavish-export-notice-count") return "1";
          return null;
        },
      },
      blob: async () => ({}),
    }),
  });

  await chrome.element("exportArtifact").onclick();
  await flushPromises();

  assert.equal(
    chrome.element("exportArtifact").querySelector("span").textContent,
    "Exported with 2 unresolved assets and 1 notice",
  );
});

test("chrome client surfaces share warnings from the server response", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        url: "https://abc123.ht-ml.app/",
        update_key: "uk_secret",
        warnings: [
          { kind: "load-failed", ref: "missing.png" },
          { kind: "csp-meta", ref: "script-src 'self'" },
        ],
        unresolved_local_assets: [{ kind: "load-failed", ref: "missing.png" }],
        notices: [{ kind: "csp-meta", ref: "script-src 'self'" }],
      }),
    }),
  });
  const submit = chrome.element("shareForm").listeners.get("submit");
  assert.equal(typeof submit, "function");

  await submit({ preventDefault() {} });
  await flushPromises();

  assert.equal(chrome.element("shareStatus").textContent, "Published with 1 unresolved local asset and 1 notice.");
  assert.equal(chrome.element("shareResult").hidden, false);
});

test("chrome client does not count share notices as unresolved assets", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        url: "https://abc123.ht-ml.app/",
        update_key: "uk_secret",
        warnings: [{ kind: "csp-meta", ref: "script-src 'self'" }],
        notices: [{ kind: "csp-meta", ref: "script-src 'self'" }],
      }),
    }),
  });
  const submit = chrome.element("shareForm").listeners.get("submit");
  assert.equal(typeof submit, "function");

  await submit({ preventDefault() {} });
  await flushPromises();

  assert.equal(chrome.element("shareStatus").textContent, "Published with 1 notice.");
  assert.equal(chrome.element("shareResult").hidden, false);
});

test("chrome client clears stale share passwords when opening a fresh dialog", async () => {
  const chrome = await createChromeHarness();

  chrome.element("sharePassword").value = "old-password";
  chrome.element("shareArtifact").onclick();

  assert.equal(chrome.element("sharePassword").value, "");
});

test("chrome client preserves share passwords during an in-dialog retry", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: false,
      json: async () => ({ error: "publish failed" }),
    }),
  });

  chrome.element("shareArtifact").onclick();
  chrome.element("sharePassword").value = "pw";
  const submit = chrome.element("shareForm").listeners.get("submit");
  assert.equal(typeof submit, "function");

  await submit({ preventDefault() {} });
  await flushPromises();

  assert.equal(chrome.element("sharePassword").value, "pw");
  assert.equal(chrome.element("shareStatus").textContent, "publish failed");
});

test("chrome client says password-protected shares also require the password", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        url: "https://abc123.ht-ml.app/",
        update_key: "uk_secret",
      }),
    }),
  });
  chrome.element("sharePassword").value = "pw";
  const submit = chrome.element("shareForm").listeners.get("submit");
  assert.equal(typeof submit, "function");

  await submit({ preventDefault() {} });
  await flushPromises();

  assert.equal(
    chrome.element("shareStatus").textContent,
    "Published. This page is PASSWORD-PROTECTED; viewers also need the password.",
  );
});

test("chrome client treats a whitespace-only share password as public", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (_url, init) => {
      posts.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          url: "https://abc123.ht-ml.app/",
          update_key: "uk_secret",
        }),
      };
    },
  });
  chrome.element("sharePassword").value = "   ";
  const submit = chrome.element("shareForm").listeners.get("submit");
  assert.equal(typeof submit, "function");

  await submit({ preventDefault() {} });
  await flushPromises();

  assert.deepEqual(posts, [{}]);
  assert.equal(chrome.element("shareStatus").textContent, "Published. Anyone with the link can view this page.");
});

test("chrome client registers message listener before loading the artifact iframe", async () => {
  const chrome = await createChromeHarness({ artifactSrc: "/artifact/abc/index.html" });

  assert.equal(chrome.srcLoads.length, 1);
  assert.match(chrome.srcLoads[0].src, /^\/artifact\/abc\/index\.html\?artifact_revision=\d+&artifact_load_token=/);
  assert.equal(chrome.srcLoads[0].hadMessageListener, true);
});

test("the layout gate reveals after a completed pass with no findings", async () => {
  const { posts, fetchImpl } = diagnosticsHarness([[]]);
  const chrome = await createChromeHarness({ fetchImpl });

  assert.equal(chrome.element("layoutGateOverlay").hidden, false);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), true);

  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, viewport_width: 720, findings: [] });
  await flushPromises();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);
  assert.equal(chrome.element("layoutIssueBanner").hidden, true);
  assert.equal(posts[0].url, "/api/abc/layout-diagnostics");
  assert.deepEqual(posts[0].body.findings, []);
});

// The gate used to hold the artifact hostage until an agent repaired the finding. Triage is the
// user's now, so a completed pass always reveals and hands the result to the inbox.
test("the layout gate reveals on severe findings and points at the inbox instead of holding", async () => {
  const { fetchImpl } = diagnosticsHarness([[warningPayload()]]);
  const chrome = await createChromeHarness({ fetchImpl });

  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    complete: true,
    viewport_width: 720,
    findings: [{ selector: "html", kind: "page-horizontal-overflow", overflowPx: 18, severity: "error" }],
  });
  await flushPromises();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true, "the user sees the artifact");
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);
  assert.equal(chrome.element("layoutIssueBanner").hidden, false);
  assert.equal(chrome.element("warningsWrap").hidden, false);
});

test("opening the drawer acknowledges the issue banner", async () => {
  const { fetchImpl } = diagnosticsHarness([[warningPayload()]]);
  const chrome = await createChromeHarness({ fetchImpl });

  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    complete: true,
    viewport_width: 720,
    findings: [{ selector: "html", kind: "page-horizontal-overflow", overflowPx: 18, severity: "error" }],
  });
  await flushPromises();
  assert.equal(chrome.element("layoutIssueBanner").hidden, false);

  chrome.element("warningsButton").click();
  assert.equal(chrome.element("layoutIssueBanner").hidden, true);
  assert.equal(chrome.element("warningsCount").textContent, "1", "the badge stays as the standing signal");
});

test("layout gate timeout fails open without an issue banner when no result arrives", async () => {
  const chrome = await createChromeHarness({
    sessionData: { key: "abc", file: "/tmp/artifact.html", layoutGateMaxHoldMs: 25 },
  });

  chrome.runTimers(25);

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);
  assert.equal(chrome.element("layoutIssueBanner").hidden, true);
});

test("layout gate re-arms on reload and still reveals on the next completed pass", async () => {
  const { fetchImpl } = diagnosticsHarness([[], [warningPayload()]]);
  const chrome = await createChromeHarness({
    fetchImpl,
    sessionData: { key: "abc", file: "/tmp/artifact.html", layoutGateMaxHoldMs: 25 },
  });

  chrome.runTimers(25);
  assert.equal(chrome.element("layoutGateOverlay").hidden, true);

  chrome.eventSource().listeners.get("reload")();
  assert.equal(chrome.element("layoutGateOverlay").hidden, false);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), true);

  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    complete: true,
    viewport_width: 720,
    findings: [{ selector: "html", kind: "page-horizontal-overflow", overflowPx: 18, severity: "error" }],
  });
  await flushPromises();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
});

test("a stale prior-document diagnostic cannot reveal the new gate or clear its probe", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url === "/api/abc/layout-diagnostics") {
        return { ok: true, json: async () => ({ status: "stale", warnings: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    sessionData: { key: "abc", file: "/tmp/artifact.html", layoutGateMaxHoldMs: 25 },
    artifactSrc: "/artifact/abc/index.html",
  });

  const oldToken = chrome.artifactLoadToken();
  chrome.runTimers(25);
  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  chrome.sendFrameMessage({
    artifact_load_token: oldToken,
    type: "lavish:layoutDiagnostics",
    artifact_revision: 1,
    complete: true,
    viewport_width: 720,
    findings: [],
  });
  await flushPromises();

  assert.equal(
    posts.some((post) => post.url === "/api/abc/layout-diagnostics"),
    false,
  );
  assert.equal(chrome.element("layoutGateOverlay").hidden, false);
  chrome.frame.dispatch("load");
  chrome.sendFrameMessage({
    artifact_load_token: oldToken,
    type: "lavish:layoutDiagnostics",
    artifact_revision: 1,
    complete: true,
    viewport_width: 720,
    findings: [],
  });
  await flushPromises();
  chrome.runTimers(8000);
  await flushPromises();
  assert.ok(posts.some((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")));
});

test("a failed begin-load keeps the previous frame until a retry succeeds", async () => {
  const beginLoadResponses = [];
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    beginLoadResponses,
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    },
  });

  const previousSrc = chrome.frame.src;
  beginLoadResponses.push(
    { ok: false, status: 503 },
    { ok: true, json: async () => ({ artifact_revision: 2, artifact_load_token: "retry-load" }) },
  );
  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  assert.equal(chrome.frame.src, previousSrc);

  chrome.runTimers(100);
  await flushPromises();
  assert.match(chrome.frame.src, /artifact_load_token=retry-load/);
  assert.equal(
    posts.some((post) => post.url === "/api/abc/artifact-failures"),
    false,
  );
});

test("exhausted begin-load retries preserve the previous frame without waking the agent", async () => {
  const beginLoadResponses = [];
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    beginLoadResponses,
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    },
  });

  const previousSrc = chrome.frame.src;
  const previousToken = chrome.artifactLoadToken();
  beginLoadResponses.push({ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 503 });
  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  chrome.runTimers(100);
  await flushPromises();
  chrome.runTimers(300);
  await flushPromises();

  assert.equal(chrome.frame.src, previousSrc);
  assert.equal(chrome.artifactLoadToken(), previousToken);
  assert.equal(
    posts.some((post) => post.url === "/api/abc/artifact-failures"),
    false,
  );
});

test("a current load token accepts artifact messages before the frame load event", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    },
  });

  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  const currentToken = chrome.artifactLoadToken();
  chrome.sendFrameMessage({
    artifact_load_token: currentToken,
    type: "lavish:artifactAssetFailure",
    detail: "current asset before load",
  });
  await flushPromises();

  assert.equal(posts.filter((post) => post.url === "/api/abc/artifact-failures").length, 1);
  chrome.frame.dispatch("load");
});

test("a pre-load diagnostic silences the probe even while its response is delayed", async () => {
  const posts = [];
  /** @type {(() => void) | undefined} */
  let releaseDiagnostic;
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url === "/api/abc/layout-diagnostics") {
        return new Promise((resolve) => {
          releaseDiagnostic = () => resolve({ ok: true, json: async () => ({ warnings: [] }) });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  });

  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, findings: [] });
  await flushPromises();
  chrome.frame.dispatch("load");
  chrome.runTimers(8000);

  assert.equal(
    posts.some((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")),
    false,
  );
  assert.ok(releaseDiagnostic);
  releaseDiagnostic();
  await flushPromises();
});

test("stale artifact messages are ignored until the current frame load", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    },
  });

  const oldToken = chrome.artifactLoadToken();
  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  chrome.sendFrameMessage({
    artifact_load_token: oldToken,
    type: "lavish:reviewState",
    state: { card: { selector: "h1", text: "stale" } },
  });
  chrome.sendFrameMessage({ artifact_load_token: oldToken, type: "lavish:scroll", x: 8, y: 44 });
  chrome.sendFrameMessage({
    artifact_load_token: oldToken,
    type: "lavish:artifactAssetFailure",
    detail: "stale asset",
  });
  await flushPromises();

  assert.equal(
    posts.some((post) => post.url === "/api/abc/artifact-failures"),
    false,
  );
  chrome.frame.dispatch("load");
  assert.equal(
    chrome.postedToFrame.some((message) => message.type === "lavish:restoreReviewState"),
    false,
  );
  const restoredScroll = chrome.postedToFrame.filter((message) => message.type === "lavish:restoreScroll").at(-1);
  assert.equal(restoredScroll.x, 0);
  assert.equal(restoredScroll.y, 0);

  chrome.sendFrameMessage({ type: "lavish:artifactAssetFailure", detail: "current asset" });
  await flushPromises();
  assert.equal(posts.filter((post) => post.url === "/api/abc/artifact-failures").length, 1);
});

test("a delayed diagnostic response does not delay silencing the artifact probe", async () => {
  const posts = [];
  /** @type {(() => void) | undefined} */
  let releaseDiagnostic;
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url === "/api/abc/layout-diagnostics") {
        return new Promise((resolve) => {
          releaseDiagnostic = () => resolve({ ok: true, json: async () => ({ warnings: [] }) });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  });

  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, viewport_width: 1440, findings: [] });
  await flushPromises();
  chrome.runTimers(8000);
  await flushPromises();

  assert.equal(
    posts.some((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")),
    false,
  );
  assert.ok(releaseDiagnostic);
  releaseDiagnostic();
  await flushPromises();
  assert.equal(
    posts.some((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")),
    false,
  );
});

test("a stale artifact probe cannot report failure after a reload", async () => {
  const posts = [];
  /** @type {(() => void) | undefined} */
  let releaseProbe;
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("/artifact/abc/index.html?") && String(url).includes("probe=1")) {
        return new Promise((resolve) => {
          releaseProbe = () => resolve({ ok: false, status: 503 });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  });

  chrome.runTimers(8000);
  await flushPromises();
  assert.equal(
    posts.filter((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")).length,
    1,
  );

  chrome.eventSource().listeners.get("reload")();
  await flushPromises();
  assert.ok(releaseProbe);
  releaseProbe();
  await flushPromises();

  assert.equal(
    posts.some((post) => post.url === "/api/abc/artifact-failures"),
    false,
  );
});

test("a delayed older diagnostic response cannot repaint the inbox", async () => {
  const posts = [];
  const releases = [];
  const chrome = await createChromeHarness({
    fetchImpl: (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url !== "/api/abc/layout-diagnostics") return Promise.resolve({ ok: true, json: async () => ({}) });
      const requestIndex = releases.length;
      return new Promise((resolve) => {
        releases.push(() =>
          resolve({
            ok: true,
            json: async () => ({ warnings: [warningPayload({ id: requestIndex === 0 ? "old" : "new" })] }),
          }),
        );
      });
    },
  });

  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, findings: [] });
  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, findings: [] });
  releases[1]();
  await flushPromises();
  assert.deepEqual(
    chrome.warningRows().map((row) => row.dataset.warningId),
    ["new"],
  );

  releases[0]();
  await flushPromises();
  assert.deepEqual(
    chrome.warningRows().map((row) => row.dataset.warningId),
    ["new"],
  );
  assert.equal(posts.filter((post) => post.url === "/api/abc/layout-diagnostics").length, 2);
});

test("layout gate manual override reveals immediately", async () => {
  const chrome = await createChromeHarness();

  chrome.element("layoutGateAction").onclick();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);
});

test("layout gate manual override stays bypassed on reload", async () => {
  const chrome = await createChromeHarness();

  chrome.element("layoutGateAction").onclick();
  chrome.eventSource().listeners.get("reload")();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);
});

test("layout gate stays skipped when the session disables it", async () => {
  const { fetchImpl } = diagnosticsHarness([[warningPayload()]]);
  const chrome = await createChromeHarness({
    fetchImpl,
    sessionData: { key: "abc", file: "/tmp/artifact.html", layoutGateEnabled: false },
  });

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("body").classList.contains("layout-gate-active"), false);

  chrome.sendFrameMessage({
    type: "lavish:layoutDiagnostics",
    complete: true,
    viewport_width: 720,
    findings: [{ selector: "html", kind: "page-horizontal-overflow", overflowPx: 18, severity: "error" }],
  });
  await flushPromises();

  assert.equal(chrome.element("layoutGateOverlay").hidden, true);
  assert.equal(chrome.element("warningsWrap").hidden, false, "the inbox still surfaces the finding");
});

test("a zero-warning review keeps the top bar unchanged", async () => {
  const { posts, fetchImpl } = diagnosticsHarness([[]]);
  const chrome = await createChromeHarness({ fetchImpl });

  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, viewport_width: 1440, findings: [] });
  await flushPromises();

  assert.equal(chrome.element("warningsWrap").hidden, true);
  assert.equal(chrome.element("layoutIssueBanner").hidden, true);
  assert.equal(
    posts.some((post) => post.url === "/api/abc/prompts"),
    false,
  );
});

test("chrome client strips the internal queue key before posting prompts", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return acknowledgedPromptResponse(init);
    },
  });

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Use plan B", selector: "input#plan-b", tag: "choice", text: "Plan B", _lavishQueueKey: "plan" },
  });
  chrome.element("send").onclick();
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:requestSnapshot");

  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/abc/prompts");
  assert.match(posts[0].body.batchId, /^[A-Za-z0-9_-]+$/);
  delete posts[0].body.batchId;
  assert.deepEqual(posts[0].body, {
    prompts: [{ prompt: "Use plan B", selector: "input#plan-b", tag: "choice", text: "Plan B" }],
    domSnapshot: "uid=1 body",
    reviewIncarnation: "review-incarnation-one",
    endSession: false,
  });
  assert.equal(chrome.queued().length, 0);
});

test("chrome atomically sends six exact-time notes plus one message with explicit acknowledgement", async () => {
  const posts = [];
  /** @type {((value: any) => void) | undefined} */
  let acknowledge;
  const response = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return response;
    },
  });

  const exactTimes = [0.1256789, 12.3456789, 24.6789012, 36.9012345, 48.2345678, 59.9999999];
  for (const currentTime of exactTimes) {
    chrome.sendFrameMessage({
      type: "lavish:queuePrompt",
      prompt: {
        prompt: `Timecoded note at ${currentTime}`,
        selector: "form#commentForm",
        tag: "feedback",
        text: `Note ${currentTime}`,
        target: { type: "video-timecode", currentTime },
      },
    });
  }
  chrome.element("chatInput").value = "General pacing note";
  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
  await flushPromises();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.prompts.length, 7);
  assert.deepEqual(
    posts[0].body.prompts.slice(0, 6).map((prompt) => prompt.target.currentTime),
    exactTimes,
  );
  assert.match(posts[0].body.batchId, /^[A-Za-z0-9_-]+$/);
  assert.equal(chrome.queued().length, 7, "the complete local batch remains until acknowledgement");
  assert.equal(chrome.element("sendStatus").dataset.state, "submitting");
  assert.match(chrome.element("sendStatus").textContent, /Sending 6 timestamped notes \+ 1 message/);

  assert.ok(acknowledge);
  acknowledge({
    ok: true,
    json: async () => ({
      status: "queued",
      batch_id: posts[0].body.batchId,
      review_incarnation: posts[0].body.reviewIncarnation,
      duplicate: false,
      submitted_prompts: 7,
      processed_prompts: 7,
      submitted_timestamped_notes: 6,
      submitted_messages: 1,
      submitted_layout_warnings: 0,
      accepted_prompts: 7,
      timestamped_notes: 6,
      messages: 1,
      deduplicated_layout_warnings: 0,
    }),
  });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.queued().length, 0);
  assert.equal(chrome.element("sendStatus").dataset.state, "success");
  assert.equal(chrome.element("sendStatus").textContent, "Sent 6 timestamped notes + 1 message.");
});

test("chrome freezes prompt and composer identities when Send is clicked before the snapshot returns", async () => {
  const posts = [];
  const storage = new Map();
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          batch_id: body.batchId,
          review_incarnation: body.reviewIncarnation,
          duplicate: false,
          submitted_prompts: body.prompts.length,
          processed_prompts: body.prompts.length,
          submitted_timestamped_notes: body.prompts.filter((prompt) => prompt.target?.type === "video-timecode").length,
          submitted_messages: body.prompts.filter((prompt) => prompt.tag === "message").length,
          submitted_layout_warnings: body.prompts.filter(
            (prompt) => prompt.tag === "layout-warnings" && prompt.target?.type === "layout-warnings",
          ).length,
          accepted_prompts: body.prompts.length,
          timestamped_notes: body.prompts.filter((prompt) => prompt.target?.type === "video-timecode").length,
          messages: body.prompts.filter((prompt) => prompt.tag === "message").length,
          deduplicated_layout_warnings: 0,
        }),
      };
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: {
      prompt: "First exact note",
      tag: "feedback",
      target: { type: "video-timecode", currentTime: 12.3456789 },
    },
  });
  chrome.element("chatInput").value = "Frozen composer message";

  chrome.element("send").onclick();
  const frozen = JSON.parse(storage.get("lavish-axi:pending-batch:abc"));
  assert.equal(frozen.prompts.length, 2, "the batch is durable before the asynchronous snapshot arrives");
  assert.equal(frozen.prompts[1].prompt, "Frozen composer message");

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: {
      prompt: "Queued after Send",
      tag: "feedback",
      target: { type: "video-timecode", currentTime: 19.8765432 },
    },
  });
  chrome.element("chatInput").value = "Typed after Send";
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 1);
  assert.deepEqual(
    posts[0].body.prompts.map((prompt) => prompt.prompt),
    ["First exact note", "Frozen composer message"],
  );
  assert.equal(chrome.queued().length, 1);
  assert.equal(chrome.queued()[0].prompt, "Queued after Send");
  assert.equal(chrome.element("chatInput").value, "Typed after Send");
});

test("chrome submits a frozen batch when the artifact snapshot deadline expires", async () => {
  const posts = [];
  const storage = new Map();
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return acknowledgedPromptResponse(init);
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Persist despite a silent frame", tag: "feedback", selector: "main" },
  });

  chrome.element("send").onclick();
  const request = chrome.postedToFrame.at(-1);
  assert.equal(request.type, "lavish:requestSnapshot");
  assert.match(request.requestId, /^snapshot-/);
  assert.ok(storage.has("lavish-axi:pending-batch:abc"));
  assert.equal(posts.length, 0);

  chrome.runTimers(2_000);
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.domSnapshot, "");
  assert.equal(chrome.queued().length, 0);
  assert.equal(storage.has("lavish-axi:pending-batch:abc"), false);

  chrome.sendFrameMessage({
    type: "lavish:snapshot",
    requestId: request.requestId,
    snapshot: "late stale snapshot",
  });
  await flushPromises();
  assert.equal(posts.length, 1, "a late response cannot resubmit the settled batch");
});

test("Send & End before a snapshot preserves newer composer text in a second batch", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return acknowledgedPromptResponse(init);
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Frozen first note", tag: "feedback", selector: "main" },
  });
  chrome.element("send").onclick();
  const request = chrome.postedToFrame.at(-1);

  chrome.element("chatInput").value = "New message before the snapshot returns";
  chrome.element("sendAndEnd").onclick();
  chrome.sendFrameMessage({
    type: "lavish:snapshot",
    requestId: request.requestId,
    snapshot: "uid=1 main",
  });
  await flushPromises();
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 2);
  assert.deepEqual(
    posts[0].body.prompts.map((prompt) => prompt.prompt),
    ["Frozen first note"],
  );
  assert.equal(posts[0].body.endSession, false);
  assert.deepEqual(
    posts[1].body.prompts.map((prompt) => prompt.prompt),
    ["New message before the snapshot returns"],
  );
  assert.equal(posts[1].body.endSession, true);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("chrome retains the complete batch when a 2xx response lacks a valid exact receipt", async () => {
  for (const json of [async () => ({}), async () => Promise.reject(new SyntaxError("empty JSON"))]) {
    const storage = new Map();
    const chrome = await createChromeHarness({
      storage,
      fetchImpl: async () => ({ ok: true, json }),
    });
    chrome.sendFrameMessage({
      type: "lavish:queuePrompt",
      prompt: {
        prompt: "Never clear without a receipt",
        tag: "feedback",
        target: { type: "video-timecode", currentTime: 7.654321 },
      },
    });

    chrome.element("send").onclick();
    chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
    await flushPromises();
    await flushPromises();

    assert.equal(chrome.queued().length, 1);
    assert.equal(chrome.element("sendStatus").dataset.state, "error");
    assert.match(chrome.element("sendStatus").textContent, /not acknowledged/i);
    assert.ok(storage.has("lavish-axi:pending-batch:abc"));
  }
});

test("chrome rejects terminal receipts that under-deliver timecodes, messages, or ordinary annotations", async () => {
  const cases = [
    {
      prompt: {
        prompt: "Exact-time note",
        tag: "feedback",
        target: { type: "video-timecode", currentTime: 12.3456789 },
      },
      composer: "Freeform message",
      receipt: {
        submitted_prompts: 2,
        processed_prompts: 2,
        submitted_timestamped_notes: 1,
        submitted_messages: 1,
        submitted_layout_warnings: 0,
        accepted_prompts: 0,
        timestamped_notes: 0,
        messages: 0,
        deduplicated_layout_warnings: 0,
      },
    },
    {
      prompt: { prompt: "Ordinary annotation", tag: "feedback", selector: "h1" },
      composer: "",
      receipt: {
        submitted_prompts: 1,
        processed_prompts: 1,
        submitted_timestamped_notes: 0,
        submitted_messages: 0,
        submitted_layout_warnings: 0,
        accepted_prompts: 0,
        timestamped_notes: 0,
        messages: 0,
        deduplicated_layout_warnings: 1,
      },
    },
  ];

  for (const scenario of cases) {
    const storage = new Map();
    const chrome = await createChromeHarness({
      storage,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        return acknowledgedPromptResponse(init, { batch_id: body.batchId, ...scenario.receipt });
      },
    });
    chrome.sendFrameMessage({ type: "lavish:queuePrompt", prompt: scenario.prompt });
    chrome.element("chatInput").value = scenario.composer;
    chrome.element("send").onclick();
    chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
    await flushPromises();
    await flushPromises();

    assert.equal(chrome.element("sendStatus").dataset.state, "error");
    assert.ok(chrome.queued().length >= 1);
    assert.ok(storage.has("lavish-axi:pending-batch:abc"));
  }
});

test("chrome retains a collided batch and rotates its identity for a safe retry", async () => {
  const posts = [];
  const storage = new Map();
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push(body);
      if (posts.length === 1) {
        return { ok: false, status: 409, json: async () => ({ status: "batch-id-reused" }) };
      }
      return acknowledgedPromptResponse(init);
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Preserve this annotation", tag: "feedback", selector: "video" },
  });
  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
  await flushPromises();
  await flushPromises();

  const retained = JSON.parse(storage.get("lavish-axi:pending-batch:abc"));
  assert.equal(chrome.element("sendStatus").dataset.state, "error");
  assert.equal(retained.prompts[0].prompt, "Preserve this annotation");
  assert.notEqual(retained.id, posts[0].batchId);

  chrome.element("send").onclick();
  await flushPromises();
  await flushPromises();
  assert.equal(posts[1].batchId, retained.id);
  assert.equal(chrome.queued().length, 0);
  assert.equal(chrome.element("sendStatus").dataset.state, "success");
});

test("chrome binds a recovered pending batch to its original review incarnation and never rotates it", async () => {
  const storage = new Map();
  const prompt = {
    prompt: "Final note from the prior review",
    tag: "feedback",
    _lavishQueueItemId: "item-prior-review",
  };
  storage.set("lavish-axi:queued:abc", JSON.stringify([prompt]));
  storage.set(
    "lavish-axi:pending-batch:abc",
    JSON.stringify({
      id: "batch-prior-review",
      prompts: [prompt],
      domSnapshot: "uid=1 video",
      endSession: true,
      reviewIncarnation: "review-incarnation-a",
    }),
  );
  const posts = [];
  const chrome = await createChromeHarness({
    storage,
    sessionData: { ...defaultSessionData, reviewIncarnation: "review-incarnation-b" },
    fetchImpl: async (url, init) => {
      posts.push(JSON.parse(init.body));
      return {
        ok: false,
        status: 409,
        json: async () => ({ status: "stale-review-incarnation", review_incarnation: "review-incarnation-b" }),
      };
    },
  });

  chrome.element("send").onclick();
  await flushPromises();
  await flushPromises();

  assert.equal(posts[0].reviewIncarnation, "review-incarnation-a");
  const retained = JSON.parse(storage.get("lavish-axi:pending-batch:abc"));
  assert.equal(retained.id, "batch-prior-review");
  assert.equal(retained.prompts[0].prompt, "Final note from the prior review");
  assert.equal(chrome.element("sendStatus").dataset.state, "error");
  assert.match(chrome.element("sendStatus").textContent, /previous review.*retained/i);
  assert.equal(chrome.element("submissionRecovery").hidden, false);

  await chrome.element("copyRetainedBatch").click();
  assert.deepEqual(JSON.parse(chrome.clipboardWrites.at(-1)), posts[0]);
  assert.match(chrome.element("sendStatus").textContent, /locked and unacknowledged/i);
  assert.match(chrome.element("sendStatus").textContent, /delivery state is unknown/i);
  assert.doesNotMatch(chrome.element("sendStatus").textContent, /unsent/i);

  chrome.element("unlockRetainedBatch").click();
  assert.equal(storage.has("lavish-axi:pending-batch:abc"), false);
  assert.equal(chrome.queued().length, 1);
  assert.equal(chrome.queued()[0].prompt, "Final note from the prior review");
  assert.match(chrome.element("sendStatus").textContent, /unlocked.*may duplicate/i);
});

test("chrome explains receipt capacity and can copy the exact retained batch before reopen", async () => {
  const storage = new Map();
  const exactCurrentTime = 12.3456789;
  /** @type {any} */
  let postedBody;
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      postedBody = JSON.parse(init.body);
      return {
        ok: false,
        status: 507,
        json: async () => ({
          status: "receipt-capacity",
          error: "This review reached its durable retry-receipt budget; reopen it to start a new review.",
        }),
      };
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: {
      prompt: "Preserve this exact frame",
      tag: "feedback",
      target: { type: "video-timecode", currentTime: exactCurrentTime },
    },
  });
  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.element("sendStatus").dataset.state, "error");
  assert.match(chrome.element("sendStatus").textContent, /retry-receipt budget.*retained.*reopen/i);
  assert.equal(chrome.element("submissionRecovery").hidden, false);
  const retainedBeforeCopy = storage.get("lavish-axi:pending-batch:abc");

  await chrome.element("copyRetainedBatch").click();
  const copied = JSON.parse(chrome.clipboardWrites.at(-1));
  assert.deepEqual(copied, postedBody);
  assert.equal(copied.prompts[0].target.currentTime, exactCurrentTime);
  assert.equal(storage.get("lavish-axi:pending-batch:abc"), retainedBeforeCopy);
  assert.equal(chrome.element("submissionRecovery").hidden, false);
  assert.match(chrome.element("sendStatus").textContent, /locked and unacknowledged/i);
  assert.match(chrome.element("sendStatus").textContent, /delivery state is unknown/i);
  assert.doesNotMatch(chrome.element("sendStatus").textContent, /unsent/i);
});

test("chrome accepts a complete terminal-disposition receipt when a layout prompt was already satisfied", async () => {
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          batch_id: body.batchId,
          review_incarnation: body.reviewIncarnation,
          duplicate: false,
          submitted_prompts: 2,
          processed_prompts: 2,
          submitted_timestamped_notes: 0,
          submitted_messages: 1,
          submitted_layout_warnings: 1,
          accepted_prompts: 1,
          timestamped_notes: 0,
          messages: 1,
          deduplicated_layout_warnings: 1,
        }),
      };
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: {
      prompt: "Already queued layout repair",
      tag: "layout-warnings",
      target: { type: "layout-warnings", warnings: [{ id: "existing-warning" }] },
    },
  });
  chrome.element("chatInput").value = "Keep this separate message";

  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.queued().length, 0);
  assert.equal(chrome.element("sendStatus").dataset.state, "success");
  assert.equal(chrome.element("sendStatus").textContent, "Sent 1 message.");
});

test("chrome retains and idempotently retries a whole batch after an unacknowledged error", async () => {
  const posts = [];
  let attempts = 0;
  const storage = new Map();
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      attempts += 1;
      if (attempts === 1) throw new Error("response lost");
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          batch_id: body.batchId,
          review_incarnation: body.reviewIncarnation,
          duplicate: true,
          submitted_prompts: 1,
          processed_prompts: 1,
          submitted_timestamped_notes: 1,
          submitted_messages: 0,
          submitted_layout_warnings: 0,
          accepted_prompts: 1,
          timestamped_notes: 1,
          messages: 0,
          deduplicated_layout_warnings: 0,
        }),
      };
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: {
      prompt: "Keep this frame",
      selector: "video",
      tag: "feedback",
      text: "00:12.345",
      target: { type: "video-timecode", currentTime: 12.345 },
    },
  });

  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 video" });
  await flushPromises();
  await flushPromises();

  assert.equal(chrome.element("sendStatus").dataset.state, "error");
  assert.match(chrome.element("sendStatus").textContent, /not acknowledged/i);
  assert.equal(chrome.queued().length, 1);
  assert.ok(storage.has("lavish-axi:pending-batch:abc"));

  const reloadedChrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      attempts += 1;
      return {
        ok: true,
        json: async () => ({
          status: "queued",
          batch_id: body.batchId,
          review_incarnation: body.reviewIncarnation,
          duplicate: true,
          submitted_prompts: 1,
          processed_prompts: 1,
          submitted_timestamped_notes: 1,
          submitted_messages: 0,
          submitted_layout_warnings: 0,
          accepted_prompts: 1,
          timestamped_notes: 1,
          messages: 0,
          deduplicated_layout_warnings: 0,
        }),
      };
    },
  });
  assert.equal(reloadedChrome.queued().length, 1);
  assert.equal(reloadedChrome.element("sendStatus").dataset.state, "error");

  reloadedChrome.element("send").onclick();
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.batchId, posts[0].body.batchId);
  assert.deepEqual(posts[1].body.prompts, posts[0].body.prompts);
  assert.equal(reloadedChrome.queued().length, 0);
  assert.equal(reloadedChrome.element("sendStatus").dataset.state, "success");
  assert.equal(storage.has("lavish-axi:pending-batch:abc"), false);
});

test("Send & End after an unacknowledged send retries unchanged then serializes the end", async () => {
  const posts = [];
  let attempt = 0;
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      attempt += 1;
      if (attempt === 1) throw new Error("response lost");
      return acknowledgedPromptResponse(init, { duplicate: attempt === 2 });
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Keep the original payload", tag: "feedback", selector: "main" },
  });
  chrome.element("send").onclick();
  const request = chrome.postedToFrame.at(-1);
  chrome.sendFrameMessage({
    type: "lavish:snapshot",
    requestId: request.requestId,
    snapshot: "uid=1 main",
  });
  await flushPromises();
  await flushPromises();

  chrome.element("chatInput").value = "Include this newer message before ending";
  chrome.element("sendAndEnd").onclick();
  await flushPromises();
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 3);
  assert.equal(posts[1].body.batchId, posts[0].body.batchId);
  assert.deepEqual(posts[1].body.prompts, posts[0].body.prompts);
  assert.equal(posts[1].body.endSession, false);
  assert.deepEqual(
    posts[2].body.prompts.map((prompt) => prompt.prompt),
    ["Include this newer message before ending"],
  );
  assert.equal(posts[2].body.endSession, true);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("Send & End after reload preserves a recovered batch and serializes the end", async () => {
  const prompt = {
    prompt: "Recovered unacknowledged feedback",
    tag: "feedback",
    selector: "main",
    _lavishQueueItemId: "item-recovered",
  };
  const storage = new Map([
    ["lavish-axi:queued:abc", JSON.stringify([prompt])],
    [
      "lavish-axi:pending-batch:abc",
      JSON.stringify({
        id: "batch-recovered",
        prompts: [prompt],
        domSnapshot: "uid=1 main",
        endSession: false,
        reviewIncarnation: "review-incarnation-one",
      }),
    ],
  ]);
  const posts = [];
  const chrome = await createChromeHarness({
    storage,
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return acknowledgedPromptResponse(init, { duplicate: posts.length === 1 });
    },
  });

  chrome.element("sendAndEnd").onclick();
  await flushPromises();
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.batchId, "batch-recovered");
  assert.equal(posts[0].body.endSession, false);
  assert.deepEqual(posts[1].body.prompts, []);
  assert.equal(posts[1].body.endSession, true);
  assert.equal(storage.has("lavish-axi:pending-batch:abc"), false);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("chrome send and end carries the end intent with queued prompts", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return acknowledgedPromptResponse(init);
    },
  });

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Ship this", selector: "button#ship", tag: "choice", text: "Ship" },
  });
  chrome.element("sendAndEnd").onclick();
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:requestSnapshot");

  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();
  await flushPromises();

  assert.deepEqual(
    posts.map((post) => post.url),
    ["/api/abc/prompts"],
  );
  assert.match(posts[0].body.batchId, /^[A-Za-z0-9_-]+$/);
  delete posts[0].body.batchId;
  assert.deepEqual(posts[0].body, {
    prompts: [{ prompt: "Ship this", selector: "button#ship", tag: "choice", text: "Ship" }],
    domSnapshot: "uid=1 body",
    reviewIncarnation: "review-incarnation-one",
    endSession: true,
  });
  assert.equal(chrome.queued().length, 0);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("artifact Send & End submits locally queued feedback before ending", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return acknowledgedPromptResponse(init);
    },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Queued inside the artifact", tag: "workflow-gate", selector: "main" },
  });

  chrome.sendFrameMessage({ type: "lavish:sendAndEnd" });
  const request = chrome.postedToFrame.at(-1);
  assert.equal(request.type, "lavish:requestSnapshot");
  chrome.sendFrameMessage({
    type: "lavish:snapshot",
    requestId: request.requestId,
    snapshot: "uid=1 workflow",
  });
  await flushPromises();
  await flushPromises();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.prompts[0].prompt, "Queued inside the artifact");
  assert.equal(posts[0].body.endSession, true);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("artifact Send & End ends directly when no local feedback is queued", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, method: init.method });
      return { ok: true };
    },
  });

  chrome.sendFrameMessage({ type: "lavish:sendAndEnd" });
  await flushPromises();

  assert.deepEqual(posts, [{ url: "/api/abc/end", method: "POST" }]);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("chrome can send and end while presence says working", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return acknowledgedPromptResponse(init);
    },
  });

  chrome.eventSource().listeners.get("agent-presence")({ data: JSON.stringify({ state: "working" }) });
  assert.equal(chrome.element("send").disabled, false);
  assert.equal(chrome.element("sendAndEnd").disabled, false);

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Save this after the prior batch", selector: "main", tag: "feedback", text: "Follow-up" },
  });
  chrome.element("sendAndEnd").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();
  await flushPromises();

  assert.match(posts[0].body.batchId, /^[A-Za-z0-9_-]+$/);
  delete posts[0].body.batchId;
  assert.deepEqual(posts, [
    {
      url: "/api/abc/prompts",
      body: {
        prompts: [
          {
            prompt: "Save this after the prior batch",
            selector: "main",
            tag: "feedback",
            text: "Follow-up",
          },
        ],
        domSnapshot: "uid=1 body",
        reviewIncarnation: "review-incarnation-one",
        endSession: true,
      },
    },
  ]);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("chrome distinguishes the authoritative host queue count from its unsent local queue", async () => {
  const chrome = await createChromeHarness();

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "First", selector: "main", tag: "feedback", text: "First" },
  });
  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Second", selector: "footer", tag: "feedback", text: "Second" },
  });

  let queueState = chrome.postedToFrame.at(-1);
  assert.equal(queueState.type, "lavish:queueState");
  assert.equal(queueState.count, 0);

  chrome.eventSource().listeners.get("queue-state")({ data: JSON.stringify({ count: 6 }) });
  queueState = chrome.postedToFrame.at(-1);
  assert.equal(queueState.type, "lavish:queueState");
  assert.equal(queueState.count, 6);
});

test("chrome send and end with an empty composer nudges instead of ending", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true };
    },
  });
  chrome.element("sendHint").hidden = true;

  chrome.element("sendAndEnd").onclick();
  await flushPromises();

  assert.equal(posts.length, 0);
  assert.equal(chrome.postedToFrame.filter((message) => message.type !== "lavish:queueState").length, 0);
  assert.equal(chrome.element("sendHint").hidden, false);
  assert.equal(chrome.element("chatInput").focused, true);
  assert.equal(chrome.element("chatInput").disabled, false);
});

test("chrome send and end during an in-flight submit still ends after the submit drains the queue", async () => {
  const posts = [];
  let resolveFirstPost = () => {};
  const firstPost = new Promise((resolve) => {
    resolveFirstPost = () => resolve();
  });
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (posts.length === 1) await firstPost;
      return acknowledgedPromptResponse(init);
    },
  });

  chrome.sendFrameMessage({
    type: "lavish:queuePrompt",
    prompt: { prompt: "Ship this", selector: "button#ship", tag: "choice", text: "Ship" },
  });
  chrome.element("send").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();
  assert.equal(posts.length, 1);

  chrome.element("sendAndEnd").onclick();
  chrome.sendFrameMessage({ type: "lavish:snapshot", snapshot: "uid=1 body" });
  await flushPromises();
  assert.equal(posts.length, 1);

  resolveFirstPost();
  await flushPromises();
  await flushPromises();

  assert.deepEqual(
    posts.map((post) => post.url),
    ["/api/abc/prompts", "/api/abc/prompts"],
  );
  assert.match(posts[0].body.batchId, /^[A-Za-z0-9_-]+$/);
  assert.match(posts[1].body.batchId, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(posts[1].body.batchId, posts[0].body.batchId);
  delete posts[0].body.batchId;
  delete posts[1].body.batchId;
  assert.deepEqual(posts[0].body, {
    prompts: [{ prompt: "Ship this", selector: "button#ship", tag: "choice", text: "Ship" }],
    domSnapshot: "uid=1 body",
    reviewIncarnation: "review-incarnation-one",
    endSession: false,
  });
  assert.deepEqual(posts[1].body, {
    prompts: [],
    domSnapshot: "uid=1 body",
    reviewIncarnation: "review-incarnation-one",
    endSession: true,
  });
  assert.equal(chrome.queued().length, 0);
  assert.equal(chrome.element("chatInput").disabled, true);
});

test("Cmd/Ctrl+I toggles annotation mode from the chrome document, regardless of focus", async () => {
  const chrome = await createChromeHarness();

  const metaEvent = chrome.dispatchDocumentKeydown({ key: "i", metaKey: true });
  assert.equal(metaEvent.defaultPrevented, true);
  assert.equal(chrome.element("annotation")["aria-pressed"], "false");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, false);

  const ctrlEvent = chrome.dispatchDocumentKeydown({ key: "I", ctrlKey: true });
  assert.equal(ctrlEvent.defaultPrevented, true);
  assert.equal(chrome.element("annotation")["aria-pressed"], "true");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, true);
});

test("plain 'i' and other modifier combos do not toggle annotation mode", async () => {
  const chrome = await createChromeHarness();
  const framePostCount = () => chrome.postedToFrame.length;
  const before = framePostCount();

  const bareEvent = chrome.dispatchDocumentKeydown({ key: "i" });
  assert.equal(bareEvent.defaultPrevented, false);
  assert.equal(chrome.element("annotation")["aria-pressed"], undefined);

  const shiftEvent = chrome.dispatchDocumentKeydown({ key: "i", shiftKey: true });
  assert.equal(shiftEvent.defaultPrevented, false);

  const ctrlShiftEvent = chrome.dispatchDocumentKeydown({ key: "i", ctrlKey: true, shiftKey: true });
  assert.equal(ctrlShiftEvent.defaultPrevented, false);

  const metaAltEvent = chrome.dispatchDocumentKeydown({ key: "i", metaKey: true, altKey: true });
  assert.equal(metaAltEvent.defaultPrevented, false);

  const otherKeyEvent = chrome.dispatchDocumentKeydown({ key: "s", metaKey: true });
  assert.equal(otherKeyEvent.defaultPrevented, false);

  assert.equal(framePostCount(), before);
});

test("chrome client reads the mode toggle hotkey from the session bootstrap", async () => {
  const chrome = await createChromeHarness({
    sessionData: { key: "abc", file: "/tmp/artifact.html", modeToggleHotkeyKey: "k" },
  });

  const oldHotkeyEvent = chrome.dispatchDocumentKeydown({ key: "i", metaKey: true });
  assert.equal(oldHotkeyEvent.defaultPrevented, false);
  assert.equal(chrome.element("annotation")["aria-pressed"], undefined);

  const bootstrapHotkeyEvent = chrome.dispatchDocumentKeydown({ key: "K", metaKey: true });
  assert.equal(bootstrapHotkeyEvent.defaultPrevented, true);
  assert.equal(chrome.element("annotation")["aria-pressed"], "false");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, false);
});

test("chrome client toggles annotation mode when the artifact SDK requests it via postMessage", async () => {
  const chrome = await createChromeHarness();

  chrome.sendFrameMessage({ type: "lavish:toggleAnnotationMode" });

  assert.equal(chrome.element("annotation")["aria-pressed"], "false");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, false);

  chrome.sendFrameMessage({ type: "lavish:toggleAnnotationMode" });
  assert.equal(chrome.element("annotation")["aria-pressed"], "true");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, true);
});

test("video review sessions start in explore mode and keep the annotation switch available", async () => {
  const chrome = await createChromeHarness({
    sessionData: {
      ...defaultSessionData,
      initialAnnotationMode: false,
      mediaTransportEnabled: true,
    },
  });

  assert.equal(chrome.element("annotation")["aria-pressed"], "false");
  chrome.element("annotation").click();
  assert.equal(chrome.element("annotation")["aria-pressed"], "true");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(chrome.postedToFrame.at(-1).enabled, true);
});

test("chrome forwards video transport keys only when the review opts in", async () => {
  const chrome = await createChromeHarness({
    sessionData: { ...defaultSessionData, mediaTransportEnabled: true },
  });

  const space = chrome.dispatchDocumentKeydown({ key: " ", code: "Space", target: chrome.element("body") });
  assert.equal(space.defaultPrevented, true);
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:mediaTransport");
  assert.equal(chrome.postedToFrame.at(-1).action.type, "toggle");

  const right = chrome.dispatchDocumentKeydown({ key: "ArrowRight", target: chrome.element("body") });
  assert.equal(right.defaultPrevented, true);
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:mediaTransport");
  assert.equal(chrome.postedToFrame.at(-1).action.type, "seek");
  assert.equal(chrome.postedToFrame.at(-1).action.seconds, 5);

  const modified = chrome.dispatchDocumentKeydown({ key: "l", metaKey: true, target: chrome.element("body") });
  assert.equal(modified.defaultPrevented, false);
});

test("chrome never steals video transport keys from text entry controls", async () => {
  const chrome = await createChromeHarness({
    sessionData: { ...defaultSessionData, mediaTransportEnabled: true },
  });
  const textarea = {
    closest(selector) {
      return selector.includes("textarea") ? this : null;
    },
  };
  const before = chrome.postedToFrame.length;

  const event = chrome.dispatchDocumentKeydown({ key: " ", code: "Space", target: textarea });

  assert.equal(event.defaultPrevented, false);
  assert.equal(chrome.postedToFrame.length, before);
});

test("chrome never steals video transport keys from marked or ARIA custom controls", async () => {
  const chrome = await createChromeHarness({
    sessionData: { ...defaultSessionData, mediaTransportEnabled: true },
  });
  const before = chrome.postedToFrame.length;
  for (const marker of ["[data-lavish-action]", "[role='button']", "[role='slider']", "[tabindex]"]) {
    const control = {
      closest(selector) {
        return selector.includes(marker) ? this : null;
      },
    };
    const event = chrome.dispatchDocumentKeydown({ key: " ", code: "Space", target: control });
    assert.equal(event.defaultPrevented, false, marker);
  }
  assert.equal(chrome.postedToFrame.length, before);
});

test("ordinary artifacts preserve native Space scrolling", async () => {
  const chrome = await createChromeHarness();
  const before = chrome.postedToFrame.length;

  const event = chrome.dispatchDocumentKeydown({ key: " ", code: "Space", target: chrome.element("body") });

  assert.equal(event.defaultPrevented, false);
  assert.equal(chrome.postedToFrame.length, before);
});

test("chrome client ignores annotation mode toggles after the session ends", async () => {
  const chrome = await createChromeHarness();

  chrome.dispatchDocumentKeydown({ key: "i", metaKey: true });
  assert.equal(chrome.element("annotation")["aria-pressed"], "false");

  chrome.sendFrameMessage({ type: "lavish:endSession" });
  await flushPromises();
  const afterEndPostCount = chrome.postedToFrame.length;

  chrome.dispatchDocumentKeydown({ key: "i", metaKey: true });
  chrome.sendFrameMessage({ type: "lavish:toggleAnnotationMode" });

  assert.equal(chrome.element("annotation")["aria-pressed"], "false");
  assert.equal(chrome.postedToFrame.length, afterEndPostCount);
});

function whiteboardFetch(url) {
  if (url.includes("/whiteboard-channel")) return { ok: true };
  if (url.includes("/mermaid-sources")) {
    return { ok: true, json: async () => ({ sources: [{ index: 0, source: "flowchart TD; A-->B", hash: "hash" }] }) };
  }
  return { ok: true, json: async () => ({ whiteboard: null }) };
}

async function initializeInlineWhiteboard(chrome, token = "inline-channel") {
  const whiteboard = chrome.createInlineWhiteboard();
  chrome.sendInlineWhiteboardMessage(whiteboard, {
    type: "lavish-whiteboard:ready",
    diagramIndex: 0,
    diagramId: "mermaid-1",
    channelToken: token,
  });
  await flushPromises();
  await flushPromises();
  return whiteboard;
}

test("artifact relays cannot invoke whiteboard persistence", async () => {
  const calls = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return whiteboardFetch(url);
    },
  });

  chrome.sendFrameMessage({
    type: "lavish:whiteboardRelay",
    diagramIndex: 0,
    message: { type: "lavish-whiteboard:save", scene: { elements: [{ id: "forged" }] } },
  });
  await flushPromises();

  assert.equal(calls.length, 0);
  assert.equal(chrome.postedToFrame.filter((message) => message.type !== "lavish:queueState").length, 0);
});

test("unverified whiteboard frames cannot invoke whiteboard persistence", async () => {
  const calls = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return { ok: false };
    },
  });
  const whiteboard = chrome.createInlineWhiteboard();

  chrome.sendInlineWhiteboardMessage(whiteboard, {
    type: "lavish-whiteboard:ready",
    diagramIndex: 0,
    channelToken: "forged",
  });
  await flushPromises();
  chrome.sendInlineWhiteboardMessage(whiteboard, {
    type: "lavish-whiteboard:save",
    diagramIndex: 0,
    channelId: "forged",
    scene: { elements: [{ id: "forged" }] },
  });
  await flushPromises();

  assert.deepEqual(
    calls.map((call) => call.url),
    ["/api/abc/whiteboard-channel"],
  );
  assert.equal(whiteboard.posted.length, 0);
});

test("whiteboard fullscreen waits for the authenticated inline frame to flush", async () => {
  const chrome = await createChromeHarness({ fetchImpl: async (url) => whiteboardFetch(url) });
  const inline = await initializeInlineWhiteboard(chrome);
  const init = inline.posted.at(-1);
  assert.equal(init.type, "lavish-whiteboard:init");
  assert.equal(init.channelId, "inline-channel");

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });

  const prepare = inline.posted.at(-1);
  assert.equal(prepare.type, "lavish-whiteboard:prepareTeardown");
  assert.equal(
    chrome.postedToFrame.some((message) => message.type === "lavish:suspendWhiteboard"),
    false,
  );

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: prepare.flushId,
  });

  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:suspendWhiteboard");
  assert.match(chrome.element("whiteboardFrame").src, /^\/whiteboard-frame\?diagramIndex=0$/);
});

test("whiteboard fullscreen timeout keeps the inline board and exposes retry guidance", async () => {
  const chrome = await createChromeHarness({ fetchImpl: async (url) => whiteboardFetch(url) });
  const inline = await initializeInlineWhiteboard(chrome);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  assert.equal(inline.posted.at(-1).type, "lavish-whiteboard:prepareTeardown");

  chrome.runTimers(1500);
  await flushPromises();

  assert.equal(
    chrome.postedToFrame.some((message) => message.type === "lavish:suspendWhiteboard"),
    false,
  );
  assert.equal(chrome.element("whiteboardOverlay").hidden, false);
  assert.match(chrome.element("whiteboardError").textContent, /still open.*retry/i);
  chrome.element("whiteboardClose").click();
  assert.equal(chrome.element("whiteboardOverlay").hidden, true);
});

test("whiteboard close waits for the authenticated overlay frame to flush", async () => {
  const chrome = await createChromeHarness({ fetchImpl: async (url) => whiteboardFetch(url) });
  const inline = await initializeInlineWhiteboard(chrome);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  const maximizePrepare = inline.posted.at(-1);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: maximizePrepare.flushId,
  });
  chrome.sendWhiteboardMessage({ type: "lavish-whiteboard:ready", diagramIndex: 0, channelToken: "overlay-channel" });
  await flushPromises();
  await flushPromises();

  chrome.element("whiteboardClose").click();
  const closePrepare = chrome.postedToWhiteboard.at(-1);
  assert.equal(closePrepare.type, "lavish-whiteboard:prepareTeardown");
  assert.equal(closePrepare.channelId, "overlay-channel");
  assert.notEqual(chrome.element("whiteboardFrame").src, "about:blank");

  chrome.sendWhiteboardMessage({
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "overlay-channel",
    flushId: closePrepare.flushId,
  });

  assert.equal(chrome.element("whiteboardFrame").src, "about:blank");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:resumeWhiteboard");
});

test("whiteboard close timeout keeps the overlay board and exposes retry guidance", async () => {
  const chrome = await createChromeHarness({ fetchImpl: async (url) => whiteboardFetch(url) });
  const inline = await initializeInlineWhiteboard(chrome);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  const maximizePrepare = inline.posted.at(-1);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: maximizePrepare.flushId,
  });
  chrome.sendWhiteboardMessage({ type: "lavish-whiteboard:ready", diagramIndex: 0, channelToken: "overlay-channel" });
  await flushPromises();
  await flushPromises();
  const overlaySrc = chrome.element("whiteboardFrame").src;

  chrome.element("whiteboardClose").click();
  chrome.runTimers(1500);
  await flushPromises();

  assert.equal(chrome.element("whiteboardFrame").src, overlaySrc);
  assert.equal(chrome.element("whiteboardOverlay").hidden, false);
  assert.match(chrome.element("whiteboardError").textContent, /still open.*retry/i);
});

test("whiteboard fullscreen close accepts the resumed inline frame", async () => {
  const chrome = await createChromeHarness({ fetchImpl: async (url) => whiteboardFetch(url) });
  const inline = await initializeInlineWhiteboard(chrome);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  const maximizePrepare = inline.posted.at(-1);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: maximizePrepare.flushId,
  });
  chrome.sendWhiteboardMessage({ type: "lavish-whiteboard:ready", diagramIndex: 0, channelToken: "overlay-channel" });
  await flushPromises();
  await flushPromises();

  chrome.element("whiteboardClose").click();
  const closePrepare = chrome.postedToWhiteboard.at(-1);
  chrome.sendWhiteboardMessage({
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "overlay-channel",
    flushId: closePrepare.flushId,
  });

  const resumed = chrome.createInlineWhiteboard();
  chrome.sendInlineWhiteboardMessage(resumed, {
    type: "lavish-whiteboard:ready",
    diagramIndex: 0,
    diagramId: "mermaid-1",
    channelToken: "resumed-channel",
  });
  await flushPromises();
  await flushPromises();

  assert.equal(resumed.posted.at(-1).type, "lavish-whiteboard:init");
  assert.equal(resumed.posted.at(-1).channelId, "resumed-channel");
});

test("artifact reload waits for inline whiteboards to flush", async () => {
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url) => whiteboardFetch(url),
  });
  const inline = await initializeInlineWhiteboard(chrome);
  const initialLoadCount = chrome.srcLoads.length;

  chrome.element("reloadArtifact").click();
  const prepare = inline.posted.at(-1);
  assert.equal(prepare.type, "lavish-whiteboard:prepareTeardown");
  assert.equal(chrome.srcLoads.length, initialLoadCount);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: prepare.flushId,
  });
  await flushPromises();

  assert.equal(chrome.srcLoads.length, initialLoadCount + 1);
  assert.match(
    chrome.element("artifact").src,
    /^\/artifact\/abc\/index\.html\?artifact_revision=\d+&artifact_load_token=/,
  );
});

test("artifact reload timeout keeps the current board and exposes retry guidance", async () => {
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url) => whiteboardFetch(url),
  });
  const inline = await initializeInlineWhiteboard(chrome);
  const initialLoadCount = chrome.srcLoads.length;

  chrome.element("reloadArtifact").click();
  assert.equal(inline.posted.at(-1).type, "lavish-whiteboard:prepareTeardown");
  chrome.runTimers(1500);
  await flushPromises();

  assert.equal(chrome.srcLoads.length, initialLoadCount);
  assert.equal(chrome.element("whiteboardOverlay").hidden, false);
  assert.match(chrome.element("whiteboardError").textContent, /still open.*retry/i);
});

test("server restart flushes an authenticated inline whiteboard before reloading", async () => {
  let healthChecks = 0;
  const chrome = await createChromeHarness({
    fetchImpl: async (url) => {
      if (url === "/health") {
        healthChecks += 1;
        if (healthChecks === 1) throw new Error("server is restarting");
        return { ok: true };
      }
      return whiteboardFetch(url);
    },
  });
  const inline = await initializeInlineWhiteboard(chrome);

  const restart = chrome.eventSource().listeners.get("chrome-reload")();
  await flushPromises();
  chrome.runTimers(100);
  await flushPromises();

  const flush = inline.posted.at(-1);
  assert.equal(flush.type, "lavish-whiteboard:flush");
  assert.equal(chrome.reloadCount(), 0);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:flushComplete",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: flush.flushId,
    ok: true,
  });
  await restart;

  assert.equal(chrome.reloadCount(), 1);
});

test("server restart flushes an authenticated overlay before reloading", async () => {
  let healthChecks = 0;
  const chrome = await createChromeHarness({
    fetchImpl: async (url) => {
      if (url === "/health") {
        healthChecks += 1;
        if (healthChecks === 1) throw new Error("server is restarting");
        return { ok: true };
      }
      return whiteboardFetch(url);
    },
  });
  const inline = await initializeInlineWhiteboard(chrome);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  const teardown = inline.posted.at(-1);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: teardown.flushId,
  });
  chrome.sendWhiteboardMessage({ type: "lavish-whiteboard:ready", diagramIndex: 0, channelToken: "overlay-channel" });
  await flushPromises();
  await flushPromises();

  const restart = chrome.eventSource().listeners.get("chrome-reload")();
  await flushPromises();
  chrome.runTimers(100);
  await flushPromises();

  const flush = chrome.postedToWhiteboard.at(-1);
  assert.equal(flush.type, "lavish-whiteboard:flush");
  assert.equal(chrome.reloadCount(), 0);

  chrome.sendWhiteboardMessage({
    type: "lavish-whiteboard:flushComplete",
    diagramIndex: 0,
    channelId: "overlay-channel",
    flushId: flush.flushId,
    ok: true,
  });
  await restart;

  assert.equal(chrome.reloadCount(), 1);
});

test("server restart bounds the wait for a whiteboard flush", async () => {
  let healthChecks = 0;
  const chrome = await createChromeHarness({
    fetchImpl: async (url) => {
      if (url === "/health") {
        healthChecks += 1;
        if (healthChecks === 1) throw new Error("server is restarting");
        return { ok: true };
      }
      return whiteboardFetch(url);
    },
  });
  const inline = await initializeInlineWhiteboard(chrome);

  const restart = chrome.eventSource().listeners.get("chrome-reload")();
  await flushPromises();
  chrome.runTimers(100);
  await flushPromises();

  assert.equal(inline.posted.at(-1).type, "lavish-whiteboard:flush");
  chrome.runTimers(1500);
  await restart;

  assert.equal(chrome.reloadCount(), 1);
});

test("whiteboard close stays responsive while overlay initialization is pending", async () => {
  let delayOverlaySources = false;
  /** @type {(() => void) | undefined} */
  let releaseOverlaySources;
  const chrome = await createChromeHarness({
    fetchImpl: async (url) => {
      if (delayOverlaySources && url.includes("/mermaid-sources")) {
        await new Promise((resolve) => {
          releaseOverlaySources = () => resolve();
        });
      }
      return whiteboardFetch(url);
    },
  });
  const inline = await initializeInlineWhiteboard(chrome);

  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:maximize",
    diagramIndex: 0,
    channelId: "inline-channel",
  });
  const maximizePrepare = inline.posted.at(-1);
  chrome.sendInlineWhiteboardMessage(inline, {
    type: "lavish-whiteboard:teardownReady",
    diagramIndex: 0,
    channelId: "inline-channel",
    flushId: maximizePrepare.flushId,
  });

  delayOverlaySources = true;
  chrome.sendWhiteboardMessage({ type: "lavish-whiteboard:ready", diagramIndex: 0, channelToken: "overlay-channel" });
  await flushPromises();
  chrome.element("whiteboardClose").click();

  assert.equal(chrome.element("whiteboardFrame").src, "about:blank");
  assert.equal(chrome.postedToFrame.at(-1).type, "lavish:resumeWhiteboard");
  assert.equal(
    chrome.postedToWhiteboard.some((message) => message.type === "lavish-whiteboard:prepareTeardown"),
    false,
  );

  releaseOverlaySources?.();
  await flushPromises();
});

test("a silent artifact is probed for a fatal failure, and a talking one is not", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("/artifact/abc/index.html?") && String(url).includes("probe=1"))
        return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    },
  });

  chrome.element("artifact").dispatch("load");
  chrome.runTimers(8000);
  await flushPromises();
  await flushPromises();

  const failure = posts.find((post) => post.url === "/api/abc/artifact-failures");
  assert.equal(failure.body.failures[0].kind, "artifact-unavailable");
  assert.match(failure.body.failures[0].detail, /HTTP 404/);
});

test("an artifact that reports diagnostics is never probed as unavailable", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    artifactSrc: "/artifact/abc/index.html",
    fetchImpl: async (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ warnings: [] }) };
    },
  });

  chrome.element("artifact").dispatch("load");
  chrome.sendFrameMessage({ type: "lavish:layoutDiagnostics", complete: true, viewport_width: 1440, findings: [] });
  await flushPromises();
  chrome.runTimers(8000);
  await flushPromises();

  assert.equal(
    posts.some((post) => post.url.includes("/artifact/abc/index.html?") && post.url.includes("probe=1")),
    false,
    "a healthy artifact costs exactly one document request",
  );
  assert.equal(
    posts.some((post) => post.url === "/api/abc/artifact-failures"),
    false,
  );
});

test("a local asset failure inside the artifact is reported as a fatal artifact failure", async () => {
  const posts = [];
  const chrome = await createChromeHarness({
    fetchImpl: async (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    },
  });

  chrome.sendFrameMessage({
    type: "lavish:artifactAssetFailure",
    detail: "<img> could not load /artifact/abc/logo.png",
  });
  await flushPromises();

  const failure = posts.find((post) => post.url === "/api/abc/artifact-failures");
  assert.equal(failure.body.failures[0].kind, "artifact-asset-unavailable");
  assert.match(failure.body.failures[0].detail, /logo\.png/);
});
