// 채팅 모드 타임라인(#1341) — SNA 에이전트 이벤트를 화면용 항목으로 접는 순수 함수. 저장·전송은 chatSessions.ts.
// 실측(11-14): 답변은 assistant_delta(delta) 조각 → assistant(message 전체), 도구는 tool_use(input null, 스트리밍 시작)
// → tool_use(update:true, input 채움) → tool_result(data.toolUseId, isError, message = 결과 문자열·내용 JSON).
// 커서는 저장되는 이벤트만 있고 도구 입력은 SNA 기록에 안 남음 → 타임라인을 우리가 직접 들고 저장.

export type ChatItem =
  | { k: "user"; text: string; images?: string[] }
  | { k: "text"; text: string }
  | { k: "tool"; id: string; name: string; input?: string; result?: string; error?: boolean; images?: string[] }
  | { k: "perm"; id: string; tool: string; input: string; state: "pending" | "allowed" | "denied" }
  | { k: "done"; inTok?: number; outTok?: number; cost?: number; ms?: number; ctx?: number; win?: number } // ctx = 이번 턴 입력 전체(캐시 포함), win = 컨텍스트 창
  | { k: "error"; text: string }
  | { k: "stopped" };

export interface Timeline { items: ChatItem[]; streaming: string; busy: boolean; flushed?: number }
export type SaveImage = (base64: string, mime: string) => string; // 저장하고 이미지 id(파일명)를 돌려줌

const INPUT_MAX = 2000, RESULT_MAX = 4000;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// 도구 결과에서 이미지(스크린샷 등)를 떼어 냄 — 내용 블록 JSON(Anthropic 꼴 source.data / MCP 꼴 data+mimeType)이나
// 글 속 data:image URL 둘 다. 이미지 자리는 글에서 빼고 남은 글만 돌려줌.
export function extractImages(message: string): { text: string; images: { base64: string; mime: string }[] } {
  const images: { base64: string; mime: string }[] = [];
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") { if (typeof v === "string") texts.push(v); return; }
    const o = v as Record<string, unknown>;
    if (o.type === "image") {
      const src = (o.source ?? {}) as Record<string, unknown>;
      const b64 = str(src.data) || str(o.data), mime = str(src.media_type) || str(o.mimeType) || str(o.mime_type) || "image/png";
      if (b64) images.push({ base64: b64, mime });
      return;
    }
    if (o.type === "text" && typeof o.text === "string") { texts.push(o.text); return; }
    if (Array.isArray(o.content)) { walk(o.content); return; }
    texts.push(JSON.stringify(o));
  };
  let parsed: unknown = undefined;
  if (/^\s*[[{]/.test(message)) { try { parsed = JSON.parse(message); } catch { /* 글 그대로 */ } }
  if (parsed !== undefined) walk(parsed); else texts.push(message);
  const text = texts.join("\n").replace(/data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]{100,})/g, (_m, mime: string, b64: string) => { images.push({ base64: b64, mime }); return "[image]"; });
  return { text, images };
}

