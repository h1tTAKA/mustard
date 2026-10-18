// 코드그래프 MCP 툴셋(#853) — 에이전트가 그래프로 코드베이스 즉시 탐색(READ). Graft 6툴 + search(PageRank).
// lib 재사용(loadOrBuildGraph/graphDigest/graphRank). 결과는 텍스트(MCP content).
import { loadOrBuildGraph, currentFingerprint } from "../loadGraph";
import { readCachedGraph } from "../graphStore";
import { graphDigest } from "../graphDigest";
import { graphRank } from "../graphrank";
import type { RepoGraph, RepoNode } from "../types";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (root: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const fileOf = (id: string) => { const h = id.indexOf("#"); return h < 0 ? id : id.slice(0, h); };
const loc = (n: RepoNode | undefined) => (n ? `${n.file}${n.line ? `:${n.line}` : ""}` : "?");
const byId = (g: RepoGraph) => new Map(g.nodes.map((n) => [n.id, n]));

export const TOOLS: McpTool[] = [
  {
    name: "katchup_find_code",
    description: "Find where a symbol is defined (file:line, kind, signature). 'Where is this function/class defined?'",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Symbol name (function/class/type)" } }, required: ["name"] },
    handler: async (root, args) => {
      const q = str(args.name); if (!q) return { text: "name required", isError: true };
      const { graph } = await loadOrBuildGraph(root);
      const ql = q.toLowerCase();
      const hits = graph.nodes.filter((n) => n.kind !== "file" && n.label.toLowerCase() === ql);
      if (!hits.length) return { text: `no symbol named "${q}"` };
      return { text: hits.slice(0, 30).map((n) => `${n.kind} ${loc(n)}${n.owner ? ` (in ${n.owner})` : ""}${n.signature ? `  ${n.signature}` : ""}`).join("\n") };
    },
  },
  {
    name: "katchup_trace_calls",
    description: "Trace call relationships. direction=callers (who calls this symbol) / callees (what this symbol calls) / both.",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, direction: { type: "string", enum: ["callers", "callees", "both"] } }, required: ["symbol"] },
    handler: async (root, args) => {
      const sym = str(args.symbol); if (!sym) return { text: "symbol required", isError: true };
      const dir = str(args.direction) || "both";
      const { graph } = await loadOrBuildGraph(root); const m = byId(graph); const sl = sym.toLowerCase();
      const out: string[] = [];
      if (dir === "callers" || dir === "both") {
        const cs = graph.edges.filter((e) => e.relation === "calls" && m.get(e.target)?.label.toLowerCase() === sl);
        out.push(`[callers] ${cs.length}`, ...cs.slice(0, 40).map((e) => { const s = m.get(e.source); return `  ${s?.label ?? e.source} @ ${loc(s)}`; }));
      }
      if (dir === "callees" || dir === "both") {
        const cs = graph.edges.filter((e) => e.relation === "calls" && m.get(e.source)?.label.toLowerCase() === sl);
        out.push(`[callees] ${cs.length}`, ...cs.slice(0, 40).map((e) => { const t = m.get(e.target); return `  ${t?.label ?? e.target} @ ${loc(t)}`; }));
      }
      return { text: out.join("\n") || `no calls for "${sym}"` };
    },
  },
  {
    name: "katchup_find_all",
    description: "List every graph reference (imports/calls/contains/extends/implements/references/uses/instantiates) of a symbol or file name. uses/instantiates = game scenes/prefabs to scripts/prefabs.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    handler: async (root, args) => {
      const q = str(args.name); if (!q) return { text: "name required", isError: true };
      const { graph } = await loadOrBuildGraph(root); const m = byId(graph); const ql = q.toLowerCase();
      const hit = (id: string) => { const n = m.get(id); return n?.label.toLowerCase() === ql || fileOf(id).toLowerCase().endsWith(ql); };
      const refs = graph.edges.filter((e) => hit(e.source) || hit(e.target));
      if (!refs.length) return { text: `no references to "${q}"` };
      return { text: refs.slice(0, 60).map((e) => `${e.relation}: ${m.get(e.source)?.label ?? fileOf(e.source)} → ${m.get(e.target)?.label ?? fileOf(e.target)}`).join("\n") };
    },
  },
  {
    name: "katchup_file_api",
    description: "Symbol skeleton of one file (functions/classes/types + line + signature). Learn its API without opening the file.",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "Repo-relative path (a trailing part also matches)" } }, required: ["file"] },
    handler: async (root, args) => {
      const f = str(args.file); if (!f) return { text: "file required", isError: true };
      const { graph } = await loadOrBuildGraph(root);
      const syms = graph.nodes.filter((n) => n.kind !== "file" && (n.file === f || n.file.endsWith(f)));
      if (!syms.length) return { text: `no symbols in "${f}"` };
      const file = syms[0].file;
      return { text: `${file}\n` + syms.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map((n) => `  ${n.line ?? "?"}: ${n.kind} ${n.label}${n.signature ? ` ${n.signature}` : ""}`).join("\n") };
    },
  },
  {
    name: "katchup_repo_map",
    description: "Repo structure summary (module map + cross-module dependencies + key hub files). Start here in a new codebase.",
    inputSchema: { type: "object", properties: {} },
    handler: async (root) => {
      const { graph } = await loadOrBuildGraph(root);
      return { text: graphDigest(graph) };
    },
  },
  {
    name: "katchup_search",
    description: "Graph-based related-code search (PageRank, no embeddings). Natural-language queries like 'how does X work' or 'code related to X'.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    handler: async (root, args) => {
      const q = str(args.query); if (!q) return { text: "query required", isError: true };
      const lim = typeof args.limit === "number" && args.limit > 0 ? Math.min(50, args.limit) : 20;
      const { graph } = await loadOrBuildGraph(root); const m = byId(graph);
      const hits = graphRank(graph, q, lim);
      if (!hits.length) return { text: `no results for "${q}"` };
      return { text: hits.map((h, i) => { const n = m.get(h.id); return `${i + 1}. ${n?.label ?? h.id} [${n?.kind ?? "?"}] ${loc(n)}`; }).join("\n") };
    },
  },
  {
    name: "katchup_check_freshness",
    description: "Check whether the code graph is up to date with the source (it rebuilds on the next query after files change).",
    inputSchema: { type: "object", properties: {} },
    handler: async (root) => {
      const cur = currentFingerprint(root);
      const cached = readCachedGraph(root);
      if (!cached) return { text: "no cached graph yet — first query will build it" };
      const fresh = cached.fingerprint === cur;
      return { text: `${fresh ? "fresh" : "stale (will rebuild on next query)"} · builtAt ${new Date(cached.builtAt).toISOString()} · nodes ${cached.graph.nodes.length} edges ${cached.graph.edges.length}` };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** 서버가 부르는 진입 — 툴 실행. 에러는 흡수해 {isError:true}로(서버 죽이지 않음). */
export async function callTool(root: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const tool = BY_NAME.get(name);
  if (!tool) return { text: `unknown tool: ${name}`, isError: true };
  try { return await tool.handler(root, args); }
  catch (e) { return { text: String((e as Error)?.message || e), isError: true }; }
}
