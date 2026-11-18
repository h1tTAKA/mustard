// #1374 @sna-sdk/core(채팅 AI 서버)의 Claude 이벤트 변환에 두 가지를 끼워 넣음 — npm install 뒤(postinstall) 자동 실행.
// 1) 서브 에이전트 메시지(parent_tool_use_id 있음)는 메인 타임라인으로 안 보냄 — 안 그러면 서브의 도구·답이 메인 에이전트 것처럼 섞임.
// 2) 백그라운드 작업 끝 알림(system/task_notification)을 milestone 이벤트로 넘김 — SNA는 버림(이벤트 종류가 정해져 있어 milestone을 씀).
// 3) CLI별 "아직 도는 백그라운드 작업 수"(system/background_tasks_changed가 매번 전체 목록을 줌)를 globalThis.__mustardSnaBg()로 셈
//    — 데몬 껍데기(sna-daemon-host.cjs, 같은 프로세스)가 메인 턴이 끝난 뒤 도는 서브 에이전트를 일하는 중으로 보게. 죽은 CLI는 뺌.
//    ponytail: 목록이 6시간 안 바뀌면 안 셈 — 끝나지 않는 백그라운드 명령(개발 서버 등)이 데몬 교체·종료를 영영 막지 않게(리뷰).
//    대가: 6시간 넘게 도는 진짜 작업도 그 뒤 데몬 교체·스스로 종료 때 같이 꺼짐. 그런 작업이 실제로 있으면 늘릴 것
// ponytail: 고친 SNA를 배포하기 전까지의 임시 패치 — SNA가 직접 처리하면 이 파일과 postinstall을 지울 것.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MARK = "/* mustard-patch:sna-subagent v2 */";
const OLD = "/* mustard-patch:sna-subagent"; // 옛 버전 표시 — 그 위에 또 끼우면 두 번 들어감
const ANCHOR = "normalizeEvent(msg) {";
const INSERT = `${ANCHOR} ${MARK}
    if (msg?.parent_tool_use_id) return null;
    if (msg?.type === "system" && msg.subtype === "background_tasks_changed") { const g = globalThis, ps = (g.__mustardSnaProcs ??= new Set()); this.__mustardBg = Array.isArray(msg.tasks) ? msg.tasks.length : 0; this.__mustardBgAt = Date.now(); ps.add(this); g.__mustardSnaBg ??= () => { let n = 0; for (const p of ps) { if (!p.alive || !p.__mustardBg || Date.now() - p.__mustardBgAt > 6 * 3600e3) ps.delete(p); else n += p.__mustardBg; } return n; }; return null; }
    if (msg?.type === "system" && msg.subtype === "task_notification") return { type: "milestone", message: msg.summary_is_report ? "" : String(msg.summary ?? ""), data: { kind: "task_notification", status: msg.status, toolUseId: msg.tool_use_id, taskId: msg.task_id }, timestamp: Date.now() };`;

// 파일 내용을 고친 결과 — 이미 고쳤으면 그대로, 고칠 자리가 정확히 하나가 아니거나 옛 버전 패치가 들어 있으면 null
export function patch(src) {
  if (src.includes(MARK)) return src;
  if (src.includes(OLD)) return null; // 옛 패치가 든 파일 — @sna-sdk/core를 다시 설치해야 함
  if (src.split(ANCHOR).length !== 2) return null;
  return src.replace(ANCHOR, INSERT);
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(c?js)$/.test(f) ? [p] : []; });
}

// 전부 고쳐 본 뒤 하나라도 못 고치면 아무것도 안 씀 — 일부만 고친 섞인 SNA가 남지 않게(리뷰)
export function run(dist) {
  const outs = [];
  for (const f of files(dist)) {
    const src = readFileSync(f, "utf8");
    if (!src.includes(ANCHOR)) continue;
    const out = patch(src);
    if (out === null) throw new Error(`[patch-sna] 고칠 자리가 하나가 아니거나 옛 패치가 들어 있음: ${f} — SNA 버전이 바뀌었으면 이 패치를 확인, 옛 패치면 @sna-sdk/core 다시 설치`);
    outs.push([f, src, out]);
  }
  if (!outs.length) throw new Error(`[patch-sna] ${ANCHOR}를 못 찾음 — SNA 버전이 바뀌었으면 이 패치를 확인`);
  const done = [];
  try { for (const [f, src, out] of outs) if (out !== src) { done.push([f, src]); writeFileSync(f, out); } }
  catch (e) { for (const [f, src] of done) try { writeFileSync(f, src); } catch { /* 되돌리기도 실패 — 다시 설치 */ } throw e; } // 쓰다 실패하면(권한·디스크) 쓴 것도 되돌림(리뷰)
  return outs.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dist = [join(root, "apps", "mustard"), root].map((d) => join(d, "node_modules", "@sna-sdk", "core", "dist")).find(existsSync); // 워크스페이스 설치는 보통 루트로 올라감
  const strict = process.argv.includes("--strict"); // 패키징은 --strict(못 고치면 실패), postinstall은 경고만(SNA를 올렸을 때 npm install·CI 전체를 막지 않게, 리뷰)
  if (!dist) { console.log("[patch-sna] @sna-sdk/core 없음 — 건너뜀"); process.exit(strict ? 1 : 0); }
  try { console.log(`[patch-sna] ${run(dist)}개 파일 확인`); }
  catch (e) { console.warn(`${e.message}${strict ? "" : " (경고만 — 패키징 때는 실패)"}`); process.exit(strict ? 1 : 0); }
}
