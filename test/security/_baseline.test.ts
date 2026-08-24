import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/tripwire.js";

// Scaffold marker for the ZH-0xx security regression suite (Phase 6, ZH-029).
// Real regression tests land alongside each confirmed finding.
test("security suite scaffold is wired", () => {
  assert.ok(true);
});
