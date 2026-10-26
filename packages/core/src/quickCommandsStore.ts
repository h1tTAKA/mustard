// 빠른 명령 저장소(#1194) — 순수 규칙(quickCommands.ts, 점검 대상)과 분리: 여기는 설정 저장소·React 훅.
import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./settings";
import { normalizeQuickCommands, QKEYS, type QuickCommand } from "./quickCommands";

// 저장 = JSON 글로(설정 훅은 원시값이어야 함 — 배열을 그대로 두면 매번 새 값이라 화면이 끝없이 다시 그려짐)
const parse = (raw: string) => { try { return normalizeQuickCommands(JSON.parse(raw)); } catch { return []; } };
export function getQuickCommands(): QuickCommand[] { return parse(getSetting<string>(QKEYS.commands, "[]")); }
export function saveQuickCommands(list: QuickCommand[]): void { setSetting(QKEYS.commands, JSON.stringify(normalizeQuickCommands(list))); }
export function useQuickCommands(): QuickCommand[] {
  const raw = useSetting<string>(QKEYS.commands, "[]");
  return useMemo(() => parse(raw), [raw]);
}
