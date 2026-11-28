// 봇 할 일 티켓(#1404 H5) — 봇 폴더의 items.json. 서버 전용.
// 티켓 = #번호(봇마다 1부터) · 제목 · 상태 · 완료 조건 · 활동 기록(시간순: 만듦·상태 바뀜·댓글). 번호·시각·활동은 여기서만 매김(봇이 파일을 직접 고치지 않게).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { botHome, listBots } from "./crewBots.ts";

export const ITEM_STATUSES = ["open", "in-progress", "waiting", "needs-you", "done", "canceled"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemActivity = { at: number; by: "bot" | "owner"; kind: "created" | "status" | "comment" | "edit"; text?: string; status?: ItemStatus; title?: string; doneMeans?: string }; // edit = 제목·완료 조건 바꿈(새 값)
export type BotItem = { n: number; title: string; status: ItemStatus; doneMeans?: string; createdAt: number; updatedAt: number; activity: ItemActivity[] };
type Store = { next: number; items: BotItem[] };

const TITLE_MAX = 200, TEXT_MAX = 4000, ACTIVITY_MAX = 500; // 활동이 끝없이 쌓이지 않게(오래된 것부터 버림 — 만듦 기록은 남김)
const file = (bot: string) => join(botHome(bot), "items.json");
const isStatus = (s: unknown): s is ItemStatus => (ITEM_STATUSES as readonly string[]).includes(s as string);
const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
// 제목은 한 줄 — 줄바꿈으로 "[Mustard: …]" 같은 줄을 흉내 내 봇 대화 알림에 끼우지 못하게(리뷰)
const line = (s: unknown) => clip(typeof s === "string" ? s.replace(/\s+/g, " ") : s, TITLE_MAX);

// 있는 봇만(없는 봇 id로 아무 폴더나 만들지 않게) — 봇 id 규칙도 봇 목록이 보장
function ensureBot(bot: string) { if (!listBots().some((b) => b.id === bot)) throw new Error("not a bot"); }
function read(bot: string): Store {
  if (!existsSync(file(bot))) return { next: 1, items: [] };
  try {
    const j = JSON.parse(readFileSync(file(bot), "utf8")) as Partial<Store>;
    // 손으로 고친 파일 등 빠진 칸은 채워서 살림(버리면 다음 저장 때 조용히 사라짐, 리뷰)
    const items = (Array.isArray(j.items) ? j.items : []).filter((i) => i && typeof i.n === "number" && typeof i.title === "string").map((i) => ({
      ...i,
      status: isStatus(i.status) ? i.status : "open",
      createdAt: Number(i.createdAt) || 0,
      updatedAt: Number(i.updatedAt) || Number(i.createdAt) || 0,
      activity: Array.isArray(i.activity) ? i.activity.filter((a) => a && typeof a.at === "number") : [],
    }));
    return { next: Math.max(Number(j.next) || 1, ...items.map((i) => i.n + 1)), items };
  } catch { throw new Error("items.json unreadable"); } // 깨진 파일 위에 빈 목록을 덮어쓰지 않음
}
function write(bot: string, s: Store) { const f = file(bot); writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 1)); renameSync(`${f}.tmp`, f); }
const push = (it: BotItem, a: ItemActivity) => {
  it.activity.push(a);
  if (it.activity.length > ACTIVITY_MAX) it.activity.splice(1, it.activity.length - ACTIVITY_MAX); // [0] = 만듦
  it.updatedAt = a.at;
};

export function listItems(bot: string): BotItem[] { ensureBot(bot); return read(bot).items; }

export type ItemOp =
  | { op: "add"; title: string; doneMeans?: string; text?: string }
  | { op: "set"; n: number; status?: ItemStatus; title?: string; doneMeans?: string; text?: string } // text = 상태 바꾸는 이유(활동에 같이)
  | { op: "comment"; n: number; text: string };

// by = 누가(봇 도구 = bot, 화면 = owner). 결과 = 바뀐 티켓.
export function applyItemOp(bot: string, op: ItemOp, by: "bot" | "owner", now = Date.now()): BotItem {
  ensureBot(bot);
  const s = read(bot);
  if (op.op === "add") {
    const title = line(op.title);
    if (!title) throw new Error("title required");
    const it: BotItem = { n: s.next++, title, status: "open", createdAt: now, updatedAt: now, activity: [] };
    const dm = clip(op.doneMeans, TEXT_MAX); if (dm) it.doneMeans = dm;
    push(it, { at: now, by, kind: "created", ...(clip(op.text, TEXT_MAX) ? { text: clip(op.text, TEXT_MAX) } : {}) });
    s.items.push(it);
    write(bot, s);
    return it;
  }
  const it = s.items.find((i) => i.n === Number(op.n));
  if (!it) throw new Error(`no item #${op.n}`);
  if (op.op === "set") {
    const text = clip(op.text, TEXT_MAX);
    // 제목·완료 조건이 실제로 바뀌면 활동에 남김(티켓 글이 조용히 바뀌지 않게, 리뷰)
    const edit: ItemActivity = { at: now, by, kind: "edit" };
    if (op.title !== undefined) { const t = line(op.title); if (!t) throw new Error("title required"); if (t !== it.title) { it.title = t; edit.title = t; } }
    if (op.doneMeans !== undefined) { const dm = clip(op.doneMeans, TEXT_MAX); if (dm !== (it.doneMeans ?? "")) { if (dm) it.doneMeans = dm; else delete it.doneMeans; edit.doneMeans = dm; } }
    if (edit.title !== undefined || edit.doneMeans !== undefined) push(it, edit);
    if (op.status !== undefined) {
      if (!isStatus(op.status)) throw new Error("bad status");
      if (op.status !== it.status) { it.status = op.status; push(it, { at: now, by, kind: "status", status: op.status, ...(text ? { text } : {}) }); }
      else if (text) push(it, { at: now, by, kind: "comment", text });
    } else if (text) push(it, { at: now, by, kind: "comment", text });
    it.updatedAt = now;
  } else if (op.op === "comment") {
    const text = clip(op.text, TEXT_MAX);
    if (!text) throw new Error("text required");
    push(it, { at: now, by, kind: "comment", text });
  } else throw new Error("unknown op");
  write(bot, s);
  return it;
}
