import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_LINKS, consoleUrl, lastSegment, linkerFor, resourceSegment } from "./consoleLinks.ts";
import { serviceById } from "./services.ts";

const P = "my-proj";

test("every link spec belongs to a catalogue service", () => {
  for (const id of Object.keys(CONSOLE_LINKS)) assert.ok(serviceById(id), id);
});

test("lastSegment and resourceSegment", () => {
  assert.equal(lastSegment("https://www.googleapis.com/compute/v1/projects/p/zones/europe-west2-a"), "europe-west2-a");
  assert.equal(lastSegment("europe-west2"), "europe-west2");
  assert.equal(lastSegment(undefined), "");
  assert.equal(resourceSegment("projects/p/locations/europe-west2/jobs/nightly", "locations"), "europe-west2");
  assert.equal(resourceSegment("projects/p/locations/europe-west2/jobs/nightly", "jobs"), "nightly");
  assert.equal(resourceSegment("projects/p/topics", "topics"), "");
  assert.equal(resourceSegment(42, "jobs"), "");
});

test("consoleUrl encodes segments and needs every one", () => {
  assert.equal(consoleUrl("storage/browser", ["b"], P), "https://console.cloud.google.com/storage/browser/b?project=my-proj");
  assert.equal(consoleUrl("x", ["a/../b", "c?d#e"], "p&q"), "https://console.cloud.google.com/x/a%2F..%2Fb/c%3Fd%23e?project=p%26q");
  assert.equal(consoleUrl("x", ["a", ""], P), undefined);
  assert.equal(consoleUrl("x", ["a"], ""), undefined);
});

test("MIG names and base instance names link to the MIG overview", () => {
  const link = linkerFor("migs", P)!;
  const zonal = { name: "web-mig", baseInstanceName: "web", zone: "https://www.googleapis.com/compute/v1/projects/my-proj/zones/europe-west2-b" };
  const want = "https://console.cloud.google.com/compute/instanceGroups/details/europe-west2-b/web-mig?project=my-proj&tab=overview";
  assert.equal(link(zonal, "baseInstanceName"), want);
  assert.equal(link(zonal, "name"), want);
  assert.equal(link(zonal, "targetSize"), undefined);
  const regional = { name: "api-mig", baseInstanceName: "api", region: "projects/my-proj/regions/europe-west2" };
  assert.equal(link(regional, "baseInstanceName"),
    "https://console.cloud.google.com/compute/instanceGroups/details/europe-west2/api-mig?project=my-proj&tab=overview");
  assert.equal(link({ name: "no-location" }, "name"), undefined);
});

test("priority services", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["vms", { name: "vm-1", zone: "https://www.googleapis.com/compute/v1/projects/my-proj/zones/europe-west2-a" },
      "https://console.cloud.google.com/compute/instancesDetail/zones/europe-west2-a/instances/vm-1?project=my-proj"],
    ["buckets", { name: "my-bucket" }, "https://console.cloud.google.com/storage/browser/my-bucket?project=my-proj"],
    ["buckets", { storage_url: "gs://other-bucket/" }, "https://console.cloud.google.com/storage/browser/other-bucket?project=my-proj"],
    ["scheduler", { name: "projects/my-proj/locations/europe-west2/jobs/nightly" },
      "https://console.cloud.google.com/cloudscheduler/jobs/edit/europe-west2/nightly?project=my-proj"],
    ["workflows", { name: "projects/my-proj/locations/europe-west2/workflows/etl" },
      "https://console.cloud.google.com/workflows/workflow/europe-west2/etl/executions?project=my-proj"],
    ["pubsub-topics", { name: "projects/my-proj/topics/events" },
      "https://console.cloud.google.com/cloudpubsub/topic/detail/events?project=my-proj"],
  ];
  for (const [svc, row, want] of cases) {
    const col = Object.keys(row)[0]!;
    assert.equal(linkerFor(svc, P)!({ ...row }, svc === "buckets" && !row["name"] ? "name" : col), want, svc);
  }
});

test("linkerFor without a spec or project", () => {
  assert.equal(linkerFor("enabled-apis", P), undefined);
  assert.equal(linkerFor(undefined, P), undefined);
  assert.equal(linkerFor("vms", ""), undefined);
});
