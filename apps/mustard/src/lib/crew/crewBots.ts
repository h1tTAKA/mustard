// 봇(#1394, 에픽 #1391 재정의 2) — 봇 = "설치된" 역할 + 봇 정보(색·만든 시각·출처·임무) + 봇 폴더. 서버 전용.
// 역할(실행 설정)은 crewRoleStore 그대로 두고, roles.json의 bots 칸이 "화면에 보이는 봇 목록"을 정한다.
// 실행 엔진(listRoles)은 설치 여부와 무관하게 전 역할을 계속 본다 — 파이프라인이 안 깨지게.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { builtinRoles, CREW_PROVIDERS, type CrewProvider, type CrewRole } from "./crewRoleDefaults.ts";
import { applyRoleOp, listRoles, readStored, writeStored, type BotMeta, type Stored } from "./crewRoleStore.ts";
import { catalogItem, type L10n } from "./crewCatalog.ts";
import { CATALOG_AGENTS } from "./crewCatalogAgents.ts";

export type Bot = CrewRole & BotMeta & { home: string };

// 봇 아바타 바탕색(시안의 7색). 지정 안 하면 id로 고정 배정.
export const BOT_COLORS = ["#e8b93a", "#93c5fd", "#a5b4fc", "#86efac", "#fca5a5", "#fdba74", "#d4d4d8"];
const pickColor = (id: string) => BOT_COLORS[[...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % BOT_COLORS.length];
const cleanColor = (c: unknown) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined);

// bots는 일반 객체라 "__proto__"·"constructor" 같은 이름이 상속값으로 잡힘(리뷰) → 자기 칸만 봄.
const has = (bots: Record<string, BotMeta>, id: unknown) => typeof id === "string" && Object.hasOwn(bots, id);
const LOCALES = ["ko", "ja", "en"] as const;

const crewDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
export const botsDir = () => process.env.MUSTARD_BOTS_DIR || join(homedir(), ".nunopi", "bots");
export const botHome = (id: string) => join(botsDir(), id);

// 봇 폴더 — 정체성(ABOUT.md)·기억(MEMORY.md). 있으면 안 건드림(사용자·봇이 고친 내용 보존). 지울 때도 폴더는 남긴다.
function ensureHome(id: string, title: string, about: string) {
  const dir = botHome(id);
  mkdirSync(dir, { recursive: true });
  const a = join(dir, "ABOUT.md"), m = join(dir, "MEMORY.md");
  if (!existsSync(a)) writeFileSync(a, `# ${title}\n\n${about.trim()}\n`);
  if (!existsSync(m)) writeFileSync(m, `# Memory\n\n`);
}

// 옛 사용자 이전 — bots 칸이 없을 때 한 번. 커스텀 역할 전부 + 어느 레포든 보드·대화에 등장한 기본 역할.
// 한계: 역할 id가 따옴표째 들어 있는지만 본다(글 본문에 "app-builder"를 그대로 쓴 경우도 등장으로 침) — 넉넉히 옮기는 쪽이 안전.
export function migrateBots(s: Stored, now = Date.now()): Record<string, BotMeta> {
  // 커스텀 역할 전부 + 고쳐 둔 기본 역할(덮어쓰기) — 사용자가 손댄 건 다 옮김(리뷰)
  const used = new Set<string>([...s.custom.map((c) => c.id), ...Object.keys(s.overrides)].filter((id) => typeof id === "string"));
  const builtins = builtinRoles().map((b) => b.id);
  for (const id of [...used]) if (!builtins.includes(id) && !s.custom.some((c) => c.id === id)) used.delete(id); // 없는 역할 덮어쓰기는 버림
  try {
    const base = crewDir();
    const dirs = existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
    for (const d of dirs) {
      for (const f of ["board.json", "chat.jsonl"]) {
        const p = join(base, d.name, f);
        if (!existsSync(p)) continue;
        const text = readFileSync(p, "utf8");
        for (const id of builtins) if (text.includes(`"${id}"`)) used.add(id);
      }
    }
  } catch {
    builtins.forEach((id) => used.add(id)); // 읽기 실패 → 기본 8 전부(아무것도 안 보이는 것보다 안전)
  }
  return Object.fromEntries([...used].map((id) => [id, { color: pickColor(id), createdAt: now }]));
}

function stored(): Stored {
  const s = readStored();
  if (!s.bots) { s.bots = migrateBots(s); writeStored(s); }
  return s;
}

