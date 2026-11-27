// @effect-diagnostics nodeBuiltinImport:off -- loads the WASM bytes for tests that run under Node.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

import { initSync } from "loro-crdt/web";

const require = NodeModule.createRequire(import.meta.url);
initSync({ module: NodeFS.readFileSync(require.resolve("loro-crdt/web/loro_wasm_bg.wasm")) });
