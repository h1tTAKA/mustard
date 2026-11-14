// 채팅 모드 세션(#1341, 에픽 #1354) — 터미널 칸의 채팅 탭 하나 = SNA 세션 하나(cwd = 레포). 서버 전용 싱글톤.
// 흐름: 탭 만들기(기록만) → 첫 보내기 때 SNA 세션 만들고 에이전트 시작 → send. 이벤트는 chatTimeline이 화면 항목으로 접고
// 구독자(SSE)에게 바뀐 자리만 보냄. 권한: Claude = bypassPermissions + Mustard 훅(/api/chat/permission, Crew 훅 재사용),
// Codex = SNA 기본 승인 흐름(onPermissionRequest). 둘 다 Crew 정책(decide)으로 자동 허용, 나머지는 채팅에 허용/거절 카드.
// 저장: ~/.nunopi/chat/<sha(root)>/<id>.json(타임라인), 이미지는 ~/.nunopi/chat/img/<sha>.<ext>.
// 한계: 열린 채팅 탭마다 에이전트 프로세스가 살아 있음(SNA 동시 세션 상한을 Crew와 나눠 씀) — 모자라면 오래 쉰 탭부터 끄기.
// 실행 AI = SNA 런타임 5종(Claude Code·Codex·OpenCode·Grok·Cursor). 모델은 SNA listModels, 생각 강도는 reasoningLevel(0~5),
// 권한 모드 = plan(Claude만) / default(Crew 정책, 나머지 카드) / full(전부 허용). 탭 닫기 = 보관(기록 패널에서 다시 엶), 지우기는 따로.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSnaClient } from "@mustard/core/sna";
import { defaultSnaModel } from "@mustard/nunopi/server";
import { decide, fromAgentRequest } from "@/lib/crew/crewPolicy";
import { readPerms } from "@/lib/crew/crewPermStore";
import { HOOK_SRC } from "@/lib/crew/crewRunner";
import { applyEvent, itemsFromClaudeTranscript, type ChatItem, type Timeline } from "./chatTimeline";
import { projectDirFor } from "@/lib/subagents";
import { observeChat } from "./chatNarrate";

export type ChatProvider = "claude-code" | "codex" | "opencode" | "grok" | "cursor";
export const CHAT_PROVIDERS: ChatProvider[] = ["claude-code", "codex", "opencode", "grok", "cursor"];
export type ChatMode = "plan" | "default" | "full";
export const asProvider = (v: unknown): ChatProvider => (CHAT_PROVIDERS.includes(v as ChatProvider) ? (v as ChatProvider) : "claude-code");
const AGENT_ID: Record<ChatProvider, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", grok: "grok", cursor: "cursor" };
const asMode = (v: unknown): ChatMode => (v === "plan" || v === "full" ? v : "default");
export interface ChatMeta { id: string; title: string; provider: ChatProvider; model: string; effort?: number; mode: ChatMode; createdAt: number; updatedAt: number; busy: boolean; archived: boolean; count: number; cc?: string }
export type ChatPush =
  | { type: "snapshot"; items: ChatItem[]; streaming: string; busy: boolean; title: string; provider: ChatProvider }
  | { type: "item"; i: number; item: ChatItem }
  | { type: "delta"; streaming: string }
  | { type: "busy"; busy: boolean };

