// Crew 역할 저장소(#1100) — 전역 ~/.nunopi/crew/roles.json. 서버 전용.
// 파일엔 "기본 역할 덮어쓰기 + 커스텀 역할"만 저장 → 읽을 때 기본 8과 합침(기본 지시문이 앱 업데이트로 바뀌면 안 건드린 역할은 새 기본값을 받음).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { builtinRoles, CREW_PROVIDERS, type CrewRole } from "./crewRoleDefaults.ts";
import { CATALOG } from "./crewCatalog.ts";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const file = () => join(baseDir(), "roles.json");

// bots(#1394): 설치된 봇 정보 — 칸이 없으면(옛 파일) crewBots가 한 번 이전한다. 역할 저장 때 그대로 보존.
export type BotMeta = { color: string; createdAt: number; name?: string; catalog?: string; mission?: string };
export type Stored = { overrides: Record<string, Partial<CrewRole>>; custom: CrewRole[]; bots?: Record<string, BotMeta> };

function clean(x: unknown, builtin: boolean): Partial<CrewRole> | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const out: Partial<CrewRole> = {};
  if (typeof r.instructions === "string") out.instructions = r.instructions.slice(0, 20_000);
  if (typeof r.provider === "string" && (CREW_PROVIDERS as string[]).includes(r.provider)) out.provider = r.provider as CrewRole["provider"];
  // 모델 id는 실행 AI 명령줄로 넘어감 → 공백·제어 문자 없이, 맨 앞 "-" 금지(옵션으로 읽히지 않게, #1397 리뷰). 목록 소속은 만들 때 route가 확인.
  // 안 맞으면 비움 = 그 AI 기본 모델. 한계: 공백 든 모델 id는 못 씀(실행 AI들의 id엔 없음).
  if (typeof r.model === "string") { const m = r.model.trim(); out.model = /^[^\s-][^\s]{0,79}$/.test(m) ? m : undefined; }
  if (r.access === "read" || r.access === "write") out.access = r.access;
  if (!builtin) {
    if (typeof r.name === "string") out.name = r.name.trim().slice(0, 60);
    if (typeof r.description === "string") out.description = r.description.trim().slice(0, 200);
  }
  return out;
}

// 파일을 못 읽어서(권한·잠김) 빈 값으로 돌려준 결과 — 이걸로 다시 쓰면 역할이 다 날아가므로 쓰기를 거부(리뷰)
const unreadable = new WeakSet<Stored>();

export function readStored(): Stored {
  if (!existsSync(file())) return { overrides: {}, custom: [] };
  let text: string;
  try { text = readFileSync(file(), "utf8"); } catch { const empty = { overrides: {}, custom: [] }; unreadable.add(empty); return empty; }
  try {
    const j = JSON.parse(text) as Partial<Stored>;
    const out: Stored = { overrides: j.overrides && typeof j.overrides === "object" ? j.overrides : {}, custom: Array.isArray(j.custom) ? j.custom.filter((c) => c && typeof c === "object") : [] }; // null 같은 깨진 칸은 버림(리뷰 — c.id에서 죽음)
    if (j.bots && typeof j.bots === "object" && !Array.isArray(j.bots)) out.bots = j.bots;
    return out;
  } catch { return { overrides: {}, custom: [] }; } // 깨진 JSON — 쓸 때 옆에 백업하고 새로 시작
}
export function writeStored(s: Stored) {
  if (unreadable.has(s)) throw new Error("roles.json unreadable — not overwriting");
  mkdirSync(baseDir(), { recursive: true });
  // 깨진 JSON은 빈 값으로 읽히므로, 그 위에 그대로 쓰면 역할이 다 날아감(리뷰) → 덮기 전에 옆에 백업
  if (existsSync(file())) {
    try { JSON.parse(readFileSync(file(), "utf8")); } catch { copyFileSync(file(), `${file()}.bad-${Date.now()}`); }
  }
  writeFileSync(`${file()}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${file()}.tmp`, file());
}

// 기본 8(덮어쓰기 반영) + 커스텀.
export function listRoles(): CrewRole[] {
  const s = readStored();
  const builtins = builtinRoles().map((b) => ({ ...b, ...(clean(s.overrides[b.id], true) ?? {}) }));
  const ids = new Set(builtins.map((b) => b.id));
  const custom = s.custom
    .map((c) => { const v = clean(c, false); return c && typeof c.id === "string" && ID_RE.test(c.id) && !ids.has(c.id) && v?.name ? { provider: "claude-code" as const, access: "write" as const, instructions: "", description: "", ...v, id: c.id, name: v.name } as CrewRole : null; })
    .filter((c): c is CrewRole => !!c);
  return [...builtins, ...custom];
}
export const getRole = (id: string | undefined) => (id ? listRoles().find((r) => r.id === id) : undefined);

export type RoleOp =
  | { op: "save"; role: Partial<CrewRole> & { id?: string } } // id 없으면 커스텀 새로(이름에서 id)
  | { op: "reset"; id: string }   // 기본 역할 → 기본값으로
  | { op: "delete"; id: string }; // 커스텀만

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function applyRoleOp(op: RoleOp): CrewRole[] {
  const s = readStored();
  const builtinIds = new Set(builtinRoles().map((b) => b.id));
  if (op.op === "save") {
    const id = op.role.id;
    if (id && builtinIds.has(id)) {
      s.overrides[id] = { ...s.overrides[id], ...clean(op.role, true) };
    } else {
      const v = clean(op.role, false) ?? {};
      const existing = id ? s.custom.findIndex((c) => c.id === id) : -1;
      if (existing >= 0) {
        if (v.name === "") throw new Error("name required"); // 이름 지우기는 안 됨(부분 수정은 이름 생략 가능)
        s.custom[existing] = { ...s.custom[existing], ...v } as CrewRole;
      } else {
        if (!v.name) throw new Error("name required");
        // 영문·숫자가 없는 이름(한글·일본어 등)은 slug가 비어 전부 "role-n"이 됨 → 짧은 무작위 id(#1397 리뷰)
        const base = slug(v.name);
        let nid = base && ID_RE.test(base) ? base : `bot-${randomBytes(3).toString("hex")}`, n = 2;
        const root = nid;
        // 카탈로그 id도 비워 둠 — 직접 만든 "Security Reviewer"가 카탈로그 보안 리뷰어 자리를 먹지 않게(리뷰)
        const taken = new Set([...builtinIds, ...CATALOG.map((c) => c.id), ...s.custom.map((c) => c.id)]);
        while (taken.has(nid)) nid = `${root}-${n++}`;
        s.custom.push({ provider: "claude-code", access: "write", instructions: "", description: "", ...v, id: nid, name: v.name } as CrewRole);
      }
    }
  } else if (op.op === "reset") {
    if (!builtinIds.has(op.id)) throw new Error("not builtin");
    delete s.overrides[op.id];
  } else if (op.op === "delete") {
    if (builtinIds.has(op.id)) throw new Error("builtin role cannot be deleted");
    s.custom = s.custom.filter((c) => c.id !== op.id);
    if (s.bots && Object.hasOwn(s.bots, op.id)) delete s.bots[op.id]; // 같은 이름으로 다시 만들 때 옛 봇 정보가 되살아나지 않게(리뷰)
  } else throw new Error("unknown op");
  writeStored(s);
  return listRoles();
}
