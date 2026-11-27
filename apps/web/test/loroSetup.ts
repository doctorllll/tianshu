// @effect-diagnostics nodeBuiltinImport:off -- loads the WASM bytes for tests that run under Node.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initSync } from "loro-crdt/web";

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve("loro-crdt/web/loro_wasm_bg.wasm")) });
