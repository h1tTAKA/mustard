// 봇 폴더 휴지통(#1399) — 서버가 비켜 둔 "봇 폴더/.deleted-<id>-<시각>"만 받음(화면이 아무 경로나 휴지통에 보내지 않게).
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const botsDir = () => process.env.MUSTARD_BOTS_DIR || path.join(os.homedir(), ".nunopi", "bots");

// 실제 경로(링크·.. 푼 것)가 봇 폴더 바로 아래 .deleted-* 일 때만 그 경로, 아니면 null
function trashTarget(p, base = botsDir()) {
  if (typeof p !== "string" || !p) return null;
  let real, root;
  try { real = fs.realpathSync(p); root = fs.realpathSync(base); } catch { return null; }
  return path.dirname(real) === root && /^\.deleted-[a-z0-9-]+-\d+$/.test(path.basename(real)) ? real : null;
}

module.exports = { trashTarget };
