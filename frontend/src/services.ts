import { splitArgs } from "./args.ts";

// The service catalogue: read-only gcloud list commands, one per resource
// type. Commands follow Python gcloud semantics. Services whose list command
// needs a location record the flag; the picker fills in the location last
// used for that service.

export interface Service {
  id: string;
  name: string;
  category: string;
  args: readonly string[];
  locationFlag?: "--location" | "--region";
  keywords?: string;
}

export const SERVICES: readonly Service[] = [
  { id: "vms", name: "VMs", category: "Compute", args: ["compute", "instances", "list"], keywords: "instances gce compute engine" },
  { id: "migs", name: "MIGs", category: "Compute", args: ["compute", "instance-groups", "managed", "list"], keywords: "managed instance groups" },
  { id: "instance-templates", name: "Instance templates", category: "Compute", args: ["compute", "instance-templates", "list"] },
  { id: "disks", name: "Disks", category: "Compute", args: ["compute", "disks", "list"], keywords: "pd persistent" },
  { id: "snapshots", name: "Snapshots", category: "Compute", args: ["compute", "snapshots", "list"] },
  { id: "images", name: "Images (custom)", category: "Compute", args: ["compute", "images", "list", "--no-standard-images"] },

  { id: "networks", name: "VPC networks", category: "Networking", args: ["compute", "networks", "list"], keywords: "vpc" },
  { id: "subnets", name: "Subnets", category: "Networking", args: ["compute", "networks", "subnets", "list"], keywords: "subnetworks vpc" },
  { id: "firewall-rules", name: "Firewall rules", category: "Networking", args: ["compute", "firewall-rules", "list"] },
  { id: "routers", name: "Cloud Routers", category: "Networking", args: ["compute", "routers", "list"], keywords: "nat" },
  { id: "addresses", name: "IP addresses", category: "Networking", args: ["compute", "addresses", "list"], keywords: "static ip" },
  { id: "forwarding-rules", name: "Forwarding rules", category: "Networking", args: ["compute", "forwarding-rules", "list"], keywords: "load balancer lb" },
  { id: "backend-services", name: "Backend services", category: "Networking", args: ["compute", "backend-services", "list"], keywords: "load balancer lb" },
  { id: "url-maps", name: "URL maps", category: "Networking", args: ["compute", "url-maps", "list"], keywords: "load balancer lb" },
  { id: "dns-zones", name: "DNS zones", category: "Networking", args: ["dns", "managed-zones", "list"], keywords: "cloud dns" },

  { id: "buckets", name: "Buckets", category: "Storage", args: ["storage", "buckets", "list"], keywords: "gcs cloud storage" },
  { id: "filestore", name: "Filestore instances", category: "Storage", args: ["filestore", "instances", "list"], keywords: "nfs" },

  { id: "gke-clusters", name: "GKE clusters", category: "Containers & serverless", args: ["container", "clusters", "list"], keywords: "kubernetes k8s" },
  { id: "run-services", name: "Cloud Run services", category: "Containers & serverless", args: ["run", "services", "list"] },
  { id: "run-jobs", name: "Cloud Run jobs", category: "Containers & serverless", args: ["run", "jobs", "list"] },
  { id: "functions", name: "Cloud Functions", category: "Containers & serverless", args: ["functions", "list"] },
  { id: "artifact-repos", name: "Artifact repositories", category: "Containers & serverless", args: ["artifacts", "repositories", "list"], keywords: "docker registry gar" },
  { id: "builds", name: "Cloud Build builds", category: "Containers & serverless", args: ["builds", "list"], keywords: "ci" },
  { id: "build-triggers", name: "Cloud Build triggers", category: "Containers & serverless", args: ["builds", "triggers", "list"], keywords: "ci" },

  { id: "scheduler", name: "Schedules", category: "Integration", args: ["scheduler", "jobs", "list"], locationFlag: "--location", keywords: "cloud scheduler cron jobs" },
  { id: "workflows", name: "Workflows", category: "Integration", args: ["workflows", "list"], locationFlag: "--location" },
  { id: "pubsub-topics", name: "Pub/Sub topics", category: "Integration", args: ["pubsub", "topics", "list"], keywords: "pubsub" },
  { id: "pubsub-subscriptions", name: "Pub/Sub subscriptions", category: "Integration", args: ["pubsub", "subscriptions", "list"], keywords: "pubsub" },
  { id: "tasks-queues", name: "Cloud Tasks queues", category: "Integration", args: ["tasks", "queues", "list"], locationFlag: "--location" },
  { id: "eventarc-triggers", name: "Eventarc triggers", category: "Integration", args: ["eventarc", "triggers", "list"] },

  { id: "sql", name: "Cloud SQL instances", category: "Databases", args: ["sql", "instances", "list"], keywords: "mysql postgres" },
  { id: "spanner", name: "Spanner instances", category: "Databases", args: ["spanner", "instances", "list"] },
  { id: "bigtable", name: "Bigtable instances", category: "Databases", args: ["bigtable", "instances", "list"] },
  { id: "firestore", name: "Firestore databases", category: "Databases", args: ["firestore", "databases", "list"], keywords: "datastore" },
  { id: "redis", name: "Memorystore Redis", category: "Databases", args: ["redis", "instances", "list"], locationFlag: "--region" },

  { id: "dataflow", name: "Dataflow jobs", category: "Data", args: ["dataflow", "jobs", "list"] },
  { id: "dataproc", name: "Dataproc clusters", category: "Data", args: ["dataproc", "clusters", "list"], locationFlag: "--region", keywords: "spark hadoop" },

  { id: "service-accounts", name: "Service accounts", category: "Security", args: ["iam", "service-accounts", "list"], keywords: "iam sa" },
  { id: "secrets", name: "Secrets", category: "Security", args: ["secrets", "list"], keywords: "secret manager" },
  { id: "kms-keyrings", name: "KMS key rings", category: "Security", args: ["kms", "keyrings", "list"], locationFlag: "--location", keywords: "keys encryption" },

  { id: "log-sinks", name: "Log sinks", category: "Operations", args: ["logging", "sinks", "list"], keywords: "logging export" },
  { id: "enabled-apis", name: "Enabled APIs", category: "Operations", args: ["services", "list"], keywords: "services apis" },
  { id: "deploy-pipelines", name: "Cloud Deploy pipelines", category: "Operations", args: ["deploy", "delivery-pipelines", "list"], locationFlag: "--region", keywords: "cd delivery" },
];