interface Chat {
  id: string; root: string; cwd: string; provider: ChatProvider; title: string; createdAt: number; updatedAt: number;
  model?: string; effort?: number; mode: ChatMode; archived?: boolean;
  sid?: string; cc?: string; token: string; tl: Timeline; // cc = Claude CLI 대화 id(init 이벤트) — 재시작 뒤 --resume
  stopping?: boolean; // 멈춤을 눌렀음 — 실측: 끊기면 interrupted 대신 error("Unknown error")가 옴 → 멈춤으로 표시
  pending?: { permId: string; resolve: (ok: boolean) => void };
}
type G = { chats: Map<string, Chat>; bySid: Map<string, string>; subs: Map<string, Set<(p: ChatPush) => void>>; loaded: Set<string>; flush: Map<string, ReturnType<typeof setTimeout>>; subscribed: Set<string>; wired: boolean };
const g = ((globalThis as unknown as { __mustardChat?: G }).__mustardChat ??= { chats: new Map(), bySid: new Map(), subs: new Map(), loaded: new Set(), flush: new Map(), subscribed: new Set(), wired: false });

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
    writeFileSync(`${f}.tmp`, JSON.stringify({ id: c.id, root: c.root, cwd: c.cwd, provider: c.provider, model: c.model, effort: c.effort, mode: c.mode, archived: c.archived, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, sid: c.sid, cc: c.cc, items: c.tl.items }));
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
      // 앱이 꺼졌다 켜지면 기다리던 권한 요청은 끝난 것 — 거절로 표시
      const items = (Array.isArray(j.items) ? j.items : []).map((it: ChatItem) => (it.k === "perm" && it.state === "pending" ? { ...it, state: "denied" } : it));
      g.chats.set(j.id, { id: j.id, root, cwd: j.cwd || root, provider: asProvider(j.provider), model: typeof j.model === "string" ? j.model : undefined, effort: typeof j.effort === "number" ? j.effort : undefined, mode: asMode(j.mode), archived: !!j.archived, title: String(j.title ?? ""), createdAt: Number(j.createdAt) || 0, updatedAt: Number(j.updatedAt) || Number(j.createdAt) || 0, sid: j.sid, cc: typeof j.cc === "string" ? j.cc : undefined, token: randomUUID(), tl: { items, streaming: "", busy: false } });
      if (j.sid) g.bySid.set(j.sid, j.id);
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
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
function setBusy(c: Chat, busy: boolean) { if (c.tl.busy !== busy) { c.tl.busy = busy; emit(c.id, { type: "busy", busy }); } }

// ── 목록·만들기·닫기 ────────────────────────────────────────────────
// Claude 최신 모델 — SNA 고정 목록은 옛 버전(Opus 4.7 등)이라 앞에 직접 둠(실측 11-14: CLI 2.1.325에서 이 id로 실행됨, opus 별칭 = claude-opus-5-5).
// 한계: 새 모델이 나오면 여기 갱신.
const CLAUDE_LATEST = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
export function defaultModel(p: ChatProvider): string {
  if (p === "claude-code") return CLAUDE_LATEST[0].id;
  return p === "grok" ? "grok-build" : p === "cursor" ? "auto" : defaultSnaModel(p); // 비우면 SNA가 Claude 모델을 넣어 다른 AI가 바로 실패(Crew와 같은 이유)
}
const metaOf = (c: Chat): ChatMeta => ({ id: c.id, title: c.title, provider: c.provider, model: c.model || defaultModel(c.provider), ...(c.effort !== undefined ? { effort: c.effort } : {}), mode: c.mode, createdAt: c.createdAt, updatedAt: c.updatedAt, busy: c.tl.busy, archived: !!c.archived, count: c.tl.items.filter((i) => i.k === "user").length, ...(c.cc ? { cc: c.cc } : {}) });
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
  const c: Chat = { id: randomUUID(), root, cwd: root, provider, model: opts.model, effort: opts.effort, mode: opts.mode ?? "default", title: "", createdAt: now, updatedAt: now, token: randomUUID(), tl: { items: [], streaming: "", busy: false } };
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
  c.pending?.resolve(false);
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
export async function deleteChat(root: string, id: string): Promise<boolean> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return false;
  c.pending?.resolve(false);
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
  c.pending?.resolve(false);
  await killAgent(c);
  persist(c, true);
  return { provider: c.provider, ...(c.cc ? { cc: c.cc } : {}) };
}

// ── 터미널(CLI)에서 했던 Claude 대화 가져오기 ─────────────────────────
const CC_RE = /^[a-f0-9-]{36}$/;
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
  let lines: string[];
  try { lines = readFileSync(join(projectDirFor(root), `${cc}.jsonl`), "utf8").split("\n"); } catch { return null; }
  const items = itemsFromClaudeTranscript(lines, saveImage);
  const first = items.find((i) => i.k === "user");
  const now = Date.now();
  const c: Chat = { id: randomUUID(), root, cwd: root, provider: "claude-code", mode: "default", cc, title: first && first.k === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 40) : "CLI", createdAt: now, updatedAt: now, token: randomUUID(), tl: { items, streaming: "", busy: false } };
  g.chats.set(c.id, c);
  persist(c, true);
  return metaOf(c); // 다음 보내기 때 --resume cc 로 이어 시작
}

