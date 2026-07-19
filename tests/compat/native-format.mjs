import assert from "node:assert/strict";
import fs from "node:fs";

export function assertNativeExecutable(file) {
  const magic = fs.readFileSync(file).subarray(0, 4);
  if (process.platform === "darwin" && ["arm64", "x64"].includes(process.arch)) {
    assert.deepEqual(magic, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    return;
  }
  if (process.platform === "linux" && ["arm64", "x64"].includes(process.arch)) {
    assert.deepEqual(magic, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    return;
  }
  assert.fail(`unsupported native test host ${process.platform}/${process.arch}`);
}
