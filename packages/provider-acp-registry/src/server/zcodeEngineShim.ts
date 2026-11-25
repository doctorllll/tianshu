/**
 * Runs in place of ZCode's engine and hosts it the ZCode app's way: the app's language, its answers
 * to the engine's preference and reply-language questions, and each model's context window from the
 * engine's catalog instead of the 200K placeholder the bridge would otherwise read.
 */
export const ZCODE_ENGINE_SHIM_NAME = "zcode-tianshu.cjs";

export const ZCODE_ENGINE_SHIM_SOURCE = String.raw`#!/usr/bin/env node
// Tianshu: runs the ZCode engine next to this file the way the ZCode app hosts it. The app
// gives the engine its language and answers the engine's per-session preference and
// reply-language questions from its settings (<ZCode data>/v2/setting.json); the
// zcode-acp-server bridge answers with fixed defaults or not at all. The bridge sizes its
// context meter from the session projection's contextWindow, which holds the engine's 200K
// default; so does the session's own entry for its model. The engine's model catalog (the
// model lists in session/read settings and state.updated patches) has each model's real
// window from ZCode's model table, so that is what reaches the bridge.
// Everything else on stdin and stdout passes through unchanged.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");

const PREFERENCES = "session/requestRuntimePreferences";
const REPLY_LANGUAGE = "session/readReplyLanguage";
const SESSION_READ = "session/read";
// The engine's placeholder window, used wherever it has no size for a model.
const DEFAULT_WINDOW = 200000;
const TOOL_SEARCH_MODES = ["auto", "local", "off"];

function zcodeHome() {
  const base = (process.env.ZCODE_DATA_BASE_DIR || "").trim();
  if (base) return path.join(base, ".zcode");
  return (process.env.ZCODE_HOME || "").trim() || path.join(os.homedir(), ".zcode");
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(zcodeHome(), "v2", "setting.json"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const flag = (value, fallback) => (typeof value === "boolean" ? value : fallback);

// The app's own defaults for settings it has not written yet. Questions the engine would
// otherwise answer by itself stay with the bridge: askUserQuestionAutoResolutionEnabled
// remains the bridge's false so questions still reach the user.
function preferences(settings) {
  return {
    nativeSearchEnhancementsEnabled: flag(settings.nativeSearchEnhancementsEnabled, true),
    toolSearchMode: TOOL_SEARCH_MODES.includes(settings.toolSearchMode)
      ? settings.toolSearchMode
      : "off",
    totalTokensReminderEnabled: flag(settings.totalTokensReminderEnabled, false),
    agentAlwaysBackgroundEnabled: flag(settings.agentAlwaysBackgroundEnabled, true),
    memoryEnabled: flag(settings.memoryEnabled, false),
  };
}

function parse(line) {
  try {
    const message = JSON.parse(line);
    return message && typeof message === "object" && !Array.isArray(message) ? message : undefined;
  } catch {
    return undefined;
  }
}

/** Newline-delimited frames; rewrite returns the line to pass on, or undefined to drop it. */
function frames(rewrite) {
  const decoder = new StringDecoder("utf8");
  let pending = [];
  const take = (text, push) => {
    let start = 0;
    let end = text.indexOf("\n");
    while (end !== -1) {
      pending.push(text.slice(start, end));
      const next = rewrite(pending.join(""));
      pending = [];
      if (next !== undefined) push(next + "\n");
      start = end + 1;
      end = text.indexOf("\n", start);
    }
    if (start < text.length) pending.push(text.slice(start));
  };
  return new Transform({
    transform(chunk, _encoding, done) {
      let out = "";
      take(decoder.write(chunk), (line) => (out += line));
      done(null, out);
    },
    flush(done) {
      let out = "";
      take(decoder.end() + "\n", (line) => (out += line));
      done(null, out === "\n" ? "" : out);
    },
  });
}

const settings = readSettings();
const env = { ...process.env };
const language = settings.locale || settings.uiLocale;
if (!env.ZCODE_CLIENT_LANGUAGE && typeof language === "string" && language) {
  env.ZCODE_CLIENT_LANGUAGE = language;
}

const engine = spawn(
  process.execPath,
  [...process.execArgv, path.join(__dirname, "zcode.cjs"), ...process.argv.slice(2)],
  { stdio: ["pipe", "pipe", "inherit"], env },
);
const asked = new Set();

// Context windows from the engine's model catalog, by "providerId\0modelId"; each session's
// current model; and which session each of the bridge's session/read requests is about.
const windows = new Map();
const sessionModels = new Map();
const reads = new Map();

const modelKey = (ref) =>
  ref && typeof ref.providerId === "string" && typeof ref.modelId === "string"
    ? ref.providerId + "\0" + ref.modelId
    : undefined;

/** Records a settings.model block ({available, current}); returns the current model's key. */
function learnModels(model, sessionId) {
  if (!model || typeof model !== "object") return undefined;
  for (const entry of Array.isArray(model.available) ? model.available : []) {
    const key = modelKey(entry && entry.ref);
    const size = entry && entry.contextWindow;
    if (!key || !Number.isInteger(size) || size <= 0) continue;
    // A session lists its own model with the placeholder; keep the catalog's size.
    if (size === DEFAULT_WINDOW && windows.has(key)) continue;
    windows.set(key, size);
  }
  const current = modelKey(model.current);
  if (current && typeof sessionId === "string" && sessionId && sessionId !== "unknown") {
    sessionModels.set(sessionId, current);
  }
  return current;
}

function correctContextWindow(line) {
  const message = parse(line);
  if (!message) return line;
  const params = message.params && typeof message.params === "object" ? message.params : {};
  if (message.method === "state.updated") {
    learnModels(params.patch && params.patch.model, params.sessionId);
    return line;
  }
  if (message.method === "session/event") {
    const payload = params.payload;
    if (params.type !== "session.updated" || !payload || typeof payload.contextWindow !== "number") {
      return line;
    }
    const size = windows.get(sessionModels.get(params.sessionId));
    if (!size || size === payload.contextWindow) return line;
    return JSON.stringify({ ...message, params: { ...params, payload: { ...payload, contextWindow: size } } });
  }
  const result = message.result;
  if (message.method !== undefined || !result || typeof result !== "object") return line;
  const sessionId = reads.get(message.id);
  reads.delete(message.id);
  const projection = result.projection;
  if (!projection || typeof projection.contextWindow !== "number" || !result.settings) return line;
  const size = windows.get(learnModels(result.settings.model, sessionId ?? projection.sessionId));
  if (!size || size === projection.contextWindow) return line;
  return JSON.stringify({ ...message, result: { ...result, projection: { ...projection, contextWindow: size } } });
}

function answerQuestion(line) {
  const message = parse(line);
  if (!message || message.id === undefined || message.id === null) return line;
  if (message.method === PREFERENCES) asked.add(message.id);
  if (message.method !== REPLY_LANGUAGE) return line;
  const language = readSettings().replyLanguage;
  const reply = {
    ...(message.jsonrpc ? { jsonrpc: message.jsonrpc } : {}),
    id: message.id,
    result: { language: typeof language === "string" && language ? language : null },
  };
  engine.stdin.write(JSON.stringify(reply) + "\n");
  return undefined;
}

const fromEngine = frames((line) => {
  if (line.includes(PREFERENCES) || line.includes(REPLY_LANGUAGE)) {
    const passed = answerQuestion(line);
    if (passed === undefined) return undefined;
  }
  if (line.includes('"contextWindow"') || line.includes('"state.updated"')) {
    return correctContextWindow(line);
  }
  return line;
});

const toEngine = frames((line) => {
  if (line.includes(SESSION_READ)) {
    const message = parse(line);
    if (message && message.method === SESSION_READ && message.id !== undefined && message.id !== null) {
      const sessionId = message.params && message.params.sessionId;
      if (typeof sessionId === "string") reads.set(message.id, sessionId);
    }
  }
  if (asked.size === 0 || !line.includes('"result"')) return line;
  const message = parse(line);
  if (!message || message.method !== undefined || !asked.has(message.id)) return line;
  asked.delete(message.id);
  const result = message.result && typeof message.result === "object" ? message.result : {};
  return JSON.stringify({ ...message, result: { ...result, ...preferences(readSettings()) } });
});

process.stdin.pipe(toEngine).pipe(engine.stdin);
engine.stdout.pipe(fromEngine).pipe(process.stdout);
engine.stdin.on("error", () => {});
process.stdout.on("error", () => {});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => engine.kill(signal));
}
engine.on("error", (error) => {
  process.stderr.write("zcode-tianshu: " + error.message + "\n");
  process.exit(1);
});
engine.on("exit", (code, signal) => {
  if (!signal) process.exit(code ?? 0);
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
});
`;
