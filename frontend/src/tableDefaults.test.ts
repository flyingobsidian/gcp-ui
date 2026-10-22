import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultsFor, displayColumns, displayRow, regionOf, sshCommand, TABLE_DEFAULTS } from "./tableDefaults.ts";
import { serviceById } from "./services.ts";

const ZONE_URL = "https://www.googleapis.com/compute/v1/projects/my-proj/zones/europe-west1-b";

test("every defaults entry belongs to a catalogue service", () => {
  for (const id of Object.keys(TABLE_DEFAULTS)) assert.ok(serviceById(id), id);
});

test("VMs: short zone and ssh command", () => {
  const vm = { name: "web-1", zone: ZONE_URL, status: "RUNNING" };
  assert.deepEqual(displayRow(vm, defaultsFor("vms")), { name: "web-1", zone: "europe-west1-b", status: "RUNNING" });
  assert.equal(sshCommand(vm, "my-proj"), "gcloud compute ssh --zone europe-west1-b --tunnel-through-iap --project my-proj web-1");
  assert.equal(sshCommand({ name: "web-1", zone: "europe-west1-b" }, "example.com:legacy-proj"),
    "gcloud compute ssh --zone europe-west1-b --tunnel-through-iap --project example.com:legacy-proj web-1");
});

test("ssh command refuses values unsafe to paste into a shell", () => {
  assert.equal(sshCommand({ name: "x; rm -rf ~", zone: ZONE_URL }, "my-proj"), undefined);
  assert.equal(sshCommand({ name: "web-1", zone: "$(id)" }, "my-proj"), undefined);
  assert.equal(sshCommand({ name: "web-1" }, "my-proj"), undefined);
  assert.equal(sshCommand({ name: "web-1", zone: ZONE_URL }, ""), undefined);
});

test("MIGs: region for regional and zonal groups", () => {
  assert.equal(regionOf({ region: "https://www.googleapis.com/compute/v1/projects/p/regions/europe-west2" }), "europe-west2");
  assert.equal(regionOf({ zone: ZONE_URL }), "europe-west1");
  assert.equal(regionOf({}), "");
  const d = defaultsFor("migs");
  assert.deepEqual(displayColumns(["name", "zone", "size", "targetSize"], d), ["name", "zone", "size", "targetSize", "region"]);
  assert.equal(displayRow({ name: "m", zone: ZONE_URL }, d)["region"], "europe-west1");
  assert.equal(displayRow({ name: "m", zone: ZONE_URL }, d)["zone"], "europe-west1-b");
});

test("Schedules: short name", () => {
  const d = defaultsFor("scheduler");
  assert.equal(displayRow({ name: "projects/p/locations/europe-west2/jobs/nightly" }, d)["name"], "nightly");
});

test("no defaults leaves rows and columns alone", () => {
  const row = { a: 1 };
  assert.equal(displayRow(row, undefined), row);
  assert.deepEqual(displayColumns(["a"], undefined), ["a"]);
  // instanceTemplate is shortened only when present; region is a default
  // column, so it is always computed.
  assert.deepEqual(displayRow({ other: "x/y" }, defaultsFor("migs")), { other: "x/y", region: "" });
});