// 이벤트 하나 적용 → 바뀐 항목 번호(화면에 그 자리만 다시 보냄)·스트리밍 글 변화 여부.
export function applyEvent(t: Timeline, ev: Record<string, unknown>, save: SaveImage): { changed: number[]; delta?: boolean } {
  const type = str(ev.type), msg = str(ev.message);
  const data = (ev.data ?? {}) as Record<string, unknown>;
  const push = (it: ChatItem) => { t.items.push(it); return t.items.length - 1; };
  // 흘러오던 답변 글을 항목으로 굳힘(도구가 끼어들거나 턴이 끝날 때) — 뒤에 오는 assistant 전체 글이 이 자리를 덮어씀
  const flush = (): number[] => {
    if (!t.streaming.trim()) { t.streaming = ""; return []; }
    const i = push({ k: "text", text: t.streaming }); t.streaming = ""; t.flushed = i; return [i];
  };
  const toolAt = (id: string) => { for (let i = t.items.length - 1; i >= 0; i--) { const it = t.items[i]; if (it.k === "tool" && it.id === id) return i; } return -1; };
  switch (type) {
    case "assistant_delta": t.streaming += str(ev.delta); return { changed: [], delta: true };
    case "assistant": {
      if (!msg.trim()) return { changed: [] };
      if (t.flushed !== undefined && t.items[t.flushed]?.k === "text") { const i = t.flushed; t.items[i] = { k: "text", text: msg }; t.flushed = undefined; t.streaming = ""; return { changed: [i], delta: true }; }
      t.streaming = ""; t.flushed = undefined;
      return { changed: [push({ k: "text", text: msg })], delta: true };
    }
    case "tool_use": {
      const id = str(data.id), at = id ? toolAt(id) : -1;
      if (data.update && at >= 0) { const it = t.items[at] as Extract<ChatItem, { k: "tool" }>; t.items[at] = { ...it, input: cut(JSON.stringify(data.input ?? {}), INPUT_MAX) }; return { changed: [at] }; }
      if (at >= 0) return { changed: [] };
      const ch = flush();
      return { changed: [...ch, push({ k: "tool", id, name: str(data.toolName) || msg || "tool", ...(data.input ? { input: cut(JSON.stringify(data.input), INPUT_MAX) } : {}) })], delta: ch.length > 0 };
    }
    case "tool_result": {
      const at = toolAt(str(data.toolUseId));
      if (at < 0) return { changed: [] };
      const { text, images } = extractImages(msg);
      const it = t.items[at] as Extract<ChatItem, { k: "tool" }>;
      const ids = images.map((im) => save(im.base64, im.mime)).filter(Boolean);
      t.items[at] = { ...it, result: cut(text, RESULT_MAX), ...(data.isError ? { error: true } : {}), ...(ids.length ? { images: ids } : {}) };
      return { changed: [at] };
    }
    case "complete": {
      const ch = flush(); t.flushed = undefined; t.busy = false;
      const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : undefined);
      const ctx = (n("inputTokens") ?? 0) + (n("cacheReadTokens") ?? 0) + (n("cacheWriteTokens") ?? 0);
      return { changed: [...ch, push({ k: "done", inTok: n("inputTokens"), outTok: n("outputTokens"), cost: n("costUsd"), ms: n("durationMs"), ...(ctx ? { ctx } : {}), ...(n("contextWindow") ? { win: n("contextWindow") } : {}) })], delta: true };
    }
    case "interrupted": { const ch = flush(); t.flushed = undefined; t.busy = false; return { changed: [...ch, push({ k: "stopped" })], delta: true }; }
    case "error": {
      const ch = flush(); t.flushed = undefined; t.busy = false;
      const e = (data.error ?? {}) as Record<string, unknown>;
      return { changed: [...ch, push({ k: "error", text: cut(msg || str(e.message) || str(data.message) || "agent error", 1000) })], delta: true };
    }
    default: return { changed: [] }; // init·thinking·tool_use_delta·user_message(보낼 때 직접 넣음)·permission_needed(따로 받음)
  }
}

// Claude CLI 기록(jsonl 줄들) → 화면 항목 — 터미널에서 했던 대화를 채팅으로 가져올 때(#1341). 사이드체인·메타·시스템이 끼운 줄은 뺌.
const SYSTEM_USER = /^(<|\[Request interrupted|Another Claude session sent a message|This session is being continued|Caveat:)/;
export function itemsFromClaudeTranscript(lines: string[], save: SaveImage): ChatItem[] {
  const items: ChatItem[] = [];
  const toolAt = new Map<string, number>();
  for (const line of lines) {
    let o: Record<string, unknown>; try { o = JSON.parse(line); } catch { continue; }
    if ((o.type !== "user" && o.type !== "assistant") || o.isSidechain || o.isMeta) continue;
    const content = (o.message as { content?: unknown } | undefined)?.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        if (o.type === "user") { if (!SYSTEM_USER.test(b.text.trimStart())) items.push({ k: "user", text: b.text }); }
        else items.push({ k: "text", text: b.text });
      } else if (b.type === "tool_use") {
        toolAt.set(String(b.id), items.length);
        items.push({ k: "tool", id: String(b.id ?? ""), name: String(b.name ?? "tool"), input: cut(JSON.stringify(b.input ?? {}), INPUT_MAX) });
      } else if (b.type === "tool_result") {
        const at = toolAt.get(String(b.tool_use_id));
        const it = at === undefined ? undefined : items[at];
        if (!it || it.k !== "tool") continue;
        const { text, images } = extractImages(typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""));
        const ids = images.map((im) => save(im.base64, im.mime)).filter(Boolean);
        items[at!] = { ...it, result: cut(text, RESULT_MAX), ...(b.is_error ? { error: true } : {}), ...(ids.length ? { images: ids } : {}) };
      }
    }
  }
  return items;
}
