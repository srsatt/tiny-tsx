import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(path.join(repository, "tests/compat/wpt/manifest.json")));

test("pins selected Web Platform Test sources by revision and digest", () => {
  assert.match(manifest.upstream.commit, /^[0-9a-f]{40}$/);
  for (const selected of manifest.selected) {
    const source = readFileSync(path.join(repository, selected.localPath));
    assert.equal(createHash("sha256").update(source).digest("hex"), selected.sha256);
    assert.ok(["native-derived", "native-planned", "native"].includes(selected.status));
    if (selected.status === "native-derived") {
      assert.ok(readFileSync(path.join(repository, selected.nativeEvidence), "utf8").includes(
        selected.evidenceMarker,
      ));
    }
  }
});
