import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCookie, tokenFromFragment } from "./auth.ts";

const id = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

test("tokenFromFragment accepts a v4 UUID", () => {
  assert.equal(tokenFromFragment(`#${id}`), id);
  assert.equal(tokenFromFragment(`#${id.toUpperCase()}`), id);
  assert.equal(tokenFromFragment(id), id);
});

test("tokenFromFragment rejects anything else", () => {
  for (const h of ["", "#", "#abc", `#${id}x`, `#${id};x=1`, "#3f2b8c1e-9a4d-1e6f-8b2a-1c3d5e7f9a0b", `#${id.replaceAll("-", "")}`]) {
    assert.equal(tokenFromFragment(h), null, h);
  }
});

test("tokenCookie", () => {
  assert.equal(tokenCookie("gcpui_token_32000", id), `gcpui_token_32000=${id}; Path=/; SameSite=Strict`);
});