// 모델 목록(SNA listModels) — 실행 AI마다 10분 캐시
const modelCache = new Map<string, { at: number; models: { id: string; label: string }[] }>();
export async function listModels(p: ChatProvider): Promise<{ id: string; label: string }[]> {
  const hit = modelCache.get(p);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const r = await (await getSnaClient()).agent.listModels(p, {}).catch(() => null);
  let models = (r?.models ?? []).filter((m) => !m.deprecated).map((m) => ({ id: m.id, label: m.label || m.id }));
  // Claude: 최신을 앞에, SNA 목록의 별칭(opus·sonnet·haiku — 이름이 옛 버전으로 붙어 헷갈림)은 빼고 나머지는 옛 모델로 뒤에
  if (p === "claude-code") models = [...CLAUDE_LATEST, ...models.filter((m) => !/^(opus|sonnet|haiku)$/.test(m.id) && !CLAUDE_LATEST.some((x) => x.id === m.id))];
  if (!models.some((m) => m.id === defaultModel(p))) models.unshift({ id: defaultModel(p), label: defaultModel(p) });
  modelCache.set(p, { at: Date.now(), models });
  return models;
}

// ── 에이전트 ────────────────────────────────────────────────────────
async function wire() {
  if (g.wired) return;
  g.wired = true;
  const sna = await getSnaClient();
  sna.agent.onEvent(({ session, event, isHistory }) => {
    if (isHistory) return;
    const c = g.chats.get(g.bySid.get(session) ?? "");
    if (!c) return;
    const wasBusy = c.tl.busy;
    let ev = event as Record<string, unknown>;
    if (ev.type === "init") { const cc = (ev.data as { sessionId?: unknown } | undefined)?.sessionId; if (typeof cc === "string" && cc !== c.cc) { c.cc = cc; persist(c); } }
    if (c.stopping && ev.type === "error") ev = { type: "interrupted" };
    if (ev.type === "complete" || ev.type === "interrupted" || ev.type === "error") c.stopping = false;
    const r = applyEvent(c.tl, ev, saveImage);
    observeChat(c.id, c.cwd, AGENT_ID[c.provider as ChatProvider], ev); // 캐치업 실시간 해설(터미널과 같은 narrate)
    for (const i of r.changed) emit(c.id, { type: "item", i, item: c.tl.items[i] });
    if (r.delta) emit(c.id, { type: "delta", streaming: c.tl.streaming });
    if (wasBusy !== c.tl.busy) emit(c.id, { type: "busy", busy: c.tl.busy });
    if (r.changed.length) persist(c);
  });
  // Codex(SNA 승인 흐름) — 정책으로 바로 답하거나 채팅 카드로 사람에게
  sna.agent.onPermissionRequest(({ session, request }) => {
    const c = g.chats.get(g.bySid.get(session) ?? "");
    if (!c || c.pending) return; // 이미 사람 답을 기다리는 중 — SNA 응답엔 요청 id가 없어 그 요청 답이 먼저(Crew와 같은 이유)
    const { tool, input } = fromAgentRequest((request ?? {}) as Record<string, unknown>);
    void ask(c, tool, input).then((ok) => sna.agent.respondPermission(session, ok)).catch(() => {});
  });
  await sna.agent.subscribePermissions().catch(() => {});
}

