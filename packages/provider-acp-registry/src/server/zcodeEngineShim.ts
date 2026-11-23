/**
 * Runs in place of ZCode's engine. The ZCode app gives the engine its language and answers its
 * preference and reply-language questions from the app's settings; zcode-acp-server does not. The
 * shim starts the real engine beside it and answers them the app's way; other traffic passes as is.
 */
export const ZCODE_ENGINE_SHIM_NAME = "zcode-tianshu.cjs";

export const ZCODE_ENGINE_SHIM_SOURCE = String.raw`#!/usr/bin/env node
// Tianshu: runs the ZCode engine next to this file the way the ZCode app hosts it. The app
// gives the engine its language and answers the engine's per-session preference and
// reply-language questions from its settings (<ZCode data>/v2/setting.json); the
// zcode-acp-server bridge answers with fixed defaults or not at all. Everything else on
// stdin and stdout passes through unchanged.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");

const PREFERENCES = "session/requestRuntimePreferences";
const REPLY_LANGUAGE = "session/readReplyLanguage";
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

const fromEngine = frames((line) => {
  if (!line.includes(PREFERENCES) && !line.includes(REPLY_LANGUAGE)) return line;
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
});

const toEngine = frames((line) => {
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
