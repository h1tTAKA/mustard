#!/usr/bin/env node
// 봇 카탈로그 외부 지시문 생성(#1394) — 외부 MIT 에이전트 원문 폴더(*.md) → src/lib/crew/crewCatalogAgents.ts.
// 쓰기: node scripts/gen-crew-catalog.mjs <원문 agents 폴더>
// 원문 frontmatter의 tools에 Edit/Write가 있으면 write 권한, 없으면 read. 본문은 원문 그대로(영어, 모델용)이되
// 그 저장소에만 있는 스킬·규칙·명령 안내 줄은 걷어낸다. 걷어낸 뒤에도 저장소 이름이 남으면 실패(고지 파일만 예외).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/gen-crew-catalog.mjs <agents dir>"); process.exit(1); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/mustard/src/lib/crew/crewCatalogAgents.ts");

// 우리 봇으로 쓸 데 없는 것(원문 저장소 내부 운영·특정 지역/업계 전용·같은 일 겹침).
const SKIP = new Set([
  "gan-evaluator", "gan-generator", "gan-planner", "harness-optimizer", "conversation-analyzer", "loop-operator",
  "agent-evaluator", "spec-miner", "bengali-reviewer", "homelab-architect", "network-architect", "network-config-reviewer",
  "network-troubleshooter", "healthcare-reviewer", "harmonyos-app-resolver", "opensource-forker", "opensource-packager", "opensource-sanitizer",
]);
// 금지어 = 원문 저장소의 주인·이름(git 원격 주소에서). 코드에 그 이름을 적지 않으려고 실행 때 읽는다.
const remote = execFileSync("git", ["-C", src, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const [owner = "", repo = ""] = remote.replace(/\.git$/, "").split(/[/:]/).slice(-2);
const words = [owner, owner.split("-")[0], repo].filter((w) => w.length >= 3); // 주인 이름이 "이름-접미"면 이름만도
if (words.length < 2) throw new Error(`cannot read source repo name from ${remote}`);
const BANNED = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

function strip(body) {
  const lines = body.split("\n")
    .filter((l) => !/^\s*-\s*(Rules|Skills|Commands):/.test(l))  // 원문 저장소의 규칙·스킬·명령 목록
    .filter((l) => !/`skills\//.test(l))                          // "Use `skills/x` for ..." 안내
    .map((l) => l.replace(/ via `\/[a-z-]+`/g, ""));             // "prefer X via `/x-review`" → "prefer X"
  // 걷어내서 비어 버린 "## 제목" 절은 제목째 지움
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || /^#{1,3} /.test(lines[j])) { i = j - 1; continue; }
    }
    kept.push(lines[i]);
  }
  return kept.join("\n").trim();
}

const items = {};
for (const f of readdirSync(src).filter((f) => f.endsWith(".md")).sort()) {
  const id = f.slice(0, -3);
  if (SKIP.has(id)) continue;
  const text = readFileSync(join(src, f), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`no frontmatter: ${f}`);
  const tools = (m[1].match(/^tools:\s*(.*)$/m)?.[1] ?? "");
  const instructions = strip(m[2]);
  if (BANNED.test(instructions)) throw new Error(`source repo name left in ${f}: ${instructions.match(BANNED)[0]}`);
  if (instructions.length > 20_000) throw new Error(`too long (role limit 20000): ${f}`);
  items[id] = { access: /\b(Edit|Write)\b/.test(tools) ? "write" : "read", instructions };
}

const body = Object.entries(items)
  .map(([id, v]) => `  ${JSON.stringify(id)}: { access: ${JSON.stringify(v.access)}, instructions: ${JSON.stringify(v.instructions)} },`)
  .join("\n");
writeFileSync(out, `// 생성물 — scripts/gen-crew-catalog.mjs가 씀. 직접 고치지 말 것. 출처·라이선스: THIRD_PARTY_NOTICES.md
import type { CrewAccess } from "./crewRoleDefaults.ts";

export const CATALOG_AGENTS: Record<string, { access: CrewAccess; instructions: string }> = {
${body}
};
`);
console.log(`${Object.keys(items).length} agents → ${out}`);
