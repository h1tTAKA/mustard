// 채팅 모드 캐치업 실시간 해설(#1341 → #1359) — SNA 이벤트가 곧 대화 기록이라 터미널과 같은 재료(유저 요청·에이전트 말·작업·결과)로 모아
// 같은 narrate()에 넘김. 에이전트가 말했거나 작업이 쌓이면 20초 간격으로, 턴이 끝나면 바로. 코드 diff는 바뀐 때만.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isNarrationOn } from "@/lib/narrationConfig";
import { narrate } from "@/lib/narrate";
import { materialOf, hasSubstance } from "@/lib/liveTranscript";
import type { SessionMsg } from "@/lib/agentSessionParse";

const execFileP = promisify(execFile);
const GAP_MS = 20_000;
type S = { msgs: SessionMsg[]; prompt?: string; last: number; busy: boolean; diffHash: number; timer?: ReturnType<typeof setTimeout> };
const g = ((globalThis as unknown as { __mustardChatNarr?: Map<string, S> }).__mustardChatNarr ??= new Map());

const djb2 = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
async function gitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", ["-C", cwd, "diff", "HEAD", "--unified=1", "--", ".", ":(exclude)*.md"], { encoding: "utf8", timeout: 3000, maxBuffer: 4_000_000 });
    return stdout.length > 6000 ? `${stdout.slice(0, 6000)}\n…(diff 생략)` : stdout;
  } catch { return ""; }
}
const brief = (input: unknown) => {
  const o = (input ?? {}) as Record<string, unknown>;
  const v = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.query;
  return typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 200) : "";
};
// SNA 이벤트 하나 → 대화 기록 메시지(없으면 null). 도구 시작은 입력이 채워진 update 때.
export function eventMsg(ev: Record<string, unknown>): SessionMsg | null {
  const data = (ev.data ?? {}) as Record<string, unknown>, ts = Date.now();
  if (ev.type === "user_message" && typeof ev.message === "string") return { role: "user", text: ev.message, ts };
  if (ev.type === "assistant" && typeof ev.message === "string" && ev.message.trim()) return { role: "assistant", text: ev.message, ts };
  if (ev.type === "tool_use" && data.update) return { role: "tool", text: `▸ ${String(data.toolName ?? "tool")}: ${brief(data.input)}`, ts };
  if (ev.type === "tool_result") return { role: "tool", text: String(ev.message ?? "").replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "[image]").replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, '"data":"[image]"').slice(0, 600), ts };
  return null;
}

export function observeChat(chatId: string, cwd: string, agent: string, ev: Record<string, unknown>) {
  const m = eventMsg(ev);
  const end = ev.type === "complete" || ev.type === "interrupted" || ev.type === "error";
  if (!m && !end) return;
  let s = g.get(chatId);
  if (!s) g.set(chatId, (s = { msgs: [], last: 0, busy: false, diffHash: 0 }));
  if (m) { if (m.role === "user") s.prompt = m.text; s.msgs.push(m); s.msgs = s.msgs.slice(-200); }
  const st = s;
  const fire = async () => {
    st.timer = undefined;
    if (st.busy || !hasSubstance(st.msgs)) return;
    if (!isNarrationOn()) { st.msgs = []; return; } // 설정 > 캐치업 > 해설 분석 꺼짐
    const msgs = st.msgs; st.msgs = []; st.last = Date.now(); st.busy = true;
    try {
      const full = await gitDiff(cwd);
      const h = full ? djb2(full) : 0;
      const diff = full && h !== st.diffHash ? full : ""; // 코드 그대로면 재전송 안 함
      await narrate(cwd, agent, "", diff, Date.now(), { material: materialOf(msgs, st.prompt), timeoutMs: 60_000 });
      if (full) st.diffHash = h; // 성공한 뒤에야 '보냄'으로(실패면 다음에 다시, 리뷰)
    } catch { /* 구독 미가용·시간 초과 — 그 묶음은 버림(observe와 같은 이유: 계속 실패할 때 같은 호출 반복 방지), diff는 해시를 안 바꿔 다음에 다시 */ }
    finally {
      st.busy = false;
      if (!st.timer && hasSubstance(st.msgs)) st.timer = setTimeout(() => void fire(), GAP_MS); // 해설하는 동안 쌓인 것(턴 끝 마지막 해설이 묶이지 않게, 리뷰)
    }
  };
  // 턴이 끝나면 바로, 아니면 간격을 지켜 한 번(묶어서)
  if (end) { if (s.timer) clearTimeout(s.timer); void fire(); }
  else if (!s.timer) s.timer = setTimeout(() => void fire(), Math.max(3000, GAP_MS - (Date.now() - s.last)));
}
