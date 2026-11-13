import { test } from "node:test";
import assert from "node:assert/strict";
import { splitArgs } from "./args.ts";

test("splitArgs", () => {
  assert.deepEqual(splitArgs("  compute instances   list "), ["compute", "instances", "list"]);
  assert.deepEqual(splitArgs(`logging read "severity>=ERROR AND resource.type=gce_instance" --limit 5`),
    ["logging", "read", "severity>=ERROR AND resource.type=gce_instance", "--limit", "5"]);
  assert.deepEqual(splitArgs(`--filter='' x`), ["--filter=", "x"]);
  assert.deepEqual(splitArgs(""), []);
  assert.throws(() => splitArgs(`a "b`), /unterminated/);
});
