// relocalize 점검 — node --experimental-strip-types packages/core/src/i18n/relocalize.check.ts
import assert from "node:assert";
import { relocalize, relocalizeCardSource, relocalizeFailure, translate, CARD_SOURCE_KEYS, CREW_TEXT_KEYS, FAILURE_TEXT_KEYS } from "./messages.ts";
const en = (k: string, v?: Record<string, string | number>) => translate("en", k, v);
const koWs = translate("ko", "card.workspaceSource", { repo: "taskboard" });
const koChat = translate("ko", "mem.chatSource", { front: "useState" });
console.log(koWs, "|", koChat);
assert.strictEqual(relocalize(koWs, CARD_SOURCE_KEYS, en), translate("en", "card.workspaceSource", { repo: "taskboard" }));
assert.strictEqual(relocalize(koChat, CARD_SOURCE_KEYS, en), translate("en", "mem.chatSource", { front: "useState" }));
assert.strictEqual(relocalize("React 공식 문서", CARD_SOURCE_KEYS, en), "React 공식 문서");
const askPath = `내 폴더 / ${translate("ko", "ask.sessionN", { n: 2 })} / ${translate("ko", "ask.thread", { n: 3 })}`;
assert.strictEqual(relocalizeCardSource(askPath, en), `내 폴더 / ${translate("en", "ask.sessionN", { n: 2 })} / ${translate("en", "ask.thread", { n: 3 })}`, "질문 경로 기본 이름 조각만");
const koFail = translate("ko", "provider.runtimeFailed", { msg: "exit 1\nstderr: boom" });
assert.strictEqual(relocalizeFailure(koFail, en), translate("en", "provider.runtimeFailed", { msg: "exit 1\nstderr: boom" }), "여러 줄 오류 원문도");
assert.strictEqual(relocalizeFailure(translate("ja", "fallback.emptyResponse"), en), translate("en", "fallback.emptyResponse"));
assert.strictEqual(relocalizeFailure("정상 답변입니다.", en), "정상 답변입니다.");
// 리뷰: 화면 라벨·사람 말은 Crew 틀에 먹히면 안 됨 + 저장 키는 모든 언어에서 자기 키로 돌아옴(틀 충돌 없음)
for (const txt of ["에이전트 부르기", "Say hi to your agents", "오늘"]) assert.strictEqual(relocalize(txt, CREW_TEXT_KEYS, en), txt, txt);
const vars = { n: 3, tool: "Bash", url: "https://x/1", err: "boom", role: "builder", title: "T", repo: "r", reason: "why", msg: "m", status: 500, target: "x", cmd: "c" };
const SAME: Record<string, string> = { "fallback.chatRequestFailed": "chat.replyFailed", "fallback.chatError": "chat.replyError" };
for (const keys of [CREW_TEXT_KEYS, FAILURE_TEXT_KEYS]) for (const k of keys) for (const l of ["ko", "ja", "en"]) {
  const back = relocalize(translate(l, k, vars), keys, en);
  const want = translate("en", k, vars); // 그 언어에서 chat.reply*와 문장이 같으면 그쪽으로 감(뜻 같음)
  if (back !== want && !(SAME[k] && translate(l, k) === translate(l, SAME[k]))) assert.fail(`${k}/${l}: ${back} != ${want}`);
}
console.log("relocalize ok", relocalize(koWs, CARD_SOURCE_KEYS, en));
