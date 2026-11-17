// #1374 @sna-sdk/core(채팅 AI 서버)의 Claude 이벤트 변환에 두 가지를 끼워 넣음 — npm install 뒤(postinstall) 자동 실행.
// 1) 서브 에이전트 메시지(parent_tool_use_id 있음)는 메인 타임라인으로 안 보냄 — 안 그러면 서브의 도구·답이 메인 에이전트 것처럼 섞임.
// 2) 백그라운드 작업 끝 알림(system/task_notification)을 milestone 이벤트로 넘김 — SNA는 버림(이벤트 종류가 정해져 있어 milestone을 씀).
// ponytail: 고친 SNA를 배포하기 전까지의 임시 패치 — SNA가 직접 처리하면 이 파일과 postinstall을 지울 것.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MARK = "/* mustard-patch:sna-subagent v1 */";
const ANCHOR = "normalizeEvent(msg) {";
const INSERT = `${ANCHOR} ${MARK}
    if (msg?.parent_tool_use_id) return null;
    if (msg?.type === "system" && msg.subtype === "task_notification") return { type: "milestone", message: msg.summary_is_report ? "" : String(msg.summary ?? ""), data: { kind: "task_notification", status: msg.status, toolUseId: msg.tool_use_id, taskId: msg.task_id }, timestamp: Date.now() };`;

// 파일 내용을 고친 결과 — 이미 고쳤으면 그대로, 고칠 자리가 정확히 하나가 아니면 null
export function patch(src) {
  if (src.includes(MARK)) return src;
  if (src.split(ANCHOR).length !== 2) return null;
  return src.replace(ANCHOR, INSERT);
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(c?js)$/.test(f) ? [p] : []; });
}

export function run(dist) {
  let n = 0;
  for (const f of files(dist)) {
    const src = readFileSync(f, "utf8");
    if (!src.includes(ANCHOR)) continue;
    const out = patch(src);
    if (out === null) throw new Error(`[patch-sna] 고칠 자리가 하나가 아님: ${f} — SNA 버전이 바뀌었으면 이 패치를 확인`);
    if (out !== src) writeFileSync(f, out);
    n++;
  }
  if (!n) throw new Error(`[patch-sna] ${ANCHOR}를 못 찾음 — SNA 버전이 바뀌었으면 이 패치를 확인`);
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dist = [join(root, "apps", "mustard"), root].map((d) => join(d, "node_modules", "@sna-sdk", "core", "dist")).find(existsSync); // 워크스페이스 설치는 보통 루트로 올라감
  const strict = process.argv.includes("--strict"); // 패키징은 --strict(못 고치면 실패), postinstall은 경고만(SNA를 올렸을 때 npm install·CI 전체를 막지 않게, 리뷰)
  if (!dist) { console.log("[patch-sna] @sna-sdk/core 없음 — 건너뜀"); process.exit(strict ? 1 : 0); }
  try { console.log(`[patch-sna] ${run(dist)}개 파일 확인`); }
  catch (e) { console.warn(`${e.message}${strict ? "" : " (경고만 — 패키징 때는 실패)"}`); process.exit(strict ? 1 : 0); }
}
