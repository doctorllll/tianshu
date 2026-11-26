/**
 * dsh-acp: the DeepSeek Harness desktop App as an ACP agent (stdio JSON-RPC), for Tianshu and other ACP clients.
 *
 * Turns run in the App itself, through the API caller path DSH documents for its Host (dsh-client-connection
 * README, "Browser authentication and request trust"): the App prints its Host URL with a launch token on stdout,
 * `GET /connect?token=…` exchanges the token for an API Peer and its Cookie, unary calls are
 * `POST /api/<namespace>/<method>`, and streams share the `/api/remote.mux` WebSocket. A session's model, mode
 * (agent preset), plugins, hooks, persona and plan are therefore the App's own, and the session is one of the
 * App's, in its sidebar.
 *
 * The launch token only reaches the App's stdout, so the App has to be opened by this bridge
 * (`open -a … --stdout`); an App opened from the Dock cannot be reached until it is quit. The token stays under
 * ~/.local/state/dsh-acp/app (0700). The App's cookie-signing secret (~/.dsh/.credentials.yaml) is never read.
 *
 * A new conversation keeps a provisional id until its first prompt creates the App session, so probing for
 * models leaves no blank sessions in the App; the mapping lives in ~/.local/state/dsh-acp/sessions.json.
 *
 * Environment: DSH_APP (default /Applications/DeepSeek Harness.app).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const APP = process.env.DSH_APP || "/Applications/DeepSeek Harness.app";
const STATE_DIR = path.join(os.homedir(), ".local", "state", "dsh-acp");
const STATE = path.join(STATE_DIR, "sessions.json");
const APP_DIR = path.join(STATE_DIR, "app");
const APP_LOG = path.join(APP_DIR, "stdout.log");
const LAUNCH_LOCK = path.join(APP_DIR, "launch.lock");
const CATALOG_CACHE = path.join(STATE_DIR, "catalog.json");
const LAUNCH_TIMEOUT_MS = 90_000;
const LAUNCH_TRIES = 3;
// An App that `open` started is up within a second; one not running this long after is gone without its address.
const LAUNCH_GONE_MS = 4_000;
const HISTORY_PAGE = 400;
const HISTORY_LIMIT = 4000;
// Effort and mode names as the client already translates them, as the other bridges send them.
const EFFORT_LABELS = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};
const PRESET_LABELS = { standard: "标准", ptc: "PTC", minimal: "精简", cordis: "Cordis" };

class UserError extends Error {}

// ------------------------------------------------------------------ ACP over stdio
const log = (...a) => process.stderr.write(`[dsh-acp] ${a.join(" ")}\n`);
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const update = (sessionId, upd) =>
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: upd } });
const textChunk = (kind, text) => ({ sessionUpdate: kind, content: { type: "text", text } });

// ------------------------------------------------------------------ bridge state
const SESS = new Map(); // acp id -> { dsh, cwd, model, effort, preset, known, turn }

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function remember(acpId, fields) {
  const st = loadState();
  st[acpId] = { ...(st[acpId] || {}), ...fields };
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${STATE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, STATE);
}

function resolve(acpId, cwd) {
  let s = SESS.get(acpId);
  if (!s) {
    const hit = loadState()[acpId] || {};
    s = {
      dsh: hit.dsh || (acpId.startsWith("session-") ? acpId : null),
      cwd: hit.cwd || cwd || null,
      model: hit.model ?? null,
      effort: hit.effort ?? null,
      preset: hit.preset ?? null,
      known: null, // the App's own record of model and preset, read on load
      turn: null,
      started: !!hit.dsh,
    };
    SESS.set(acpId, s);
  }
  if (cwd && !s.cwd) s.cwd = cwd;
  return s;
}

// ------------------------------------------------------------------ the App and its Host API
function readLaunch() {
  let text;
  try {
    text = fs.readFileSync(APP_LOG, "utf8");
  } catch {
    return null;
  }
  const last = [...text.matchAll(/(http:\/\/127\.0\.0\.1:\d+)\/\?token=([A-Za-z0-9_-]+)/g)].at(-1);
  return last ? { origin: last[1], token: last[2] } : null;
}

const appRunning = () => spawnSync("pgrep", ["-f", `${APP}/Contents/MacOS/`]).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(test, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (test()) return true;
  return false;
}

function takeLock() {
  try {
    fs.mkdirSync(LAUNCH_LOCK);
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(LAUNCH_LOCK).mtimeMs > LAUNCH_TIMEOUT_MS * 2) {
        fs.rmdirSync(LAUNCH_LOCK);
        fs.mkdirSync(LAUNCH_LOCK);
        return true;
      }
    } catch {}
    return false;
  }
}

/**
 * Open the App with its stdout in our state directory; several bridge processes share one launch.
 * An instance can quit at once (seen after a restart of the Mac: the App refused its single-instance
 * lock and exited within half a second), so one that is gone before printing its address is opened again.
 */
