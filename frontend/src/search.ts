import { naturalCompare, type Project } from "./hierarchy.ts";

export interface Match {
  project: Project;
  rank: number;
}

export const MAX_RESULTS = 50;

const tokenize = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

// searchProjects returns projects whose ID or display name contains every
// whitespace-separated token of query (case-insensitive), best matches first:
// ID prefix, then ID substring, then display-name-only matches.
export function searchProjects(projects: readonly Project[], query: string, limit = MAX_RESULTS): Match[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const first = tokens[0]!;
  const matches: Match[] = [];
  for (const project of projects) {
    const id = project.projectId.toLowerCase();
    const haystack = `${id} ${project.displayName.toLowerCase()}`;
    if (!tokens.every((t) => haystack.includes(t))) continue;
    const rank = id.startsWith(first) ? 0 : id.includes(first) ? 1 : 2;
    matches.push({ project, rank });
  }
  matches.sort((a, b) => a.rank - b.rank || naturalCompare(a.project.projectId, b.project.projectId));
  return matches.slice(0, limit);
}

export interface Segment {
  text: string;
  hit: boolean;
}

// highlight splits text into segments, marking every occurrence of any token.
export function highlight(text: string, query: string): Segment[] {
  const tokens = tokenize(query);
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
      marks.fill(true, i, i + t.length);
    }
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else out.push({ text: text[i]!, hit: marks[i]! });
  }
  return out;
}
