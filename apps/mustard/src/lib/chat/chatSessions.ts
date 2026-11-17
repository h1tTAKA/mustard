// 채팅 모드 세션(#1341, 에픽 #1354) — 터미널 칸의 채팅 탭 하나 = SNA 세션 하나(cwd = 레포). 서버 전용 싱글톤.
// 흐름: 탭 만들기(기록만) → 첫 보내기 때 SNA 세션 만들고 에이전트 시작 → send. 이벤트는 chatTimeline이 화면 항목으로 접고
// 구독자(SSE)에게 바뀐 자리만 보냄. 권한: Claude = bypassPermissions + Mustard 훅(/api/chat/permission, Crew 훅 재사용),
// Codex = SNA 기본 승인 흐름(onPermissionRequest). 둘 다 Crew 정책(decide)으로 자동 허용, 나머지는 채팅에 허용/거절 카드.
// 저장: ~/.nunopi/chat/<sha(root)>/<id>.json(타임라인), 이미지는 ~/.nunopi/chat/img/<sha>.<ext>.
// 한계: 열린 채팅 탭마다 에이전트 프로세스가 살아 있음(SNA 동시 세션 상한을 Crew와 나눠 씀) — 모자라면 오래 쉰 탭부터 끄기.
// 실행 AI = SNA 런타임 5종(Claude Code·Codex·OpenCode·Grok·Cursor). 모델은 SNA listModels, 생각 강도는 reasoningLevel(0~5),
// 권한 모드 = plan(Claude만) / default(Crew 정책, 나머지 카드) / full(전부 허용). 탭 닫기 = 보관(기록 패널에서 다시 엶), 지우기는 따로.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSnaClient } from "@mustard/core/sna";
import { defaultSnaModel } from "@mustard/nunopi/server";
import { decide, fromAgentRequest } from "@/lib/crew/crewPolicy";
import { readPerms } from "@/lib/crew/crewPermStore";
import { HOOK_SRC } from "@/lib/crew/crewRunner";
import { applyEvent, itemsFromClaudeTranscript, takeCursor, type ChatItem, type Timeline } from "./chatTimeline";
import { projectDirFor } from "@/lib/subagents";
import { observeChat } from "./chatNarrate";
import { chatHookSrc } from "./chatHook";

export type ChatProvider = "claude-code" | "codex" | "opencode" | "grok" | "cursor";
export const CHAT_PROVIDERS: ChatProvider[] = ["claude-code", "codex", "opencode", "grok", "cursor"];
export type ChatMode = "plan" | "default" | "full";
export const asProvider = (v: unknown): ChatProvider => (CHAT_PROVIDERS.includes(v as ChatProvider) ? (v as ChatProvider) : "claude-code");
const AGENT_ID: Record<ChatProvider, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor" };
const asMode = (v: unknown): ChatMode => (v === "plan" || v === "full" ? v : "default");
export interface ChatMeta { id: string; title: string; provider: ChatProvider; model: string; effort?: number; mode: ChatMode; createdAt: number; updatedAt: number; busy: boolean; archived: boolean; count: number; cc?: string; handedOff?: boolean }
export type ChatPush =
  | { type: "snapshot"; items: ChatItem[]; streaming: string; busy: boolean; title: string; provider: ChatProvider }
  | { type: "item"; i: number; item: ChatItem }
  | { type: "delta"; streaming: string }
  | { type: "busy"; busy: boolean };

