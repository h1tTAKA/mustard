// Crew 역할 저장소(#1100) — 전역 ~/.nunopi/crew/roles.json. 서버 전용.
// 파일엔 "기본 역할 덮어쓰기 + 커스텀 역할"만 저장 → 읽을 때 기본 8과 합침(기본 지시문이 앱 업데이트로 바뀌면 안 건드린 역할은 새 기본값을 받음).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { builtinRoles, CREW_PROVIDERS, type CrewRole } from "./crewRoleDefaults.ts";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const file = () => join(baseDir(), "roles.json");

type Stored = { overrides: Record<string, Partial<CrewRole>>; custom: CrewRole[] };

function clean(x: unknown, builtin: boolean): Partial<CrewRole> | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const out: Partial<CrewRole> = {};
  if (typeof r.instructions === "string") out.instructions = r.instructions.slice(0, 20_000);
  if (typeof r.provider === "string" && (CREW_PROVIDERS as string[]).includes(r.provider)) out.provider = r.provider as CrewRole["provider"];
  if (typeof r.model === "string") out.model = r.model.trim().slice(0, 80) || undefined;
  if (r.access === "read" || r.access === "write") out.access = r.access;
  if (!builtin) {
    if (typeof r.name === "string") out.name = r.name.trim().slice(0, 60);
    if (typeof r.description === "string") out.description = r.description.trim().slice(0, 200);
  }
  return out;
}

function readStored(): Stored {
  try {
    if (!existsSync(file())) return { overrides: {}, custom: [] };
    const j = JSON.parse(readFileSync(file(), "utf8")) as Partial<Stored>;
    return { overrides: j.overrides && typeof j.overrides === "object" ? j.overrides : {}, custom: Array.isArray(j.custom) ? j.custom : [] };
  } catch { return { overrides: {}, custom: [] }; }
}
function writeStored(s: Stored) {
  mkdirSync(baseDir(), { recursive: true });
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
        let nid = slug(v.name) || "role", n = 2;
        const taken = new Set([...builtinIds, ...s.custom.map((c) => c.id)]);
        if (!ID_RE.test(nid)) nid = "role";
        while (taken.has(nid)) nid = `${slug(v.name) || "role"}-${n++}`;
        s.custom.push({ provider: "claude-code", access: "write", instructions: "", description: "", ...v, id: nid, name: v.name } as CrewRole);
      }
    }
  } else if (op.op === "reset") {
    if (!builtinIds.has(op.id)) throw new Error("not builtin");
    delete s.overrides[op.id];
  } else if (op.op === "delete") {
    if (builtinIds.has(op.id)) throw new Error("builtin role cannot be deleted");
    s.custom = s.custom.filter((c) => c.id !== op.id);
  } else throw new Error("unknown op");
  writeStored(s);
  return listRoles();
}
