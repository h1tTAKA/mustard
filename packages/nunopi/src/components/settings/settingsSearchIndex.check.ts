// 설정 검색 색인 점검(#1195) — 실행: node --experimental-strip-types packages/nunopi/src/components/settings/settingsSearchIndex.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_SEARCH, searchSettings, keyWords } from "./settingsSearchIndex.ts";

// 색인의 모든 키가 문구 파일(ko·ja·en 세 곳)에 있어야 함 — 키 오타·지운 키를 잡음
const msgs = readFileSync(fileURLToPath(new URL("../../../../core/src/i18n/messages.ts", import.meta.url)), "utf8");
for (const items of Object.values(SETTINGS_SEARCH)) for (const it of items) {
  const keys = typeof it === "string" ? [it] : Array.isArray(it) ? it : [];
  for (const k of keys) assert.strictEqual(msgs.split(`"${k}":`).length - 1, 3, `문구 키 없음/중복: ${k}`);
}

// 찾기 — 가짜 번역(키 그대로가 아니라 사람 말처럼)
const ko: Record<string, string> = { "settings.terminalScrollback": "스크롤백 줄 수", "settings.terminalScrollbackHint": "위로 올려 볼 수 있는 줄", "settings.terminalFontSize": "글꼴 크기", "settings.uiFont": "화면 글꼴" };
const t = (k: string) => ko[k] ?? k;
const sec = (id: string) => ({ "set-terminal": "터미널", "set-appearance": "화면" } as Record<string, string>)[id] ?? id;
const all = () => true;
assert.deepStrictEqual(searchSettings("스크롤백", t, sec, all).map((h) => h.label), ["스크롤백 줄 수"]);
assert.strictEqual(searchSettings("글꼴", t, sec, all)[0].label, "글꼴 크기", "이름이 낱말로 시작하는 게 먼저");
assert.ok(searchSettings("font size", t, sec, all).some((h) => h.label === "글꼴 크기"), "한국어 화면에서 영어 키 단어로도");
assert.ok(searchSettings("터미널 글꼴", t, sec, all).some((h) => h.label === "글꼴 크기"), "섹션 이름 + 항목 낱말");
assert.deepStrictEqual(searchSettings("   ", t, sec, all), []);
assert.ok(searchSettings("jira", t, sec, all).some((h) => h.label === "Jira"), "브랜드 이름");
assert.deepStrictEqual(searchSettings("스크롤백", t, sec, (id) => id !== "set-terminal"), [], "안 보이는 섹션은 결과에서 뺌");
assert.strictEqual(keyWords("settings.terminalFontSize"), "terminal font size");

console.log("settingsSearchIndex ok");
