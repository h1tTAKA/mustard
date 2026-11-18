// #1372 받을 곳 조립 점검 — 터미널은 탭 순서·에이전트인 탭만·이름 우선순위, 채팅은 터미널로 넘긴 것 뺌
import assert from "node:assert/strict";
import { buildTargets } from "./sendTarget.ts";

const tabs = [{ id: "t1" }, { id: "t2", customTitle: "리뷰" }, { id: "t3" }];
const live = [{ id: "t3", agent: "codex", title: "" }, { id: "t2", agent: "claude", title: "세션 제목" }, { id: "x", agent: "claude", title: "다른 레포" }];
const chats = [{ id: "c1", title: "버그 고치기", provider: "claude-code" }, { id: "c2", title: "", provider: "codex", handedOff: true }, { id: "c3", title: "", provider: "codex" }];
assert.deepEqual(buildTargets(tabs, live, chats), [
  { kind: "term", id: "t2", name: "리뷰", agent: "claude" },   // 탭 순서, 직접 붙인 이름이 세션 제목보다 먼저
  { kind: "term", id: "t3", name: "", agent: "codex" },        // 이름 없으면 "" (화면이 에이전트 이름으로)
  { kind: "chat", id: "c1", name: "버그 고치기", provider: "claude-code" },
  { kind: "chat", id: "c3", name: "", provider: "codex" },     // 터미널로 넘긴 c2는 빠짐
]);
assert.deepEqual(buildTargets(tabs, [], []), [], "받을 곳 없음");
assert.equal(buildTargets([{ id: "t2" }], live, []).length, 1, "에이전트가 하나면 하나");
console.log("sendTarget ok");