export const DEFAULT_STARRED: readonly string[] = ["buckets", "vms", "migs", "scheduler", "workflows"];

const byId = new Map(SERVICES.map((s) => [s.id, s]));

export function serviceById(id: string): Service | undefined {
  return byId.get(id);
}

export interface BuiltCommand {
  text: string;
  args: string[];
  // runnable is false when a required location is still missing.
  runnable: boolean;
}

// buildCommand renders a service's list command, adding location when the
// service needs one.
export function buildCommand(s: Service, location = ""): BuiltCommand {
  const args = [...s.args];
  if (s.locationFlag) args.push(`${s.locationFlag}=${location}`);
  return { text: args.join(" "), args, runnable: !s.locationFlag || location !== "" };
}

// matchCommand finds the catalogue service whose list command args is, with
// the location value (if any) returned separately.
export function matchCommand(args: readonly string[]): { service: Service; location: string } | undefined {
  for (const s of SERVICES) {
    const extra = args.length - s.args.length;
    if (extra !== (s.locationFlag ? 1 : 0)) continue;
    if (!s.args.every((a, i) => args[i] === a)) continue;
    if (!s.locationFlag) return { service: s, location: "" };
    const last = args[args.length - 1]!;
    const prefix = `${s.locationFlag}=`;
    if (last.startsWith(prefix)) return { service: s, location: last.slice(prefix.length) };
  }
  return undefined;
}

export interface CatalogueCommand {
  service: Service;
  location: string;
  args: string[];
  // runnable is true when the command needs no further input: a location,
  // if required, is present and well-formed.
  runnable: boolean;
}

// isValidLocation accepts region or zone names such as "europe-west2" or
// "us-central1-a".
export function isValidLocation(s: string): boolean {
  return /^[a-z][a-z0-9-]{1,62}$/.test(s);
}

// catalogueCommand recognises command-line text that is exactly a catalogue
// list command. Only such read-only commands are ever run automatically (on
// picking a service or switching project).
export function catalogueCommand(text: string): CatalogueCommand | undefined {
  let args: string[];
  try {
    args = splitArgs(text);
  } catch {
    return undefined;
  }
  if (args[0] === "gcloud") args = args.slice(1);
  const m = matchCommand(args);
  if (!m) return undefined;
  return { ...m, args, runnable: !m.service.locationFlag || isValidLocation(m.location) };
}

// filterServices returns services matching every whitespace-separated token
// of query in their name, category, keywords or command.
export function filterServices(services: readonly Service[], query: string): Service[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...services];
  return services.filter((s) => {
    const hay = `${s.name} ${s.category} ${s.keywords ?? ""} ${s.args.join(" ")}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
