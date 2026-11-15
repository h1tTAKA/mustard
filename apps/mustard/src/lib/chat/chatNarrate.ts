// 채팅 모드 캐치업 실시간 해설(#1341) — 터미널은 main이 화면 델타를 /api/repo/learn/observe로 보내 narrate()가 카드를 만듦.
// 채팅엔 터미널 화면이 없으니 SNA 이벤트를 터미널 기록처럼 글로 모아(⏺ 도구(대상) / ⎿ 결과 / 답변) 같은 narrate()에 넘김.
// 간격·최소 길이·코드 diff(같은 diff 재전송 안 함)는 main의 observeActivity와 같은 값. 기록 파일(백필)은 CLI가 남기는 jsonl을 그대로 읽음.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isNarrationOn } from "@/lib/narrationConfig";
import { narrate } from "@/lib/narrate";

const execFileP = promisify(execFile);
const NARR_INTERVAL = 8000, NARR_MIN_DELTA = 150;
type S = { buf: string; last: number; busy: boolean; diffHash: number; timer?: ReturnType<typeof setTimeout> };
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

// 이벤트 하나를 기록 글로 — 터미널 화면에 찍히는 꼴과 비슷하게(narrate 프롬프트가 그 꼴을 읽음)
export function eventLine(ev: Record<string, unknown>): string {
  const data = (ev.data ?? {}) as Record<string, unknown>;
  if (ev.type === "tool_use" && data.update) return `⏺ ${String(data.toolName ?? "tool")}(${brief(data.input)})\n`;
  if (ev.type === "tool_result") return `  ⎿ ${String(ev.message ?? "").replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "[image]").replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, '"data":"[image]"').slice(0, 300)}\n`;
  if (ev.type === "assistant" && typeof ev.message === "string") return `⏺ ${ev.message.slice(0, 2000)}\n`;
  return "";
}

export function observeChat(chatId: string, cwd: string, agent: string, ev: Record<string, unknown>) {
  const line = eventLine(ev);
  const end = ev.type === "complete" || ev.type === "interrupted" || ev.type === "error";
  if (!line && !end) return;
  let s = g.get(chatId);
  if (!s) g.set(chatId, (s = { buf: "", last: 0, busy: false, diffHash: 0 }));
  s.buf = (s.buf + line).slice(-6000);
  const st = s;
  const fire = async () => {
    st.timer = undefined;
    if (st.busy || st.buf.length < NARR_MIN_DELTA) return;
    if (!isNarrationOn()) { st.buf = ""; return; } // 설정 > 캐치업 > 해설 분석 꺼짐
    const delta = st.buf; st.buf = ""; st.last = Date.now(); st.busy = true;
    try {
      const full = await gitDiff(cwd);
      const h = full ? djb2(full) : 0;
      const diff = full && h !== st.diffHash ? full : ""; // 코드 그대로면 재전송 안 함
      if (full) st.diffHash = h;
      await narrate(cwd, agent, delta.slice(-5000), diff, Date.now(), { signal: AbortSignal.timeout(30_000) });
    } catch { /* 구독 미가용·시간 초과 — 다음 묶음에서 */ }
    finally { st.busy = false; }
  };
  // 턴이 끝나면 바로, 아니면 간격을 지켜 한 번(묶어서)
  const wait = end ? 0 : Math.max(0, NARR_INTERVAL - (Date.now() - s.last));
  if (end) { if (s.timer) clearTimeout(s.timer); void fire(); }
  else if (!s.timer) s.timer = setTimeout(() => void fire(), wait);
}