export function listBots(): Bot[] {
  const bots = stored().bots!;
  return listRoles()
    .filter((r) => has(bots, r.id))
    .map((r) => ({ ...r, ...bots[r.id], name: bots[r.id].name || r.name, home: botHome(r.id) }))
    .sort((a, b) => b.createdAt - a.createdAt); // 새 봇이 위
}

export type BotOp =
  | { op: "install"; catalog: string; color?: string; locale?: keyof L10n }  // 카탈로그 id. 외부 항목은 그 언어 이름으로 커스텀 역할 복사
  | { op: "create"; name: string; mission: string; provider?: CrewProvider; color?: string }
  | { op: "update"; id: string; name?: string; color?: string }
  | { op: "uninstall"; id: string };                                          // 목록에서만 뺌(역할·폴더 유지)

export function applyBotOp(op: BotOp, now = Date.now()): Bot[] {
  const s = stored();
  const bots = s.bots!;
  if (op.op === "install") {
    const item = catalogItem(op.catalog);
    if (!item) throw new Error("unknown catalog item");
    const color = cleanColor(op.color);
    if (item.builtin) {
      const role = builtinRoles().find((b) => b.id === item.id)!;
      ensureHome(role.id, role.id, role.instructions.split("\n")[0]); // 폴더 먼저 — 실패하면 목록에도 안 들어감(리뷰)
      if (!has(bots, role.id)) bots[role.id] = { color: color ?? pickColor(role.id), createdAt: now, catalog: role.id };
      writeStored(s);
    } else {
      // 외부 항목 = 커스텀 역할로 복사(사용자가 고쳐도 원본 그대로, 앱 업데이트로 원본이 바뀌어도 사용자 봇은 안 흔들림).
      // 같은 id 커스텀 역할이 이미 있으면(지웠다 다시 설치) 새로 복사하지 않고 그 역할을 봇으로 되살림(고친 지시문 보존).
      // 한계: 카탈로그 id 예약(crewRoleStore) 전에 같은 이름으로 직접 만든 역할도 이렇게 되살아남.
      const agent = CATALOG_AGENTS[item.id];
      if (!agent) throw new Error("unknown catalog item");
      const loc = LOCALES.find((l) => l === op.locale) ?? "en";
      const name = item.name![loc], about = item.desc![loc];
      if (!s.custom.some((c) => c.id === item.id))
        s.custom.push({ id: item.id, name, description: about, instructions: agent.instructions, provider: "claude-code", access: agent.access });
      ensureHome(item.id, name, about);
      if (!has(bots, item.id)) bots[item.id] = { color: color ?? pickColor(item.id), createdAt: now, catalog: item.id };
      writeStored(s);
    }
  } else if (op.op === "create") {
    const name = typeof op.name === "string" ? op.name.trim().slice(0, 60) : "";
    const mission = typeof op.mission === "string" ? op.mission.trim().slice(0, 4000) : "";
    if (!name) throw new Error("name required");
    if (!mission) throw new Error("mission required");
    const provider = op.provider && CREW_PROVIDERS.includes(op.provider) ? op.provider : "claude-code";
    const before = new Set(listRoles().map((r) => r.id));
    const role = applyRoleOp({ op: "save", role: { name, description: mission.split("\n")[0].slice(0, 200), instructions: mission, provider, access: "write" } })
      .find((r) => !before.has(r.id));
    if (!role) throw new Error("create failed");
    try { ensureHome(role.id, name, mission); } // 폴더 실패면 방금 만든 역할도 되돌림(다시 하면 -2가 안 붙게, 리뷰)
    catch (e) { try { applyRoleOp({ op: "delete", id: role.id }); } catch (e2) { console.warn(`[bots] 되돌리기 실패 — 남은 역할 ${role.id}`, e2); } throw e; }
    const s2 = readStored(); // applyRoleOp가 방금 쓴 파일(bots 칸 보존)
    s2.bots = { ...s2.bots, [role.id]: { color: cleanColor(op.color) ?? pickColor(role.id), createdAt: now, mission } };
    writeStored(s2);
  } else if (op.op === "update") {
    if (!has(bots, op.id)) throw new Error("not a bot");
    const b = bots[op.id];
    if (op.name !== undefined) {
      const n = String(op.name).trim().slice(0, 60);
      if (!n) throw new Error("name required");
      b.name = n;
    }
    if (op.color !== undefined) b.color = cleanColor(op.color) ?? b.color;
    writeStored(s);
  } else if (op.op === "uninstall") {
    if (!has(bots, op.id)) throw new Error("not a bot");
    delete bots[op.id];
    writeStored(s);
  } else throw new Error("unknown op");
  return listBots();
}
