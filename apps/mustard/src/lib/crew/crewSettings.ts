// Crew 보드 설정(#1157, 에픽 #1097) — 레포 보드별. 지금은 auto('전부 알아서') 하나. 서버 전용.
// 저장 = ~/.nunopi/crew/<sha(root)>/settings.json(보드·계기와 같은 폴더). 쓰기는 tmp+rename. 못 읽으면 기본값(auto 꺼짐 = 안전 쪽).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface CrewSettings { auto: boolean }
const DEFAULTS: CrewSettings = { auto: false };

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const file = (root: string) => join(baseDir(), sha(normPath(root)), "settings.json");

export function readSettings(root: string): CrewSettings {
  try {
    const j = JSON.parse(readFileSync(file(root), "utf8"));
    return { auto: j?.auto === true }; // true일 때만 켜짐(오타·이상한 값 = 꺼짐)
  } catch { return { ...DEFAULTS }; }
}

// 아는 키만, 타입 맞는 것만 반영
export function writeSettings(root: string, patch: Partial<Record<keyof CrewSettings, unknown>>): CrewSettings {
  const next = readSettings(root);
  if (typeof patch.auto === "boolean") next.auto = patch.auto;
  const f = file(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${f}.tmp`, f);
  return next;
}