interface Chat {
  id: string; root: string; cwd: string; provider: ChatProvider; title: string; createdAt: number; updatedAt: number;
  model?: string; effort?: number; mode: ChatMode; archived?: boolean;
  sid?: string; cc?: string; token: string; tl: Timeline; // cc = Claude CLI 대화 id(init 이벤트) — 재시작 뒤 --resume
  bg?: number;
  replaying?: boolean; // #1358 다시 붙어 지난 이벤트를 받는 중 — 그 작업은 캐치업 백필(CLI 기록)이 해설하므로 실시간 해설은 건너뜀(두 번 해설 방지)
  cur?: number; // #1358 마지막으로 접은 SNA 이벤트 번호(cursor) — 앱이 꺼진 동안 쌓인 것을 다시 열 때 이 뒤부터 받아 채움
  stopping?: boolean; // 멈춤을 눌렀음 — 실측: 끊기면 interrupted 대신 error("Unknown error")가 옴 → 멈춤으로 표시
  pending: Map<string, (ok: boolean) => void>; // 사람 답을 기다리는 권한 카드(permId별 — 병렬 도구가 둘 다 물어도 각자 카드)
  handedOff?: boolean; // 터미널로 넘김 — 같은 대화를 두 프로세스가 쓰지 않게 채팅에서 보내기 막음
  starting?: Promise<void>; // 에이전트 띄우는 중(겹친 보내기가 세션을 또 만들지 않게)
}
type G = { chats: Map<string, Chat>; bySid: Map<string, string>; subs: Map<string, Set<(p: ChatPush) => void>>; loaded: Set<string>; flush: Map<string, ReturnType<typeof setTimeout>>; subscribed: Set<string>; wired: boolean; wiring?: Promise<void> };
const g = ((globalThis as unknown as { __mustardChat?: G }).__mustardChat ??= { chats: new Map(), bySid: new Map(), subs: new Map(), loaded: new Set(), flush: new Map(), subscribed: new Set(), wired: false } as G);

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CHAT_DIR || join(homedir(), ".nunopi", "chat");
const rootDir = (root: string) => join(baseDir(), sha(root.replace(/\/+$/, "")));
const imgDir = () => join(baseDir(), "img");
const hookPath = () => join(baseDir(), "claude-hook.cjs");
const ID_RE = /^[a-f0-9-]{36}$/;
const IMG_RE = /^[a-f0-9]{40}\.(png|jpe?g|webp|gif)$/;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function saveImage(base64: string, mime: string): string {
  const ext = EXT[mime.toLowerCase()];
  if (!ext) return "";
  const buf = Buffer.from(base64, "base64");
  if (!buf.length || buf.length > 20 * 1024 * 1024) return "";
  const name = `${createHash("sha1").update(buf).digest("hex")}.${ext}`;
  mkdirSync(imgDir(), { recursive: true });
  const f = join(imgDir(), name);
  if (!existsSync(f)) writeFileSync(f, buf);
  return name;
}
export function readImage(name: string): { buf: Buffer; mime: string } | null {
  if (!IMG_RE.test(name)) return null; // 경로 조작 막기 — 우리가 지은 이름 꼴만
  try { const ext = name.split(".").pop()!; return { buf: readFileSync(join(imgDir(), name)), mime: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}` }; } catch { return null; }
}

// ── 저장 ────────────────────────────────────────────────────────────
function persist(c: Chat, now = false) {
  const write = () => {
    g.flush.delete(c.id);
    if (!g.chats.has(c.id)) return; // 닫힌 탭
    const d = rootDir(c.root); mkdirSync(d, { recursive: true });
    const f = join(d, `${c.id}.json`);
    writeFileSync(`${f}.tmp`, JSON.stringify({ id: c.id, root: c.root, cwd: c.cwd, provider: c.provider, model: c.model, effort: c.effort, mode: c.mode, archived: c.archived, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, sid: c.sid, cc: c.cc, cur: c.cur, token: c.token, handedOff: c.handedOff, items: c.tl.items }), { mode: 0o600 });
    renameSync(`${f}.tmp`, f);
  };
  const t = g.flush.get(c.id);
  if (now) { if (t) clearTimeout(t); write(); return; }
  if (!t) g.flush.set(c.id, setTimeout(write, 800));
}
function load(root: string) {
  if (g.loaded.has(root)) return;
  g.loaded.add(root);
  let files: string[] = [];
  try { files = readdirSync(rootDir(root)).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(rootDir(root), f), "utf8"));
      if (!ID_RE.test(j.id) || g.chats.has(j.id)) continue;
      // #1358 앱이 꺼진 동안 기다리던 권한 카드는 뺌 — 에이전트가 아직 기다리면 다시 물어 새 카드가 뜸(Claude 훅 재시도·Codex 대기 권한), 끝났으면 의미 없음
      const items = (Array.isArray(j.items) ? j.items : []).filter((it: ChatItem) => !(it.k === "perm" && it.state === "pending"));
      g.chats.set(j.id, { id: j.id, root, cwd: j.cwd || root, provider: asProvider(j.provider), model: typeof j.model === "string" ? j.model : undefined, effort: typeof j.effort === "number" ? j.effort : undefined, mode: asMode(j.mode), archived: !!j.archived, title: String(j.title ?? ""), createdAt: Number(j.createdAt) || 0, updatedAt: Number(j.updatedAt) || Number(j.createdAt) || 0, sid: j.sid, cc: typeof j.cc === "string" ? j.cc : undefined, cur: Number.isInteger(j.cur) ? j.cur : undefined, token: typeof j.token === "string" && /^[a-f0-9-]{36}$/.test(j.token) ? j.token : randomUUID() /* #1358 앱이 꺼진 동안 살아 있던 claude의 훅이 같은 토큰으로 들어옴 — 매번 새로 만들면 "unknown chat"으로 전부 거부 */, pending: new Map(), handedOff: !!j.handedOff, tl: { items, streaming: "", busy: false } });
      if (j.sid) g.bySid.set(j.sid, j.id);
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  void reattach(root).catch(() => {}); // #1358 앱이 꺼진 동안에도 돈 채팅 — 살아 있는 세션에 바로 붙어 빈 구간 채우기
}

// ── 구독(SSE) ────────────────────────────────────────────────────────
function emit(id: string, p: ChatPush) { for (const f of g.subs.get(id) ?? []) { try { f(p); } catch { /* 끊긴 구독자 */ } } }
export function subscribe(root: string, id: string, f: (p: ChatPush) => void): (() => void) | null {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return null;
  f({ type: "snapshot", items: c.tl.items, streaming: c.tl.streaming, busy: c.tl.busy, title: c.title, provider: c.provider });
  let set = g.subs.get(id); if (!set) g.subs.set(id, (set = new Set<(p: ChatPush) => void>()));
  set.add(f);
  return () => { set!.delete(f); };
}
function pushItem(c: Chat, item: ChatItem) { c.tl.items.push(item); const i = c.tl.items.length - 1; emit(c.id, { type: "item", i, item }); return i; }
function setItem(c: Chat, i: number, item: ChatItem) { c.tl.items[i] = item; emit(c.id, { type: "item", i, item }); }
function denyAll(c: Chat) { for (const done of [...c.pending.values()]) done(false); }
function setBusy(c: Chat, busy: boolean) { c.bg = (c.bg ?? 0) + 1; if (c.tl.busy !== busy) { c.tl.busy = busy; emit(c.id, { type: "busy", busy }); } } // bg = 바쁨을 정한 횟수(다시 붙을 때 그 사이 누가 정했는지 보려고)

// ── 목록·만들기·닫기 ────────────────────────────────────────────────
// Claude 최신 모델 — SNA 고정 목록은 옛 버전(Opus 4.7 등)이라 앞에 직접 둠(실측 11-14: CLI 2.1.325에서 이 id로 실행됨, opus 별칭 = claude-opus-5-5).
// 한계: 새 모델이 나오면 여기 갱신.
export interface ModelInfo { id: string; label: string; description?: string; legacy?: boolean }
const CLAUDE_LATEST: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", description: "Complex coding and everyday work" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", description: "Hardest, longest-running problems" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", description: "Fast and efficient for simpler tasks" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", description: "Quickest answers" },
];
export function defaultModel(p: ChatProvider): string {
  if (p === "claude-code") return CLAUDE_LATEST[0].id;
  return p === "grok" ? "grok-build" : p === "cursor" ? "auto" : defaultSnaModel(p); // 비우면 SNA가 Claude 모델을 넣어 다른 AI가 바로 실패(Crew와 같은 이유)
}
const metaOf = (c: Chat): ChatMeta => ({ id: c.id, title: c.title, provider: c.provider, model: c.model || defaultModel(c.provider), ...(c.effort !== undefined ? { effort: c.effort } : {}), mode: c.mode, createdAt: c.createdAt, updatedAt: c.updatedAt, busy: c.tl.busy, archived: !!c.archived, count: c.tl.items.filter((i) => i.k === "user").length, ...(c.cc ? { cc: c.cc } : {}), ...(c.handedOff ? { handedOff: true } : {}) });
// 열린 탭(보관 안 된 것, 만든 순)
export function listChats(root: string): ChatMeta[] {
  load(root);
  return [...g.chats.values()].filter((c) => c.root === root && !c.archived).sort((a, b) => a.createdAt - b.createdAt).map(metaOf);
}
// 기록 패널 — 이 레포의 모든 채팅(최근 순, 빈 채팅 제외)
export function historyChats(root: string): ChatMeta[] {
  load(root);
  return [...g.chats.values()].filter((c) => c.root === root && c.tl.items.length).sort((a, b) => b.updatedAt - a.updatedAt).map(metaOf);
}
export function createChat(root: string, provider: ChatProvider, opts: { model?: string; effort?: number; mode?: ChatMode } = {}): ChatMeta {
  load(root);
  const now = Date.now();
  const c: Chat = { id: randomUUID(), root, cwd: root, provider, model: opts.model, effort: opts.effort, mode: opts.mode ?? "default", title: "", createdAt: now, updatedAt: now, token: randomUUID(), pending: new Map(), tl: { items: [], streaming: "", busy: false } };
  g.chats.set(c.id, c);
  persist(c, true);
  return metaOf(c);
}
const permModeOf = (c: Chat) => (c.provider === "claude-code" ? (c.mode === "plan" ? "plan" : "bypassPermissions") : c.mode === "full" ? "bypassPermissions" : "acceptEdits");
// 입력 카드의 고르기 — 실행 AI는 첫 메시지 전만, 모델·권한 모드는 대화 중에도(살아 있으면 바로), 생각 강도는 쉬는 중이면 다시 띄워 적용.
export async function setOptions(root: string, id: string, o: { provider?: unknown; model?: unknown; effort?: unknown; mode?: unknown }): Promise<ChatMeta | null> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return null;
  const started = !!c.sid || c.tl.items.length > 0;
  if (o.provider !== undefined && !started) { c.provider = asProvider(o.provider); c.model = undefined; if (c.provider !== "claude-code" && c.mode === "plan") c.mode = "default"; }
  const sna = c.sid ? await getSnaClient().catch(() => null) : null;
  const alive = sna && c.sid ? (await sna.agent.getStatus(c.sid).catch(() => null))?.alive : false;
  if (typeof o.model === "string" && o.model.trim() && o.model !== c.model) {
    c.model = o.model.trim().slice(0, 120);
    if (alive) await sna!.agent.update(c.sid!, { model: c.model }).catch(() => {});
  }
  if (o.mode !== undefined) {
    const before = permModeOf(c);
    c.mode = asMode(o.mode); if (c.provider !== "claude-code" && c.mode === "plan") c.mode = "default";
    if (alive && permModeOf(c) !== before) await sna!.agent.setPermissionMode(c.sid!, permModeOf(c)).catch(() => {});
  }
  if (o.effort !== undefined) {
    const e = o.effort === null ? undefined : Math.max(0, Math.min(5, Math.round(Number(o.effort))));
    if (e !== c.effort) {
      c.effort = Number.isFinite(e) ? e : undefined;
      // 한계: 생각 강도는 시작 설정이라 쉬는 중이면 다시 띄움(대화는 이어짐), 일하는 중이면 다음 시작부터
      if (alive && !c.tl.busy) await sna!.agent.restart(c.sid!, { reasoningLevel: c.effort as 0 | 1 | 2 | 3 | 4 | 5 | undefined }).catch(() => {});
    }
  }
  persist(c, true);
  return metaOf(c);
}
// 닫기 = 보관(에이전트는 끄고 기록 패널에 남김). 다시 열기·지우기는 기록 패널에서.
export async function closeChat(root: string, id: string): Promise<boolean> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return false;
  denyAll(c);
  if (!c.tl.items.length) return deleteChat(root, id); // 빈 채팅은 남길 것 없음
  c.archived = true;
  await killAgent(c);
  persist(c, true);
  return true;
}
export function reopenChat(root: string, id: string): ChatMeta | null {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return null;
  c.archived = false; persist(c, true);
  return metaOf(c);
}
// 터미널로 넘긴 대화를 다시 채팅에서 — 사람이 터미널 쪽을 끝냈다고 고른 것
export function resumeHere(root: string, id: string): ChatMeta | null {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return null;
  c.handedOff = false; persist(c, true);
  return metaOf(c);
}
export async function deleteChat(root: string, id: string): Promise<boolean> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return false;
  denyAll(c);
  await killAgent(c);
  g.chats.delete(id); g.subs.delete(id);
  rmSync(join(rootDir(root), `${id}.json`), { force: true });
  return true;
}
async function killAgent(c: Chat) {
  if (!c.sid) return;
  const sid = c.sid;
  g.bySid.delete(sid); g.subscribed.delete(sid); c.sid = undefined; setBusy(c, false);
  await getSnaClient().then((s) => s.agent.kill(sid)).catch(() => {});
}
// 터미널에서 이어 하기 — 같은 대화를 두 프로세스가 쓰지 않게 채팅 에이전트를 먼저 끄고 CLI 대화 id를 돌려줌(그 id로 터미널이 resume)
export async function handoffChat(root: string, id: string): Promise<{ provider: ChatProvider; cc?: string } | null> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return null;
  denyAll(c);
  await killAgent(c);
  c.handedOff = true;
  persist(c, true);
  return { provider: c.provider, ...(c.cc ? { cc: c.cc } : {}) };
}

// ── 터미널(CLI)에서 했던 Claude 대화 가져오기 ─────────────────────────
const CC_RE = /^[a-f0-9-]{36}$/;
function readTail(file: string, n: number): string {
  const fd = openSync(file, "r");
  try { const size = fstatSync(fd).size, buf = Buffer.alloc(Math.min(n, size)); readSync(fd, buf, 0, buf.length, size - buf.length); return buf.toString("utf8"); } finally { closeSync(fd); }
}
function readHead(file: string, n: number): string {
  const fd = openSync(file, "r");
  try { const buf = Buffer.alloc(n); const got = readSync(fd, buf, 0, n, 0); return buf.subarray(0, got).toString("utf8"); } finally { closeSync(fd); }
}
export function listCliSessions(root: string): { id: string; title: string; mtime: number }[] {
  load(root);
  const linked = new Set([...g.chats.values()].map((c) => c.cc).filter(Boolean));
  const dir = projectDirFor(root);
  let files: { id: string; mtime: number }[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ id: f.slice(0, -6), mtime: statSync(join(dir, f)).mtimeMs })).filter((f) => CC_RE.test(f.id) && !linked.has(f.id)); } catch { return []; }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, 40).map((f) => {
    let title = "";
    try {
      const head = readHead(join(dir, `${f.id}.jsonl`), 256 * 1024).split("\n").slice(0, -1); // 앞부분만(기록 파일은 수백 MB일 수 있음), 잘린 끝 줄은 버림
      const first = itemsFromClaudeTranscript(head, () => "").find((i) => i.k === "user");
      title = first && first.k === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    } catch { /* 제목 없이 */ }
    return { ...f, title };
  }).filter((f) => f.title);
}
export function importCliSession(root: string, cc: string): ChatMeta | null {
  if (!CC_RE.test(cc)) return null;
  load(root);
  const dup = [...g.chats.values()].find((c) => c.root === root && c.cc === cc); // 두 번 가져와도 채팅은 하나(같은 대화를 둘이 resume하지 않게, 리뷰)
  if (dup) { dup.archived = false; persist(dup, true); return metaOf(dup); }
  let lines: string[];
  try {
    const f = join(projectDirFor(root), `${cc}.jsonl`);
    const size = statSync(f).size, MAX = 30 * 1024 * 1024;
    // 기록이 크면 뒤쪽(최근) 30MB만 — 통째로 읽다 메모리가 터지지 않게(리뷰). 잘린 첫 줄은 버림
    lines = size > MAX ? readTail(f, MAX).split("\n").slice(1) : readFileSync(f, "utf8").split("\n");
  } catch { return null; }
  const items = itemsFromClaudeTranscript(lines, saveImage);
  const first = items.find((i) => i.k === "user");
  const now = Date.now();
  const c: Chat = { id: randomUUID(), root, cwd: root, provider: "claude-code", mode: "default", cc, title: first && first.k === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 40) : "CLI", createdAt: now, updatedAt: now, token: randomUUID(), pending: new Map(), tl: { items, streaming: "", busy: false } };
  g.chats.set(c.id, c);
  persist(c, true);
  return metaOf(c); // 다음 보내기 때 --resume cc 로 이어 시작
}

// 모델 목록(SNA listModels) — 실행 AI마다 10분 캐시
const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();
export async function listModels(p: ChatProvider): Promise<ModelInfo[]> {
  const hit = modelCache.get(p);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const r = await (await getSnaClient()).agent.listModels(p, {}).catch(() => null);
  let models: ModelInfo[] = (r?.models ?? []).filter((m) => !m.deprecated).map((m) => ({ id: m.id, label: m.label || m.id, ...(m.notes ? { description: m.notes } : {}) }));
  // Claude: 최신을 앞에, SNA 목록의 별칭(opus·sonnet·haiku — 이름이 옛 버전으로 붙어 헷갈림)은 빼고 나머지는 옛 모델로 뒤에
  if (p === "claude-code") models = [...CLAUDE_LATEST, ...models.filter((m) => !/^(opus|sonnet|haiku)$/.test(m.id) && !CLAUDE_LATEST.some((x) => x.id === m.id)).map((m) => ({ ...m, legacy: true }))];
  if (!models.some((m) => m.id === defaultModel(p))) models.unshift({ id: defaultModel(p), label: defaultModel(p) });
  if (r && !r.error) modelCache.set(p, { at: Date.now(), models }); // 실패·부분 결과는 캐시 안 함(리뷰)
  return models;
}

// ── 에이전트 ────────────────────────────────────────────────────────
function wire(): Promise<void> {
  g.wiring ??= wireOnce().catch((e) => { g.wiring = undefined; throw e; }); // 실패하면 다음 보내기 때 다시(리뷰: 영영 안 붙던 문제)
  return g.wiring;
}
async function wireOnce() {
  const sna = await getSnaClient();
  sna.agent.onEvent(({ session, cursor, event, isHistory }) => {
    if (isHistory) return;
    const c = g.chats.get(g.bySid.get(session) ?? "");
    if (!c) return;
    if (!takeCursor(c, cursor)) return; // #1358 다시 붙을 때 받은 것 중 이미 접은 건 건너뜀
    const wasBusy = c.tl.busy;
    let ev = event as Record<string, unknown>;
    if (ev.type === "init") { const cc = (ev.data as { sessionId?: unknown } | undefined)?.sessionId; if (typeof cc === "string" && cc !== c.cc) { c.cc = cc; persist(c); } }
    if (c.stopping && ev.type === "error") ev = { type: "interrupted" };
    if (ev.type === "complete" || ev.type === "interrupted" || ev.type === "error") c.stopping = false;
    const r = applyEvent(c.tl, ev, saveImage);
    if (!c.replaying) observeChat(c.id, c.cwd, AGENT_ID[c.provider], ev); // 캐치업 실시간 해설(터미널과 같은 narrate)
    for (const i of r.changed) emit(c.id, { type: "item", i, item: c.tl.items[i] });
    if (r.delta) emit(c.id, { type: "delta", streaming: c.tl.streaming });
    if (wasBusy !== c.tl.busy) emit(c.id, { type: "busy", busy: c.tl.busy });
    if (r.changed.length) persist(c);
  });
  // Codex(SNA 승인 흐름) — 정책으로 바로 답하거나 채팅 카드로 사람에게
  sna.agent.onPermissionRequest(({ session, request }) => {
    const c = g.chats.get(g.bySid.get(session) ?? "");
    if (!c) return;
    if (c.pending.size) { void sna.agent.respondPermission(session, false).catch(() => {}); return; } // SNA 응답엔 요청 id가 없어 먼저 온 카드가 우선 — 겹친 요청은 거절(매달리지 않게, 리뷰)
    const { tool, input } = fromAgentRequest((request ?? {}) as Record<string, unknown>);
    void ask(c, tool, input).then((ok) => sna.agent.respondPermission(session, ok)).catch(() => {});
  });
  await sna.agent.subscribePermissions().catch(() => {});
  // #1358 SNA 클라이언트는 끊겼다 붙으면 번호 없이 다시 구독함(그 사이 이벤트 빠짐) → 우리가 마지막 번호부터 다시 구독
  sna.onConnectionStatus((st) => {
    if (st !== "connected") return;
    for (const c of g.chats.values()) if (c.sid && g.subscribed.has(c.sid)) { const sid = c.sid; c.replaying = true; void sna.agent.getStatus(sid).catch(() => undefined).then((st) => sna.agent.subscribe(sid, sinceOf(c, st?.eventCount))).catch(() => {}).finally(() => { c.replaying = false; }); }
  });
}

// 번호를 아는 채팅만 since로(0을 주면 SNA가 DB 기록 전체를 다른 번호 체계로 다시 보내 겹침) — 번호 없는 옛 채팅은 지금부터만
// SNA는 최근 500개만 들고 있고, since가 그보다 오래되면 받은 이벤트에 번호를 어긋나게 붙임(리뷰) → 간격이 크면 지금부터만 받고 번호를 서버 값으로 맞춤
const BUF = 450;
function sinceOf(c: Chat, eventCount?: number) {
  if (!c.cur) return undefined;
  if (eventCount !== undefined && eventCount - c.cur > BUF) { c.cur = eventCount; return undefined; }
  return { since: c.cur };
}

// #1358 앱(Next)이 다시 뜨면 — 저장된 채팅 중 SNA 세션이 아직 살아 있는 것(앱이 닫힌 동안에도 일함)에 붙어 그동안의 이벤트를 받아 접음.
// 한계: SNA는 세션마다 최근 이벤트 500개만 들고 있어 그보다 많이 쌓였으면 앞부분은 화면에 안 채워짐(대화 자체·캐치업 기록은 남음).
async function reattach(root: string) {
  const mine = [...g.chats.values()].filter((c) => c.root === root && c.sid && !c.handedOff);
  if (!mine.length) return;
  await wire();
  const sna = await getSnaClient();
  for (const c of mine) {
    const sid = c.sid!;
    const st = await sna.agent.getStatus(sid).catch(() => null);
    if (!st?.alive) continue; // 꺼진 세션 — 다음 보내기 때 이어 시작(ensureAgent)
    if (!g.subscribed.has(sid)) { g.subscribed.add(sid); c.replaying = true; await sna.agent.subscribe(sid, sinceOf(c, st.eventCount)).catch(() => { g.subscribed.delete(sid); }).finally(() => { c.replaying = false; }); } // 지난 이벤트는 구독 응답 전에 옴
    const g0 = c.bg ?? 0, cur0 = c.cur;
    const now = await sna.agent.getStatus(sid).catch(() => null); // 바쁨은 구독(지난 이벤트 접기)이 끝난 뒤 상태로
    if (now && !c.starting && (c.bg ?? 0) === g0 && c.cur === cur0) setBusy(c, now.agentStatus === "busy"); // 묻는 사이 이벤트·보내기로 바뀌었으면 그쪽이 최신(옛 값으로 덮지 않게, 리뷰)
    persist(c);
    // Codex 등(SNA 승인 흐름): 앱이 닫힌 동안 들어와 SNA가 붙잡고 있는 권한 요청 → 카드로 되살림(Claude는 훅이 다시 물어 옴)
    if (c.provider !== "claude-code" && !c.pending.size) {
      const { pending } = await sna.agent.getPendingPermissions(sid).catch(() => ({ pending: [] as { request: Record<string, unknown> }[] }));
      const p = pending[0];
      if (p && !c.pending.size) { const { tool, input } = fromAgentRequest((p.request ?? {}) as Record<string, unknown>); void ask(c, tool, input).then((ok) => sna.agent.respondPermission(sid, ok)).catch(() => {}); }
    }
  }
}

// 정책 → 허용이면 바로, 아니면 채팅에 카드(최대 10분, 넘으면 거절). 채팅은 사람이 직접 모는 자리라 Crew의 '사람만'(push 등)도 묻기로.
function ask(c: Chat, tool: string, input: Record<string, unknown>): Promise<boolean> {
  if (c.mode === "full") return Promise.resolve(true); // 전부 허용 모드
  if (decide(tool, input, c.cwd, readPerms()) === "allow") return Promise.resolve(true);
  const permId = randomUUID();
  const i = pushItem(c, { k: "perm", id: permId, tool, input: JSON.stringify(input).slice(0, 2000), state: "pending" });
  persist(c);
  return new Promise<boolean>((res) => {
    const timer = setTimeout(() => done(false), 10 * 60_000);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      c.pending.delete(permId);
      const it = c.tl.items[i];
      if (it?.k === "perm" && it.id === permId) { setItem(c, i, { ...it, state: ok ? "allowed" : "denied" }); persist(c); }
      res(ok);
    };
    c.pending.set(permId, done);
  });
}
export function answerPermission(root: string, id: string, permId: string, allow: boolean): boolean {
  const c = g.chats.get(id);
  const done = c?.root === root ? c.pending.get(permId) : undefined;
  if (!done) return false;
  done(allow);
  return true;
}
// Claude 훅 창구 — 탭마다 무작위 토큰으로만 통과
export async function hookDecision(id: string, token: string, tool: string, input: Record<string, unknown>): Promise<{ decision: "allow" | "deny"; reason?: string }> {
  const c = g.chats.get(id) ?? findChat(id); // #1358 앱이 다시 뜬 직후엔 그 레포 채팅을 아직 안 읽었을 수 있음(읽기는 레포를 열 때) — 훅이 먼저 오면 찾아 읽음
  if (!c || c.token !== token) return { decision: "deny", reason: "unknown chat" };
  return (await ask(c, tool, input)) ? { decision: "allow" } : { decision: "deny", reason: "The user denied this action" };
}

// 채팅 id로 저장 파일을 찾아 그 레포 채팅을 읽음(훅이 화면보다 먼저 올 때)
function findChat(id: string): Chat | undefined {
  if (!ID_RE.test(id)) return undefined;
  let dirs: string[] = [];
  try { dirs = readdirSync(baseDir()); } catch { return undefined; }
  for (const d of dirs) {
    try { const j = JSON.parse(readFileSync(join(baseDir(), d, `${id}.json`), "utf8")); if (typeof j.root === "string") { load(j.root); return g.chats.get(id); } } catch { /* 이 폴더엔 없음 */ }
  }
  return undefined;
}

const safeOrigin = (o: string) => (/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o) ? o : `http://127.0.0.1:${Number(process.env.PORT) || 59720}`);

// 살아 있는 에이전트 확보 — 없으면(첫 보내기·앱 재시작 뒤) SNA 세션을 만들거나 저장된 대화로 이어 시작.
function ensureAgent(c: Chat, origin: string): Promise<void> {
  c.starting ??= ensureAgentOnce(c, origin).finally(() => { c.starting = undefined; }); // 겹친 보내기는 같은 시작을 기다림(리뷰)
  return c.starting;
}
async function ensureAgentOnce(c: Chat, origin: string) {
  await wire();
  const sna = await getSnaClient();
  const isClaude = c.provider === "claude-code";
  const config = {
    provider: c.provider, model: c.model || defaultModel(c.provider), cwd: c.cwd,
    permissionMode: permModeOf(c),
    ...(c.effort !== undefined ? { reasoningLevel: c.effort as 0 | 1 | 2 | 3 | 4 | 5 } : {}),
    ...(isClaude ? { providerOptions: { settings: { hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: `node "${hookPath()}" --url=${safeOrigin(origin)} --run=${c.id} --token=${c.token}`, timeout: 900 }] }] } } } } : {}),
    // Codex: 작업 폴더마다 로그인 복사본을 만들면 리프레시 토큰이 서로 깨짐 → 사용자 CODEX_HOME 공유(Crew #1108과 같은 이유)
    ...(c.provider === "codex" ? { configDir: process.env.CODEX_HOME?.trim() || join(homedir(), ".codex") } : {}),
  };
  if (isClaude) { mkdirSync(baseDir(), { recursive: true }); writeFileSync(hookPath(), chatHookSrc(HOOK_SRC)); }
  if (c.sid) {
    const st = await sna.agent.getStatus(c.sid).catch(() => null);
    if (st?.alive) { if (!g.subscribed.has(c.sid)) { await sna.agent.subscribe(c.sid, sinceOf(c, st.eventCount)); g.subscribed.add(c.sid); } return; } // 서버만 다시 뜬 경우 — 살아 있는 세션 구독부터
    g.bySid.delete(c.sid); c.sid = undefined;
  }
  // 앱 재시작 뒤(에이전트 없음) — 새 SNA 세션. Claude는 CLI 대화 id로 이어 시작(--resume, 실측: SNA resume은 맥락이 안 이어짐).
  // 한계: Claude 말고는 이어 시작이 없어 맥락이 처음부터(화면 기록은 남음).
  const { sessionId } = await sna.sessions.create({ label: `chat:${c.title.slice(0, 40) || c.id.slice(0, 8)}`, cwd: c.cwd, meta: { mustardChat: true, root: c.root, chatId: c.id } });
  c.sid = sessionId; c.cur = undefined; g.bySid.set(sessionId, c.id); // 새 세션은 이벤트 번호가 처음부터
  persist(c, true);
  await sna.agent.subscribe(sessionId); g.subscribed.add(sessionId);
  await sna.agent.start(sessionId, { ...config, ...(isClaude && c.cc ? { extraArgs: ["--resume", c.cc] } : {}), meta: { mustardChat: true, chatId: c.id } });
}

