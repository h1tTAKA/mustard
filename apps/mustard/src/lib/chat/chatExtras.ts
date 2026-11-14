// 채팅 입력 보조(#1341) — 슬래시 커맨드 목록(내 커맨드·스킬)과 @파일 자동완성. 서버 전용.
// Claude: ~/.claude/commands·<레포>/.claude/commands 의 *.md(하위 폴더는 a:b), ~/.claude/skills·<레포>/.claude/skills 의 */SKILL.md.
// Codex: ~/.codex/prompts/*.md → /prompts:이름. 설명은 frontmatter description(없으면 첫 줄).
// 한계: 플러그인이 주는 커맨드·스킬과 CLI 내장 명령은 목록에 없음(내장은 화면 쪽 앱 명령으로 일부만).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

const execFileP = promisify(execFile);
export interface SlashCommand { name: string; description: string; source: "user" | "project" | "skill" }

function describe(file: string): string {
  try {
    const t = readFileSync(file, "utf8").slice(0, 4000);
    const fm = /^---\n([\s\S]*?)\n---/.exec(t);
    const d = fm && /^description:\s*(.+)$/m.exec(fm[1]);
    if (d) return d[1].replace(/^["']|["']$/g, "").trim().slice(0, 160);
    return (t.replace(/^---[\s\S]*?---/, "").split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").trim().slice(0, 160);
  } catch { return ""; }
}
function mdFiles(dir: string, depth = 0): string[] {
  let out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      const st = statSync(f);
      if (st.isDirectory() && depth < 2) out = out.concat(mdFiles(f, depth + 1));
      else if (e.endsWith(".md")) out.push(f);
    }
  } catch { /* 없음 */ }
  return out;
}
const skills = (dir: string): SlashCommand[] => {
  try { return readdirSync(dir).filter((d) => { try { return statSync(join(dir, d, "SKILL.md")).isFile(); } catch { return false; } }).map((d) => ({ name: d, description: describe(join(dir, d, "SKILL.md")), source: "skill" as const })); } catch { return []; }
};

export function listCommands(root: string, provider: string): SlashCommand[] {
  const home = homedir();
  const out: SlashCommand[] = [];
  if (provider === "claude-code") {
    for (const [dir, source] of [[join(home, ".claude", "commands"), "user"], [join(root, ".claude", "commands"), "project"]] as const)
      for (const f of mdFiles(dir)) out.push({ name: relative(dir, f).replace(/\.md$/, "").split("/").join(":"), description: describe(f), source });
    out.push(...skills(join(home, ".claude", "skills")), ...skills(join(root, ".claude", "skills")));
  } else if (provider === "codex") {
    const dir = join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "prompts");
    for (const f of mdFiles(dir)) out.push({ name: `prompts:${relative(dir, f).replace(/\.md$/, "")}`, description: describe(f), source: "user" });
  }
  const seen = new Set<string>();
  return out.filter((c) => /^[\w:.-]+$/.test(c.name) && !seen.has(c.name) && seen.add(c.name)).sort((a, b) => a.name.localeCompare(b.name));
}

// @파일 — git이 아는 파일(무시 목록 제외) 30초 캐시, 이름이 맞는 것부터 30개
const fileCache = new Map<string, { at: number; files: string[] }>();
export async function findFiles(root: string, q: string): Promise<string[]> {
  let hit = fileCache.get(root);
  if (!hit || Date.now() - hit.at > 30_000) {
    let files: string[] = [];
    try { files = (await execFileP("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64_000_000, timeout: 5000 })).stdout.split("\n").filter(Boolean); } catch { /* 깃 아님 */ }
    hit = { at: Date.now(), files };
    fileCache.set(root, hit);
  }
  const s = q.toLowerCase();
  if (!s) return hit.files.slice(0, 30);
  const base = (f: string) => f.slice(f.lastIndexOf("/") + 1).toLowerCase();
  return hit.files.filter((f) => f.toLowerCase().includes(s)).sort((a, b) => Number(!base(a).startsWith(s)) - Number(!base(b).startsWith(s)) || a.length - b.length).slice(0, 30);
}