async function launchApp() {
  fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
  fs.chmodSync(APP_DIR, 0o700);
  if (!takeLock()) {
    await waitFor(() => !fs.existsSync(LAUNCH_LOCK), LAUNCH_TIMEOUT_MS * LAUNCH_TRIES);
    return;
  }
  try {
    if (appRunning()) return;
    for (let attempt = 1; attempt <= LAUNCH_TRIES; attempt++) {
      fs.writeFileSync(APP_LOG, "", { mode: 0o600 });
      const r = spawnSync("open", ["-g", "-a", APP, "--stdout", APP_LOG, "--stderr", APP_LOG]);
      if (r.status !== 0) throw new UserError(`没能打开 DSH App：${String(r.stderr).trim()}`);
      log(`opened the DSH App (attempt ${attempt})`);
      const opened = Date.now();
      await waitFor(
        () => readLaunch() !== null || (Date.now() - opened > LAUNCH_GONE_MS && !appRunning()),
        LAUNCH_TIMEOUT_MS,
      );
      if (readLaunch() !== null || appRunning()) return;
      log(`the DSH App quit before printing its address (attempt ${attempt})`);
      if (attempt < LAUNCH_TRIES) await sleep(attempt * 2_000);
    }
    throw new UserError(
      `DSH App 每次一打开就退出了（试了 ${LAUNCH_TRIES} 次）。请从 Dock 打开它看看有没有报错，再把它退出后重发；还不行就重启一下 Mac。`,
    );
  } finally {
    try {
      fs.rmdirSync(LAUNCH_LOCK);
    } catch {}
  }
}

function remoteError(e) {
  const err = new Error(e?.message || "DSH App error");
  err.code = e?.code;
  return err;
}

class AppLink {
  origin = null;
  cookie = null;
  ws = null;
  streams = new Map();
  n = 0;
  pending = null;

  /** Attach to the App, opening it when `launch` allows and it is not running. */
  ensure(launch = true) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    this.pending ??= this.connect(launch).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async connect(launch) {
    const found = readLaunch();
    if (found && (await this.attach(found))) return;
    if (appRunning()) {
      throw new UserError(
        "DSH App 已经开着，但不是天枢打开的，天枢接不上它。请先退出 DSH App 再发一次，天枢会自己把它打开（之后让它开着就行）。",
      );
    }
    if (!launch) throw new UserError("DSH App 没有开着。");
    await launchApp();
    const again = readLaunch();
    if (!again || !(await this.attach(again))) {
      throw new UserError("DSH App 打开了，但天枢没接上它的本地接口。请退出 DSH App 再发一次。");
    }
  }

