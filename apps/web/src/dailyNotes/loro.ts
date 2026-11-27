/**
 * The one place that loads Loro. The `web` build keeps its WASM beside the module and starts it
 * with `init`, so no bundler plugin or synchronous compile is needed; pages are opened only
 * after `ensureLoroReady()` resolves.
 */
import init from "loro-crdt/web/loro_wasm.js";
import wasmUrl from "loro-crdt/web/loro_wasm_bg.wasm?url";

export * from "loro-crdt/web";

let ready: Promise<void> | undefined;

export function ensureLoroReady(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => undefined);
  return ready;
}
