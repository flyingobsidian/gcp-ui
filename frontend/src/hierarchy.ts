// Normalised resource-hierarchy types. gcloud's JSON differs between the Python
// CLI (Resource Manager v1/v2 shapes) and gcloud-go (v3 shapes), so every
// parser accepts both.

export interface Org {
  kind: "org";
  key: string; // "organizations/123"
  id: string;
  displayName: string;
}

export interface Folder {
  kind: "folder";
  key: string; // "folders/123"
  id: string;
  displayName: string;
  parent: string; // "organizations/1" or "folders/2"
}

export interface Project {
  kind: "project";
  key: string; // "projects/my-project"
  projectId: string;
  displayName: string;
  number: string;
  parent: string; // "" when the project has no parent
}

export type Container = Org | Folder;

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function asRecords(raw: unknown): Raw[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Raw => typeof r === "object" && r !== null && !Array.isArray(r));
}

// parentKey accepts v3 strings ("folders/1") and v1 objects ({type, id}).
export function parentKey(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const p = raw as Raw;
    const id = str(p["id"]);
    switch (str(p["type"])) {
      case "organization":
        return id ? `organizations/${id}` : "";
      case "folder":
        return id ? `folders/${id}` : "";
    }
  }
  return "";
}

// naturalCompare orders "svc2" before "svc10".
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

const byName = (a: { displayName: string }, b: { displayName: string }) => naturalCompare(a.displayName, b.displayName);

export function parseOrgs(raw: unknown): Org[] {
  const out: Org[] = [];
  for (const r of asRecords(raw)) {
    const name = str(r["name"]);
    const id = name.startsWith("organizations/") ? name.slice("organizations/".length) : "";
    if (!id) continue;
    out.push({ kind: "org", key: name, id, displayName: str(r["displayName"]) || id });
  }
  return out.sort(byName);
}

export function parseFolders(raw: unknown): Folder[] {
  const out: Folder[] = [];
  for (const r of asRecords(raw)) {
    const name = str(r["name"]);
    const id = name.startsWith("folders/") ? name.slice("folders/".length) : "";
    if (!id) continue;
    out.push({ kind: "folder", key: name, id, displayName: str(r["displayName"]) || id, parent: parentKey(r["parent"]) });
  }
  return out.sort(byName);
}

export function parseProjects(raw: unknown): Project[] {
  const out: Project[] = [];
  for (const r of asRecords(raw)) {
    const projectId = str(r["projectId"]);
    if (!projectId) continue;
    const name = str(r["name"]);
    // v3: name is "projects/NUMBER"; v1: name is the display name.
    const v3 = name.startsWith("projects/");
    const number = str(r["projectNumber"]) || (v3 ? name.slice("projects/".length) : "");
    const displayName = str(r["displayName"]) || (v3 ? "" : name) || projectId;
    out.push({ kind: "project", key: `projects/${projectId}`, projectId, displayName, number, parent: parentKey(r["parent"]) });
  }
  return out.sort((a, b) => naturalCompare(a.projectId, b.projectId));
}
