// wsChatStore 점검 — node --experimental-strip-types apps/mustard/src/lib/wsChatStore.check.ts
// 그래프 노드 질문이 질문 화면 저장소에 이어 쓰는지(세션 생성·기존 대화 보존·이벤트) 확인.
import assert from "node:assert/strict";
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const events: string[] = [];
(globalThis as Record<string, unknown>).window = { dispatchEvent: (e: { detail: { root: string } }) => { events.push(e.detail.root); return true; } };
(globalThis as Record<string, unknown>).CustomEvent = class { detail: unknown; constructor(_t: string, o: { detail: unknown }) { this.detail = o.detail; } };
const { appendSessionMessages, readSessionThread, loadStore, chatStoreKey, MAX_SESSIONS } = await import("./wsChatStore.ts");

const root = "/r";
// 질문 화면에 이미 있던 repo 세션 + 다른 파일 세션
mem.set(chatStoreKey(root), JSON.stringify({ sessions: { repo: { kind: "repo", label: "레포", subs: [{ id: "s0", messages: [{ role: "user", content: "old" }] }], activeSubId: "s0" } }, openKeys: ["repo"], activeKey: "repo" }));
assert.deepEqual(readSessionThread(root, "file:a.ts", "레포").messages, []);
const sub = appendSessionMessages(root, "file:a.ts", "file", "a.ts", [{ role: "user", content: "q" }], "레포");
assert.equal(events.at(-1), root);
// 기다리는 사이 질문 화면이 같은 세션에 씀 → 덧붙이기라 안 지워짐(리뷰)
const mid = JSON.parse(mem.get(chatStoreKey(root))!); mid.sessions["file:a.ts"].subs[0].messages.push({ role: "user", content: "other" }); mem.set(chatStoreKey(root), JSON.stringify(mid));
const sub2 = appendSessionMessages(root, "file:a.ts", "file", "a.ts", [{ role: "assistant", content: "a" }], "레포", sub);
assert.equal(sub2, sub);
const d = loadStore(chatStoreKey(root), "레포");
assert.equal(d.sessions["file:a.ts"].subs.length, 1);
assert.deepEqual(d.sessions["file:a.ts"].subs[0].messages.map((m) => m.content), ["q", "other", "a"]);
assert.equal(d.sessions.repo.subs[0].messages[0].content, "old"); // 기존 대화 보존
assert.deepEqual(d.openKeys, ["repo"]); // 질문 화면 탭은 안 건드림
// 새 세션이 상한을 넘으면 오래된 닫힌 세션 정리(리뷰)
for (let i = 0; i < MAX_SESSIONS + 5; i++) appendSessionMessages(root, `file:f${i}.ts`, "file", `f${i}.ts`, [{ role: "user", content: "x" }], "레포");
const after = loadStore(chatStoreKey(root), "레포").sessions;
assert.ok(Object.keys(after).length <= MAX_SESSIONS);
assert.ok(after.repo && after[`file:f${MAX_SESSIONS + 4}.ts`]); // repo·방금 쓴 것은 남음
console.log("wsChatStore ok");