  async attach({ origin, token }) {
    let res;
    try {
      res = await fetch(`${origin}/connect?token=${encodeURIComponent(token)}&interactions=none`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return false;
    }
    const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    if (res.status !== 302 || !cookie) return false;
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/api/remote.mux`, {
      headers: { cookie },
    });
    try {
      await new Promise((ok, bad) => {
        ws.onopen = ok;
        ws.onerror = () => bad(new Error("websocket"));
        ws.onclose = () => bad(new Error("websocket closed"));
      });
    } catch {
      return false;
    }
    this.origin = origin;
    this.cookie = cookie;
    this.ws = ws;
    ws.onmessage = (ev) => this.frame(ev.data);
    ws.onerror = ws.onclose = () => this.lost(ws);
    return true;
  }

  /** The API Peer ends with its socket; the next call attaches again with the same launch token. */
  lost(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.cookie = null;
    const err = new UserError("和 DSH App 的连接断了（App 退出或重启了？）。再发一次即可。");
    for (const s of this.streams.values()) s.fail(err);
    this.streams.clear();
  }

  frame(data) {
    let f;
    try {
      f = JSON.parse(String(data));
    } catch {
      return;
    }
    const s = this.streams.get(f.streamId);
    if (!s) return;
    if (f.type === "item") s.item(f.value);
    else if (f.type === "end") {
      this.streams.delete(f.streamId);
      s.end();
    } else if (f.type === "error") {
      this.streams.delete(f.streamId);
      s.fail(remoteError(f.error));
    }
  }

  async call(method, args = {}, launch = true) {
    await this.ensure(launch);
    const body = { type: "client-request", rpcId: randomUUID(), method, payload: { args } };
    const res = await fetch(`${this.origin}/api/${method}`, {
      method: "POST",
      headers: { cookie: this.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await res.json().catch(() => null))?.result;
    if (!result) throw new Error(`DSH App ${method}: HTTP ${res.status}`);
    if (!result.ok) throw remoteError(result.error);
    return result.value;
  }

  /** Open one logical stream; `close()` cancels it. */
  async stream(endpoint, args, onItem, launch = true) {
    await this.ensure(launch);
    const id = `s${++this.n}`;
    let end, fail;
    const done = new Promise((a, b) => {
      end = a;
      fail = b;
    });
    done.catch(() => {});
    this.streams.set(id, { item: onItem, end, fail });
    this.ws.send(JSON.stringify({ type: "open", streamId: id, endpoint, payload: { args } }));
    return {
      done,
      close: () => {
        if (!this.streams.delete(id)) return;
        try {
          this.ws?.send(JSON.stringify({ type: "cancel", streamId: id }));
        } catch {}
        end();
      },
    };
  }
}

const app = new AppLink();

// ------------------------------------------------------------------ models and modes
let catalogMemo = null; // { at, value }

async function catalog(launch) {
  if (catalogMemo && Date.now() - catalogMemo.at < 30_000) return catalogMemo.value;
  try {
    const [models, presets] = await Promise.all([
      app.call("session/modelCatalog", {}, launch),
      app.call("agentPresets/list", {}, launch).catch(() => ({ presets: [] })),
    ]);
    const value = { models, presets: presets.presets || [] };
    catalogMemo = { at: Date.now(), value };
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(CATALOG_CACHE, JSON.stringify(value));
    } catch {}
    return value;
  } catch (e) {
    if (launch) throw e;
    try {
      return JSON.parse(fs.readFileSync(CATALOG_CACHE, "utf8")); // the App is closed: what it offered last time
    } catch {
      return { models: { groups: [] }, presets: [] };
    }
  }
}

function modelList(cat) {
  const out = [];
  for (const g of cat.models?.groups || []) {
    for (const m of g.models || []) {
      out.push({
        id: `${g.id}/${m.id}`,
        provider: g.id,
        model: m.id,
        name: m.name || m.id,
        group: g.name || g.id,
        efforts: (m.reasoning?.efforts || []).map((e) => e.id),
        defaultEffort: m.reasoning?.defaultEffort,
      });
    }
  }
  const names = new Map();
  for (const m of out) names.set(m.name, (names.get(m.name) || 0) + 1);
  for (const m of out) if (names.get(m.name) > 1) m.name = `${m.name} · ${m.group}`;
  return out;
}

const byRoute = (models, sel) =>
  sel && models.find((m) => m.provider === sel.provider && m.model === sel.model);

function selectedModel(s, cat, models) {
  return (
    models.find((m) => m.id === s.model) ||
    byRoute(models, s.known?.model) ||
    byRoute(models, cat.models?.default) ||
    models[0] ||
    null
  );
}

function effortNow(s, m) {
  if (!m?.efforts.length) return null;
  if (m.efforts.includes(s.effort)) return s.effort;
  const known = s.known?.model;
  if (known && byRoute([m], known) && m.efforts.includes(known.reasoningEffort))
    return known.reasoningEffort;
  return m.efforts.includes(m.defaultEffort)
    ? m.defaultEffort
    : m.efforts[Math.floor(m.efforts.length / 2)];
}

function presetList(cat) {
  return (cat.presets || [])
    .filter((p) => !p.broken && !/-child-/.test(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name || PRESET_LABELS[p.id] || p.id,
      isDefault: !!p.isDefault,
    }));
}

const presetNow = (s, presets) =>
  s.preset || s.known?.preset || presets.find((p) => p.isDefault)?.id || presets[0]?.id || null;

function configOptions(s, cat) {
  const models = modelList(cat);
  const sel = selectedModel(s, cat, models);
  if (!sel) return [];
  const opts = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: sel.id,
      options: models.map((m) => ({ value: m.id, name: m.name })),
    },
  ];
  if (sel.efforts.length) {
    opts.push({
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: effortNow(s, sel),
      options: sel.efforts.map((e) => ({ value: e, name: EFFORT_LABELS[e] || e })),
    });
  }
  const presets = presetList(cat);
  if (presets.length > 1 && !s.started) {
    // The App's agent presets (标准 / PTC / …), chosen before a session's first turn as in the App; not the
    // client's interaction-mode category.
    opts.push({
      id: "preset",
      name: "DSH 模式",
      type: "select",
      currentValue: presetNow(s, presets),
      options: presets.map((p) => ({ value: p.id, name: p.name })),
    });
  }
  return opts;
}

function modelsState(s, cat) {
  const models = modelList(cat);
  const sel = selectedModel(s, cat, models);
  if (!sel) return undefined;
  const meta = (m) =>
    m.efforts.length
      ? {
          reasoningEfforts: m.efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] || e })),
          reasoningEffort: m === sel ? effortNow(s, m) : m.defaultEffort,
        }
      : { supportsReasoningEffort: false };
  return {
    currentModelId: sel.id,
    availableModels: models.map((m) => ({ modelId: m.id, name: m.name, _meta: meta(m) })),
  };
}

function sessionState(s, cat) {
  const out = { configOptions: configOptions(s, cat) };
  const models = modelsState(s, cat);
  if (models) out.models = models;
  return out;
}

/** Install the session's chosen model in the App (the App also saves it as its default, as its own picker does). */
async function applyModel(s, cat) {
  if (!s.dsh || (s.model === null && s.effort === null)) return;
  const models = modelList(cat);
  const sel = selectedModel(s, cat, models);
  if (!sel) return;
  const effort = effortNow(s, sel);
  await app.call("session/selectModel", {
    request: {
      sessionId: s.dsh,
      provider: sel.provider,
      model: sel.model,
      ...(effort ? { reasoningEffort: effort } : {}),
    },
  });
}

// ------------------------------------------------------------------ prompt content
// The client's notes (its collaboration tools, runtime info) are for agents that can use them; DSH cannot reach
// those tools, and the notes would show in the DSH App as part of your message.
const NOTES = /\s*<(t3_code_instructions|runtime_info|pull_request_linking)>[\s\S]*?<\/\1>\s*/g;
const REQUEST = /<user_request>\n?([\s\S]*?)\n?<\/user_request>/;

function promptContent(blocks) {
  const texts = [];
  const images = [];
  for (const b of blocks || []) {
    if (b.type === "text") texts.push(b.text || "");
    else if (b.type === "resource_link") texts.push(b.uri || "");
    else if (b.type === "resource") texts.push(b.resource?.text || b.resource?.uri || "");
    else if (
      b.type === "image" &&
      b.data &&
      /^image\/(png|jpeg|webp|gif)$/.test(b.mimeType || "")
    ) {
      images.push({ type: "image", mediaType: b.mimeType, data: b.data });
    }
  }
  let text = texts.filter(Boolean).join("\n");
  const m = REQUEST.exec(text);
  if (m) text = text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length);
  text = text.replace(NOTES, "\n\n").trim();
  return [...(text ? [{ type: "text", text }] : []), ...images];
}

// ------------------------------------------------------------------ App events -> ACP updates
function toolKind(name) {
  const n = (name || "").toLowerCase();
  if (["bash", "shell", "exec", "pwsh", "run_code"].includes(n)) return "execute";
  if (["read", "view", "read_file", "read_image"].includes(n)) return "read";
  if (["edit", "write", "apply_patch", "multi_edit", "str_replace_editor"].includes(n))
    return "edit";
  if (["grep", "glob", "search", "web_search", "web_fetch"].includes(n)) return "search";
  return "other";
}

function toolTitle(name, args) {
  let input = args;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = {};
    }
  }
  input = input && typeof input === "object" ? input : {};
  const hint =
    input.command ||
    input.path ||
    input.file_path ||
    input.pattern ||
    input.query ||
    input.description ||
    "";
  const first = String(hint).trim().split("\n")[0].slice(0, 120);
  return { title: first ? `${name}: ${first}` : name, input };
}

const contentText = (content) =>
  (content || [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text || "")
    .join("\n");

function emitToolCall(acpId, id, name, args, status) {
  const { title, input } = toolTitle(name, args);
  update(acpId, {
    sessionUpdate: "tool_call",
    toolCallId: id || randomUUID(),
    title,
    kind: toolKind(name),
    status,
    rawInput: input,
  });
}

function emitToolResult(acpId, message, status) {
  const text = contentText(message?.content);
  update(acpId, {
    sessionUpdate: "tool_call_update",
    toolCallId: message?.toolCallId || "",
    status: status || (message?.isError ? "failed" : "completed"),
    ...(text
      ? { content: [{ type: "content", content: { type: "text", text: text.slice(0, 20_000) } }] }
      : {}),
  });
}

/** Replay one recorded event (history on load); live turns use `onTurnItem`. */
function replayEvent(acpId, e) {
  const d = e.data || {};
  if (e.type === "user/message" && d.source?.kind === "user") {
    const text = contentText(d.content).trim();
    if (text) update(acpId, textChunk("user_message_chunk", text));
  } else if (e.type === "assistant/message") {
    for (const c of d.message?.content || []) {
      if (c.type === "text" && c.text) update(acpId, textChunk("agent_message_chunk", c.text));
      else if (c.type === "reasoning" && c.text)
        update(acpId, textChunk("agent_thought_chunk", c.text));
      else if (c.type === "tool-call") emitToolCall(acpId, c.id, c.name, c.arguments, "completed");
    }
  } else if (e.type === "tool/result") {
    emitToolResult(acpId, d.message);
  }
}

// ------------------------------------------------------------------ one turn
async function runTurn(acpId, s, content) {
  const sid = s.dsh;
  const requestId = randomUUID();
  const t = {
    baseline: null,
    admitted: false,
    turn: null,
    streamedSteps: new Set(),
    attempts: new Map(),
    tools: new Set(),
    cancelled: false,
  };
  let finish;
  const finished = new Promise((r) => {
    finish = r;
  });
  s.turn = t;
  const onItem = (v) => {
    if (v?.type === "snapshot") {
      t.baseline = v.cursor;
      return;
    }
    if (v?.type === "assistant-stream") return onStreamFrame(acpId, t, v.frame);
    if (v?.type !== "event") return;
    const e = v.event;
    if (t.baseline !== null && e.seq <= t.baseline) return;
    const d = e.data || {};
    if (
      e.type === "agent/inbox/spliced" &&
      (d.inserted || []).some((x) => x.source?.rpcId === requestId)
    ) {
      t.admitted = true;
      return;
    }
    if (e.type === "turn/start" && t.admitted && t.turn === null) {
      t.turn = d.turn;
      return;
    }
    if (t.turn === null || (d.turn !== undefined && d.turn !== t.turn)) return;
    if (e.type === "assistant/message") {
      const streamed = t.streamedSteps.has(`${d.turn}:${d.step}`);
      for (const c of d.message?.content || []) {
        if (c.type === "text" && c.text && !streamed)
          update(acpId, textChunk("agent_message_chunk", c.text));
        else if (c.type === "reasoning" && c.text && !streamed)
          update(acpId, textChunk("agent_thought_chunk", c.text));
      }
    } else if (e.type === "tool/call") {
      if (!t.tools.has(d.callId)) {
        t.tools.add(d.callId);
        emitToolCall(acpId, d.callId, d.name, d.arguments, "in_progress");
      }
      if (d.name === "ask_user_question") {
        update(
          acpId,
          textChunk(
            "agent_message_chunk",
            "\n\n（DSH 在 App 里向你提问，请到 DSH App 里回答。）\n\n",
          ),
        );
      }
    } else if (e.type === "tool/result") {
      emitToolResult(acpId, d.message);
    } else if (e.type === "turn/end") {
      finish(d.reason || { kind: "completed" });
    }
  };
  const follow = await app.stream(
    "session/follow",
    {
      request: {
        address: { kind: "session", sessionId: sid },
        activate: true,
        assistantStream: true,
        maxMessages: 1,
      },
    },
    onItem,
  );
  try {
    await waitFor(() => t.baseline !== null, 30_000);
    await app.call("session/prompt", {
      request: {
        requestId,
        sessionId: sid,
        mode: "queue",
        content,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    const reason = await Promise.race([
      finished,
      follow.done.then(() => ({ kind: "error", error: { message: "DSH App 中断了这次输出。" } })),
    ]);
    if (t.cancelled || reason.kind === "cancelled" || reason.kind === "aborted")
      return { stopReason: "cancelled" };
    if (reason.kind === "error") {
      update(acpId, textChunk("agent_message_chunk", `\n\n${reason.error?.message || "DSH 报错"}`));
    }
    return { stopReason: "end_turn" };
  } finally {
    follow.close();
    if (s.turn === t) s.turn = null;
  }
}

function onStreamFrame(acpId, t, f) {
  if (!f) return;
  if (f.type === "start") {
    if (t.turn !== null && f.turn === t.turn) t.attempts.set(f.attemptId, `${f.turn}:${f.step}`);
    return;
  }
  const step = t.attempts.get(f.attemptId);
  if (!step || f.type !== "chunk") return;
  const c = f.chunk || {};
  if (c.type === "text-delta" && c.text) {
    t.streamedSteps.add(step);
    update(acpId, textChunk("agent_message_chunk", c.text));
  } else if (c.type === "reasoning-delta" && c.text) {
    t.streamedSteps.add(step);
    update(acpId, textChunk("agent_thought_chunk", c.text));
  }
}

// ------------------------------------------------------------------ handlers
function dshVersion() {
  const r = spawnSync("plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    path.join(APP, "Contents", "Info.plist"),
  ]);
  const v = String(r.stdout || "").trim();
  return r.status === 0 && /^\d+\.\d+\.\d+/.test(v) ? v : "0.2.0";
}

function hInitialize() {
  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { list: {} },
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: false, sse: false },
    },
    authMethods: [],
    agentInfo: { name: "dsh-acp", title: "DeepSeek Harness", version: dshVersion() },
    // Cross-adapter steering extension (`_session/steering`), as codex-acp / claude-agent-acp declare it.
    _meta: { steering: { supported: true, timings: ["now"] } },
  };
}

async function hNew(p) {
  const acpId = `dsh-new-${randomUUID().replaceAll("-", "")}`;
  const s = {
    dsh: null,
    cwd: p.cwd || null,
    model: null,
    effort: null,
    preset: null,
    known: null,
    turn: null,
    started: false,
  };
  SESS.set(acpId, s);
  return { sessionId: acpId, ...sessionState(s, await catalog(false)) };
}

/** Create the App session on first use: in the Workspace for its directory, so the App's sidebar lists it. */
async function ensureSession(acpId, s) {
  if (s.dsh) return;
  // Another bridge process (or a repair of the state file) may have bound it since this one read it.
  const saved = loadState()[acpId]?.dsh;
  if (saved) {
    s.dsh = saved;
    s.started = true;
    return;
  }
  const cwd = s.cwd || process.cwd();
  let request = { cwd };
  try {
    const ws = await app.call("workspace/create", { request: { path: cwd } });
    if (ws?.workspace?.workspaceId) request = { workspaceId: ws.workspace.workspaceId };
  } catch (e) {
    if (e instanceof UserError) throw e; // the App is not reachable: session/create would only try again
    log("workspace:", e.message);
  }
  if (s.preset) request.agentPreset = s.preset;
  const created = await app.call("session/create", { request });
  s.dsh = created.sessionId;
  s.known = { ...(s.known || {}), preset: created.agentPreset };
  remember(acpId, { dsh: s.dsh, cwd, preset: s.preset, model: s.model, effort: s.effort });
}

async function hPrompt(p) {
  const acpId = p.sessionId;
  const s = resolve(acpId);
  const content = promptContent(p.prompt);
  if (!content.length) return { stopReason: "end_turn" };
  try {
    const fresh = !s.dsh;
    await ensureSession(acpId, s);
    if (fresh) await applyModel(s, await catalog(true));
    s.started = true;
    return await runTurn(acpId, s, content);
  } catch (e) {
    if (!(e instanceof UserError) && !e.code) throw e;
    update(acpId, textChunk("agent_message_chunk", `\n\n${e.message}`));
    return { stopReason: "end_turn" };
  }
}

/** Read a session's history through the App: the follow opening carries the newest records and the projections. */
async function readHistory(sid, launch = true) {
  let snapshot = null;
  const opening = await app.stream(
    "session/follow",
    { request: { address: { kind: "session", sessionId: sid }, maxMessages: HISTORY_PAGE } },
    (v) => {
      if (v?.type === "snapshot" && !snapshot) snapshot = v;
    },
    launch,
  );
  try {
    await Promise.race([waitFor(() => snapshot !== null, 60_000), opening.done]);
  } finally {
    opening.close();
  }
  if (!snapshot) throw new UserError("没能从 DSH App 读到这个会话。");
  let records = snapshot.records || [];
  let hasMore = snapshot.hasMore;
  while (hasMore && records.length && records.length < HISTORY_LIMIT) {
    const first = records.find((r) => r.event)?.event?.seq;
    if (first === undefined) break;
    const page = await app.call("session/page", {
      request: {
        address: { kind: "session", sessionId: sid },
        beforeSeq: first,
        maxMessages: HISTORY_PAGE,
      },
    });
    if (!page.records?.length) break;
    records = [...page.records, ...records];
    hasMore = page.hasMore;
  }
  return { records, projections: snapshot.projections?.values || {} };
}

async function hLoad(p) {
  const acpId = p.sessionId;
  const s = resolve(acpId, p.cwd);
  if (!s.dsh) return sessionState(s, await catalog(false));
  // Loading binds the client to this session. When the App cannot be reached now, keep the binding and
  // leave opening the App to the next prompt: a failed load makes the client start a new, empty session.
  let history;
  try {
    history = await readHistory(s.dsh, false);
  } catch (e) {
    log(`loaded ${s.dsh} without its history: ${e.message}`);
    return sessionState(s, await catalog(false));
  }
  const { records, projections } = history;
  for (const r of records) if (r?.type === "event" && r.event) replayEvent(acpId, r.event);
  s.known = {
    model: projections.modelSelection?.next || projections.modelSelection?.lastUsed,
    preset: projections.agentPreset,
  };
  return sessionState(s, await catalog(true));
}

async function hSetOption(p) {
  const acpId = p.sessionId;
  const s = resolve(acpId);
  const cat = await catalog(!!s.dsh);
  const value =
    p.value === null || p.value === undefined || p.value === "" || p.value === "default"
      ? null
      : String(p.value);
  if (p.configId === "model") {
    s.model = value;
    const sel = selectedModel(s, cat, modelList(cat));
    if (!sel?.efforts.includes(s.effort)) s.effort = null;
  } else if (p.configId === "effort") {
    s.effort = value;
  } else if (p.configId === "preset") {
    if (s.dsh && value) {
      try {
        await app.call("agentPresets/select", { agentId: s.dsh, agentPreset: value });
      } catch (e) {
        throw new Error(`DSH 模式只能在会话开始前选：${e.message}`);
      }
    }
    s.preset = value;
  }
  remember(acpId, {
    model: s.model,
    effort: s.effort,
    preset: s.preset,
    ...(s.dsh ? { dsh: s.dsh } : {}),
    ...(s.cwd ? { cwd: s.cwd } : {}),
  });
  if (s.dsh && (p.configId === "model" || p.configId === "effort")) await applyModel(s, cat);
  return { configOptions: configOptions(s, cat) };
}

async function hSetModel(p) {
  await hSetOption({ sessionId: p.sessionId, configId: "model", value: p.modelId });
  return {};
}

async function hSteer(p) {
  const s = resolve(p.sessionId);
  const content = promptContent(p.prompt);
  if (!content.length) return { outcome: "injected" };
  if (!s.dsh || !s.turn) return { outcome: "promptRequired", reason: "noRunningTurn" };
  await app.call("session/prompt", {
    request: { requestId: randomUUID(), sessionId: s.dsh, mode: "steer", content },
  });
  return { outcome: "injected" };
}

async function hList(p) {
  let value;
  try {
    value = await app.call(
      "session/list",
      { _request: p?.cursor ? { cursor: p.cursor } : {} },
      false,
    );
  } catch {
    return { sessions: [] };
  }
  const sessions = (value.items || [])
    .filter((i) => !i.blank && (!p?.cwd || i.cwd === p.cwd))
    .map((i) => {
      const values = i.projections?.values || {};
      const title =
        typeof values.title === "string" ? values.title : values.sessionListMetadata?.title;
      return {
        sessionId: i.sessionId,
        cwd: i.cwd,
        ...(title ? { title } : {}),
        ...(i.updatedAt ? { updatedAt: new Date(i.updatedAt).toISOString() } : {}),
      };
    });
  return { sessions, ...(value.cursor ? { nextCursor: value.cursor } : {}) };
}

async function hCancel(p) {
  const s = SESS.get(p?.sessionId);
  if (!s?.dsh || !s.turn) return;
  s.turn.cancelled = true;
  try {
    await app.call("session/cancel", { request: { sessionId: s.dsh } });
  } catch (e) {
    log("cancel:", e.message);
  }
}

const HANDLERS = {
  initialize: hInitialize,
  "session/new": hNew,
  "session/load": hLoad,
  "session/list": hList,
  "session/prompt": hPrompt,
  "session/set_config_option": hSetOption,
  "session/set_model": hSetModel,
  "_session/steering": hSteer,
};
const NOTIFICATIONS = { "session/cancel": hCancel };

async function handle(msg) {
  const { method, id, params } = msg;
  if (id === undefined || id === null) {
    const fn = NOTIFICATIONS[method];
    if (fn) await Promise.resolve(fn(params || {})).catch((e) => log(method, e.message));
    return;
  }
  const fn = HANDLERS[method];
  if (!fn)
    return send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  try {
    send({ jsonrpc: "2.0", id, result: await fn(params || {}) });
  } catch (e) {
    log(`${method} failed:`, e.stack || e.message);
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method) handle(msg);
});
process.stdin.on("end", () => process.exit(0));
