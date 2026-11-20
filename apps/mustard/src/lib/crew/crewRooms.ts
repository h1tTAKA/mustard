// Crew 대화방 목록(#1392) — 메신저처럼 봇 1:1 방 + 그룹방. 서버 전용.
// 방 id: 1:1 = "dm-<역할>"(정해진 이름 — 저장 없이 봇을 누르면 그 방), 그룹 = "g-<8자>"(rooms.json), 팀방 = room 없음(멤버 = 모든 봇, 옛 기록 전부).
// 저장 = ~/.nunopi/crew/<sha(root)>/rooms.json — tmp+rename.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface CrewRoom { id: string; members: string[]; name?: string; createdAt: number; updatedAt: number }

const ROLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ROOM_ID = /^(dm-[a-z0-9][a-z0-9-]{0,39}|g-[a-f0-9]{8})$/;
export const GROUP_MAX = 12; // 그룹 멤버 상한(회의·토론 AI 호출 수가 멤버 수에 비례)
const NAME_MAX = 40;

export const dmRoom = (role: string) => `dm-${role}`;
/** 1:1 방이면 그 역할, 아니면 null. */
export const dmRole = (room: string | undefined) => (room?.startsWith("dm-") ? room.slice(3) : null);
export const isGroupRoom = (room: string | undefined) => !!room && /^g-[a-f0-9]{8}$/.test(room);
/** 메시지·카드에 저장해도 되는 방 id(아니면 undefined = 팀방). */
export const cleanRoom = (r: unknown): string | undefined => (typeof r === "string" && ROOM_ID.test(r) ? r : undefined);

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const roomsFile = (root: string) => join(baseDir(), sha(normPath(root)), "rooms.json");

const cleanMembers = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && ROLE.test(x)))].slice(0, GROUP_MAX);
function sanitize(x: unknown): CrewRoom | null {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r.id !== "string" || !isGroupRoom(r.id)) return null;
  const members = cleanMembers(r.members);
  if (!members.length) return null;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, NAME_MAX) : "";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { id: r.id, members, ...(name ? { name } : {}), createdAt: num(r.createdAt), updatedAt: num(r.updatedAt) };
}

export function readRooms(root: string): CrewRoom[] {
  const f = roomsFile(root);
  if (!existsSync(f)) return [];
  try { const j = JSON.parse(readFileSync(f, "utf8")) as { rooms?: unknown }; return (Array.isArray(j.rooms) ? j.rooms : []).map(sanitize).filter((r): r is CrewRoom => !!r); }
  catch { return []; }
}
function writeRooms(root: string, rooms: CrewRoom[]) {
  const f = roomsFile(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify({ version: 1, rooms }, null, 1));
  renameSync(`${f}.tmp`, f);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export type RoomOp =
  | { op: "create"; members: string[]; name?: string }
  | { op: "invite"; id: string; members: string[] }
  | { op: "remove"; id: string; member: string }
  | { op: "rename"; id: string; name: string }
  | { op: "delete"; id: string };

/** 그룹방 바꾸기 — known = 지금 있는 봇 id들(없는 봇은 못 넣음). create는 같은 멤버 구성 방이 있으면 그 방을 돌려줌(existing). */
export function applyRoomOp(root: string, op: RoomOp, known: Set<string>, now = Date.now()): { room?: CrewRoom; existing?: boolean } {
  const rooms = readRooms(root);
  const pick = (v: unknown) => cleanMembers(v).filter((m) => known.has(m));
  if (op.op === "create") {
    const members = pick(op.members);
    if (members.length < 2) throw new Error("need 2+ members"); // 한 명이면 1:1 방(dm-)
    const same = rooms.find((r) => sameSet(r.members, members));
    if (same) return { room: same, existing: true };
    const name = String(op.name ?? "").trim().slice(0, NAME_MAX);
    const room: CrewRoom = { id: `g-${randomBytes(4).toString("hex")}`, members, ...(name ? { name } : {}), createdAt: now, updatedAt: now };
    writeRooms(root, [...rooms, room]);
    return { room };
  }
  const room = rooms.find((r) => r.id === op.id);
  if (!room) throw new Error("room not found");
  if (op.op === "delete") { writeRooms(root, rooms.filter((r) => r !== room)); return {}; }
  if (op.op === "invite") room.members = [...new Set([...room.members, ...pick(op.members)])].slice(0, GROUP_MAX);
  else if (op.op === "remove") {
    if (room.members.length <= 1) throw new Error("last member"); // 빈 방 대신 방 지우기
    room.members = room.members.filter((m) => m !== op.member);
  } else if (op.op === "rename") { const name = String(op.name ?? "").trim().slice(0, NAME_MAX); if (name) room.name = name; else delete room.name; }
  room.updatedAt = now;
  writeRooms(root, rooms);
  return { room };
}

/** 그 방에서 말할 수 있는 봇들 — 1:1 = 그 봇, 그룹 = 멤버(지금 있는 봇만), 팀방(없음) = 모든 봇. 없는 방이면 null. */
export function roomMembers(root: string, room: string | undefined, all: string[]): string[] | null {
  if (!room) return all;
  const dm = dmRole(room);
  if (dm) return all.includes(dm) ? [dm] : null;
  const r = readRooms(root).find((x) => x.id === room);
  return r ? r.members.filter((m) => all.includes(m)) : null;
}
