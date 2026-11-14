// 채팅 모드 세션(#1341, 에픽 #1354) — 터미널 칸의 채팅 탭 하나 = SNA 세션 하나(cwd = 레포). 서버 전용 싱글톤.
// 흐름: 탭 만들기(기록만) → 첫 보내기 때 SNA 세션 만들고 에이전트 시작 → send. 이벤트는 chatTimeline이 화면 항목으로 접고
// 구독자(SSE)에게 바뀐 자리만 보냄. 권한: Claude = bypassPermissions + Mustard 훅(/api/chat/permission, Crew 훅 재사용),
// Codex = SNA 기본 승인 흐름(onPermissionRequest). 둘 다 Crew 정책(decide)으로 자동 허용, 나머지는 채팅에 허용/거절 카드.
// 저장: ~/.nunopi/chat/<sha(root)>/<id>.json(타임라인), 이미지는 ~/.nunopi/chat/img/<sha>.<ext>.
// 한계: 열린 채팅 탭마다 에이전트 프로세스가 살아 있음(SNA 동시 세션 상한을 Crew와 나눠 씀) — 모자라면 오래 쉰 탭부터 끄기.
// 한계: 모델은 실행 AI 기본값(Claude = sonnet) — 고르기는 다음 단계.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSnaClient } from "@mustard/core/sna";
import { defaultSnaModel } from "@mustard/nunopi/server";
import { decide, fromAgentRequest } from "@/lib/crew/crewPolicy";
import { readPerms } from "@/lib/crew/crewPermStore";
import { HOOK_SRC } from "@/lib/crew/crewRunner";
import { applyEvent, type ChatItem, type Timeline } from "./chatTimeline";

export type ChatProvider = "claude-code" | "codex";
export interface ChatMeta { id: string; title: string; provider: ChatProvider; createdAt: number; busy: boolean }
export type ChatPush =
  | { type: "snapshot"; items: ChatItem[]; streaming: string; busy: boolean; title: string; provider: ChatProvider }
  | { type: "item"; i: number; item: ChatItem }
  | { type: "delta"; streaming: string }
  | { type: "busy"; busy: boolean };

interface Chat {
  id: string; root: string; cwd: string; provider: ChatProvider; title: string; createdAt: number;
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
    writeFileSync(`${f}.tmp`, JSON.stringify({ id: c.id, root: c.root, cwd: c.cwd, provider: c.provider, title: c.title, createdAt: c.createdAt, sid: c.sid, cc: c.cc, items: c.tl.items }));
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
      g.chats.set(j.id, { id: j.id, root, cwd: j.cwd || root, provider: j.provider === "codex" ? "codex" : "claude-code", title: String(j.title ?? ""), createdAt: Number(j.createdAt) || 0, sid: j.sid, cc: typeof j.cc === "string" ? j.cc : undefined, token: randomUUID(), tl: { items, streaming: "", busy: false } });
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
export function listChats(root: string): ChatMeta[] {
  load(root);
  return [...g.chats.values()].filter((c) => c.root === root).sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => ({ id: c.id, title: c.title, provider: c.provider, createdAt: c.createdAt, busy: c.tl.busy }));
}
export function createChat(root: string, provider: ChatProvider): ChatMeta {
  load(root);
  const c: Chat = { id: randomUUID(), root, cwd: root, provider, title: "", createdAt: Date.now(), token: randomUUID(), tl: { items: [], streaming: "", busy: false } };
  g.chats.set(c.id, c);
  persist(c, true);
  return { id: c.id, title: "", provider, createdAt: c.createdAt, busy: false };
}
export async function closeChat(root: string, id: string): Promise<boolean> {
  load(root);
  const c = g.chats.get(id);
  if (!c || c.root !== root) return false;
  c.pending?.resolve(false);
  g.chats.delete(id); g.subs.delete(id);
  if (c.sid) { g.bySid.delete(c.sid); void getSnaClient().then((s) => s.agent.kill(c.sid!)).catch(() => {}); }
  rmSync(join(rootDir(root), `${id}.json`), { force: true });
  return true;
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
    provider: c.provider, model: defaultSnaModel(c.provider), cwd: c.cwd,
    permissionMode: isClaude ? "bypassPermissions" : "acceptEdits",
    ...(isClaude ? { providerOptions: { settings: { hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: `node "${hookPath()}" --url=${safeOrigin(origin)} --run=${c.id} --token=${c.token}`, timeout: 900 }] }] } } } } : {}),
    // Codex: 작업 폴더마다 로그인 복사본을 만들면 리프레시 토큰이 서로 깨짐 → 사용자 CODEX_HOME 공유(Crew #1108과 같은 이유)
    ...(!isClaude ? { configDir: process.env.CODEX_HOME?.trim() || join(homedir(), ".codex") } : {}),
  };
  if (isClaude) { mkdirSync(baseDir(), { recursive: true }); writeFileSync(hookPath(), HOOK_SRC.replace("/api/crew/permission", "/api/chat/permission").replace("Mustard Crew PreToolUse", "Mustard chat PreToolUse")); }
  if (c.sid) {
    const st = await sna.agent.getStatus(c.sid).catch(() => null);
    if (st?.alive) { if (!g.subscribed.has(c.sid)) { await sna.agent.subscribe(c.sid); g.subscribed.add(c.sid); } return; } // 서버만 다시 뜬 경우 — 살아 있는 세션 구독부터
    g.bySid.delete(c.sid); c.sid = undefined;
  }
  // 앱 재시작 뒤(에이전트 없음) — 새 SNA 세션. Claude는 CLI 대화 id로 이어 시작(--resume, 실측: SNA resume은 맥락이 안 이어짐).
  // 한계: Codex는 이어 시작이 없어 맥락이 처음부터(화면 기록은 남음).
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
