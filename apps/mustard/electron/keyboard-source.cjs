// #1213 macOS 지금 입력 소스 ID(Option을 Alt로 "자동" 판단용) — HIToolbox 설정에서 읽음. 못 읽으면 null(= Option 그대로).
const { execFile } = require("node:child_process");

function run(cmd, args, input) {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout: 500, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : String(out)));
    if (input != null) p.stdin.end(input);
  });
}

// 고른 입력 소스 목록에서 키보드용 마지막 항목 — 입력기(한국어·일본어 등)는 Input Mode/Bundle ID, 배열(ABC·US)만이면 현재 배열 ID.
function pickSourceId(list) {
  if (!Array.isArray(list)) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i] || {};
    if (s.InputSourceKind === "Input Mode" || s.InputSourceKind === "Keyboard Input Method") return s["Input Mode"] || s["Bundle ID"] || null;
    if (s.InputSourceKind === "Keyboard Layout") return undefined; // 배열 → 현재 배열 ID로
  }
  return undefined;
}

async function inputSourceId() {
  if (process.platform !== "darwin") return null;
  const xml = await run("/usr/bin/defaults", ["export", "com.apple.HIToolbox", "-"]);
  if (!xml) return null;
  let list; try { list = JSON.parse(await run("/usr/bin/plutil", ["-extract", "AppleSelectedInputSources", "json", "-o", "-", "-"], xml)); } catch { list = null; }
  const id = pickSourceId(list);
  if (id !== undefined) return id;
  const cur = await run("/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleCurrentKeyboardLayoutInputSourceID"]);
  return cur ? cur.trim() || null : null;
}

module.exports = { inputSourceId, pickSourceId };
