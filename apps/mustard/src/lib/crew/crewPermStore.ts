// Crew 권한 항목 설정(#1279) — 전역 ~/.nunopi/crew/permissions.json. 서버 전용(역할 저장소와 같은 자리·방식).
// 에이전트는 ~/.nunopi를 읽기·쓰기 모두 사람에게 물어야 해서(crewPolicy 비밀·밖 쓰기) 스스로 못 바꿈. 바꾸는 길 = 앱 화면 → /api/crew/permissions.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CREW_PERM_CATS, CREW_PERM_DEFAULTS, type CrewPermCat } from "./crewTypes.ts";

const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const file = () => join(baseDir(), "permissions.json");

// 저장된 것 + 기본값(새 항목이 생겨도 기본값을 받음). 모르는 키·불리언 아닌 값은 버림.
export function readPerms(): Record<CrewPermCat, boolean> {
  let j: Record<string, unknown> = {};
  try { if (existsSync(file())) j = JSON.parse(readFileSync(file(), "utf8")); } catch { /* 깨진 파일 = 기본값 */ }
  return Object.fromEntries(CREW_PERM_CATS.map((c) => [c, typeof j?.[c] === "boolean" ? j[c] : CREW_PERM_DEFAULTS[c]])) as Record<CrewPermCat, boolean>;
}

export function writePerms(patch: Record<string, unknown>): Record<CrewPermCat, boolean> {
  const next = readPerms();
  for (const c of CREW_PERM_CATS) if (typeof patch?.[c] === "boolean") next[c] = patch[c] as boolean;
  mkdirSync(baseDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`; // 동시 저장 두 개가 같은 임시 파일을 쓰지 않게(리뷰)
  writeFileSync(tmp, JSON.stringify(next, null, 1));
  renameSync(tmp, file());
  return next;
}
