// relocalize 점검 — node --experimental-strip-types packages/core/src/i18n/relocalize.check.ts
import assert from "node:assert";
import { relocalize, relocalizeCardSource, translate, CARD_SOURCE_KEYS } from "./messages.ts";
const en = (k: string, v?: Record<string, string | number>) => translate("en", k, v);
const koWs = translate("ko", "card.workspaceSource", { repo: "taskboard" });
const koChat = translate("ko", "mem.chatSource", { front: "useState" });
console.log(koWs, "|", koChat);
assert.strictEqual(relocalize(koWs, CARD_SOURCE_KEYS, en), translate("en", "card.workspaceSource", { repo: "taskboard" }));
assert.strictEqual(relocalize(koChat, CARD_SOURCE_KEYS, en), translate("en", "mem.chatSource", { front: "useState" }));
assert.strictEqual(relocalize("React 공식 문서", CARD_SOURCE_KEYS, en), "React 공식 문서");
const askPath = `내 폴더 / ${translate("ko", "ask.sessionN", { n: 2 })} / ${translate("ko", "ask.thread", { n: 3 })}`;
assert.strictEqual(relocalizeCardSource(askPath, en), `내 폴더 / ${translate("en", "ask.sessionN", { n: 2 })} / ${translate("en", "ask.thread", { n: 3 })}`, "질문 경로 기본 이름 조각만");
console.log("relocalize ok", relocalize(koWs, CARD_SOURCE_KEYS, en));