// 보내기 — 일하는 중에 보내도 됨(실측: 같은 턴에 이어 붙음). 이미지는 저장해 화면에 보이고 에이전트에도 같이 감.
export async function sendChat(root: string, id: string, text: string, images: { base64: string; mime: string }[], origin: string): Promise<{ ok: boolean; error?: string }> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return { ok: false, error: "unknown chat" };
  if (c.handedOff) return { ok: false, error: "handed-off" }; // 터미널에서 이어 하는 중 — 같은 기록 파일에 둘이 쓰면 꼬임
  const ids = images.map((im) => saveImage(im.base64, im.mime)).filter(Boolean);
  pushItem(c, { k: "user", text, ...(ids.length ? { images: ids } : {}) });
  c.updatedAt = Date.now(); c.archived = false;
  if (!c.title) c.title = text.replace(/\s+/g, " ").trim().slice(0, 40) || "image";
  setBusy(c, true);
  persist(c, true);
  try {
    await ensureAgent(c, origin);
    await (await getSnaClient()).agent.send(c.sid!, text || "(image)", images.length ? { images: images.map((im) => ({ base64: im.base64, mimeType: im.mime })) } : undefined);
    return { ok: true };
  } catch (e) {
    const why = String((e as Error)?.message ?? e).slice(0, 400);
    pushItem(c, { k: "error", text: why }); setBusy(c, false); persist(c);
    return { ok: false, error: why };
  }
}

export async function stopChat(root: string, id: string): Promise<boolean> {
  const c = g.chats.get(id);
  if (!c || c.root !== root) return false;
  denyAll(c);
  if (c.tl.busy) c.stopping = true;
  const r = c.sid ? await (await getSnaClient()).agent.interrupt(c.sid).catch(() => null) : null;
  if (!r || r.status === "no_session") { if (c.tl.busy) { c.stopping = false; pushItem(c, { k: "stopped" }); setBusy(c, false); persist(c); } } // 에이전트가 없으면 멈춤 이벤트가 안 옴 — 직접 표시
  return true;
}