// 정책 → 허용이면 바로, 아니면 채팅에 카드(최대 10분, 넘으면 거절). 채팅은 사람이 직접 모는 자리라 Crew의 '사람만'(push 등)도 묻기로.
function ask(c: Chat, tool: string, input: Record<string, unknown>): Promise<boolean> {
  if (c.mode === "full") return Promise.resolve(true); // 전부 허용 모드
  if (decide(tool, input, c.cwd, readPerms()) === "allow") return Promise.resolve(true);
  if (c.pending) return Promise.resolve(false);
  const permId = randomUUID();
  const i = pushItem(c, { k: "perm", id: permId, tool, input: JSON.stringify(input).slice(0, 2000), state: "pending" });
  persist(c);
  return new Promise<boolean>((res) => {
    const timer = setTimeout(() => done(false), 10 * 60_000);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      if (c.pending?.permId === permId) c.pending = undefined;
      const it = c.tl.items[i];
      if (it?.k === "perm" && it.id === permId) { setItem(c, i, { ...it, state: ok ? "allowed" : "denied" }); persist(c); }
      res(ok);
    };
    c.pending = { permId, resolve: done };
  });
}
export function answerPermission(root: string, id: string, permId: string, allow: boolean): boolean {
  const c = g.chats.get(id);
  if (!c || c.root !== root || c.pending?.permId !== permId) return false;
  c.pending.resolve(allow);
  return true;
}
// Claude 훅 창구 — 탭마다 무작위 토큰으로만 통과
export async function hookDecision(id: string, token: string, tool: string, input: Record<string, unknown>): Promise<{ decision: "allow" | "deny"; reason?: string }> {
  const c = g.chats.get(id);
  if (!c || c.token !== token) return { decision: "deny", reason: "unknown chat" };
  if (c.pending) return { decision: "deny", reason: "another permission is pending" };
  return (await ask(c, tool, input)) ? { decision: "allow" } : { decision: "deny", reason: "The user denied this action" };
}

const safeOrigin = (o: string) => (/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o) ? o : `http://127.0.0.1:${Number(process.env.PORT) || 59720}`);

// 살아 있는 에이전트 확보 — 없으면(첫 보내기·앱 재시작 뒤) SNA 세션을 만들거나 저장된 대화로 이어 시작.
async function ensureAgent(c: Chat, origin: string) {
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
  if (isClaude) { mkdirSync(baseDir(), { recursive: true }); writeFileSync(hookPath(), HOOK_SRC.replace("/api/crew/permission", "/api/chat/permission").replace("Mustard Crew PreToolUse", "Mustard chat PreToolUse")); }
  if (c.sid) {
    const st = await sna.agent.getStatus(c.sid).catch(() => null);
    if (st?.alive) { if (!g.subscribed.has(c.sid)) { await sna.agent.subscribe(c.sid); g.subscribed.add(c.sid); } return; } // 서버만 다시 뜬 경우 — 살아 있는 세션 구독부터
    g.bySid.delete(c.sid); c.sid = undefined;
  }
  // 앱 재시작 뒤(에이전트 없음) — 새 SNA 세션. Claude는 CLI 대화 id로 이어 시작(--resume, 실측: SNA resume은 맥락이 안 이어짐).
  // 한계: Claude 말고는 이어 시작이 없어 맥락이 처음부터(화면 기록은 남음).
  const { sessionId } = await sna.sessions.create({ label: `chat:${c.title.slice(0, 40) || c.id.slice(0, 8)}`, cwd: c.cwd, meta: { mustardChat: true, root: c.root, chatId: c.id } });
  c.sid = sessionId; g.bySid.set(sessionId, c.id);
  persist(c, true);
  await sna.agent.subscribe(sessionId); g.subscribed.add(sessionId);
  await sna.agent.start(sessionId, { ...config, ...(isClaude && c.cc ? { extraArgs: ["--resume", c.cc] } : {}), meta: { mustardChat: true, chatId: c.id } });
}

// 보내기 — 일하는 중에 보내도 됨(실측: 같은 턴에 이어 붙음). 이미지는 저장해 화면에 보이고 에이전트에도 같이 감.
export async function sendChat(root: string, id: string, text: string, images: { base64: string; mime: string }[], origin: string): Promise<{ ok: boolean; error?: string }> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return { ok: false, error: "unknown chat" };
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
  c.pending?.resolve(false);
  if (c.tl.busy) c.stopping = true;
  const r = c.sid ? await (await getSnaClient()).agent.interrupt(c.sid).catch(() => null) : null;
  if (!r || r.status === "no_session") { if (c.tl.busy) { c.stopping = false; pushItem(c, { k: "stopped" }); setBusy(c, false); persist(c); } } // 에이전트가 없으면 멈춤 이벤트가 안 옴 — 직접 표시
  return true;
}
