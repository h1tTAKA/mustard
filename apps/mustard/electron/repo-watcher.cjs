// 레포 파일 워처(#739) — 워킹트리·.git 변경을 감지해 렌더러에 알림(그래프·변경사항 실시간 갱신).
// macOS/Windows는 fs.watch recursive(FSEvents 등)로 효율적. Linux 등 미지원이면 supported:false → 렌더러 폴백.
const { watch } = require("node:fs");

const DEBOUNCE_MS = 300;
// 무시할 경로 — git status/log에 안 잡히거나 폭주원(반응하면 낭비). 저장 한 번에 수십 이벤트 방지의 1차 필터.
// #1155 폴더 이름 단위로(전엔 글자 포함이라 src/distance.ts·src/builder.ts 저장도 무시됐음, 리뷰). .git은 objects·logs·lfs만(HEAD·refs·index는 반응).
const IGNORE_DIRS = new Set(["node_modules", ".next", "dist", "dist_electron", "build", ".turbo"]);
const IGNORE_GIT = new Set(["objects", "logs", "lfs"]);
function ignored(rel) {
  if (!rel) return false;
  const segs = rel.split(/[\\/]/);
  if (segs[segs.length - 1] === ".DS_Store") return true;
  return segs.some((s, i) => IGNORE_DIRS.has(s) || (s === ".git" && IGNORE_GIT.has(segs[i + 1])));
}

// id(=레포 경로) → { watcher, timer }. 활성 레포당 하나.
const watchers = new Map();

function startWatch(id, root, onChange) {
  stopWatch(id); // 같은 id 재요청 시 이전 것 정리
  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const rel = typeof filename === "string" ? filename : filename ? filename.toString() : "";
      if (ignored(rel)) return;
      const entry = watchers.get(id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      // 디바운스 — 이벤트 폭주를 한 번의 onChange로 묶음.
      entry.timer = setTimeout(() => { entry.timer = null; onChange(); }, DEBOUNCE_MS);
    });
  } catch (e) {
    // recursive 미지원(Linux 등) → 폴백 신호.
    return { ok: false, supported: false, error: String((e && e.message) || e) };
  }
  // #1225 감시가 에러로 죽으면 정리하고 한 번 갱신 신호 — 이후는 렌더러 안전망 폴링이 맡음(조용히 멈춰 있지 않게)
  watcher.on("error", () => { const e = watchers.get(id); if (e && e.watcher === watcher) { stopWatch(id); onChange({ dead: true }); } }); // 같은 id의 새 감시는 건드리지 않음(리뷰)
  watchers.set(id, { watcher, timer: null });
  return { ok: true, supported: true };
}

function stopWatch(id) {
  const entry = watchers.get(id);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch { /* ignore */ }
  watchers.delete(id);
}

function stopAll() {
  for (const id of [...watchers.keys()]) stopWatch(id);
}

module.exports = { startWatch, stopWatch, stopAll, ignored };
