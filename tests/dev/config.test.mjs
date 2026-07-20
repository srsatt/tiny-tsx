import assert from "node:assert/strict";
import test from "node:test";

import {positiveMilliseconds} from "./helpers.mjs";

test("dev test timing overrides accept only positive milliseconds", () => {
  assert.equal(positiveMilliseconds(undefined, 1_500), 1_500);
  assert.equal(positiveMilliseconds("2500", 1_500), 2_500);
  assert.equal(positiveMilliseconds("0", 1_500), 1_500);
  assert.equal(positiveMilliseconds("invalid", 1_500), 1_500);
});
