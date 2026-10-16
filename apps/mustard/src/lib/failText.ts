// #1093·#1095 실패 문구 판정 — 언어 무관(ko/ja/en 모두 + 옛 한국어 저장값). 서버·클라 공용(순수).
import { allLocaleValues } from "@mustard/core/messages";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "런타임 실패: {msg}" → 접두 "런타임 실패:" (언어별)
export const RUNTIME_FAIL_PREFIXES = allLocaleValues("provider.runtimeFailed").map((v) => v.split("{msg}")[0].trim());
const prefixRe = new RegExp(`^\\s*(${RUNTIME_FAIL_PREFIXES.map(esc).join("|")})`);
const soloRe = new RegExp(`^\\s*(${[...allLocaleValues("fallback.emptyResponse"), ...allLocaleValues("fallback.error")].map(esc).join("|")})\\s*$`);
// 괄호 문구는 그것만 있을 때(정상 설명 오판 방지)
export const isFailedNote = (t: string) => prefixRe.test(t) || soloRe.test(t);
