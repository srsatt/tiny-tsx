import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileEntry} from "../src/program.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-assets-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
after(() => rmSync(directory, {recursive: true, force: true}));

test("lowers a declared embedded asset store fetch", () => {
  const entry = path.join(directory, "server.ts");
  writeFileSync(entry, `
    import {Hono} from "hono";
    import {openAssets} from "tinytsx:assets";
    const assets = openAssets("WEB", {index: "index.html", spaFallback: true});
    const app = new Hono();
    app.get("*", context => assets.fetch(context.req));
    export default app;
  `);
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    assetBindings: new Set(["WEB"]),
  });
  assert.deepEqual(hir.assetStores, [{id: 0, name: "WEB", index: "index.html", spaFallback: true}]);
  assert.deepEqual(hir.handlers[0]?.response, {kind: "asset", store: 0});
});
