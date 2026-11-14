// wsChatStore 점검 — node --experimental-strip-types apps/mustard/src/lib/wsChatStore.check.ts
// 그래프 노드 질문이 질문 화면 저장소에 이어 쓰는지(세션 생성·기존 대화 보존·이벤트) 확인.
import assert from "node:assert/strict";
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const events: string[] = [];
(globalThis as Record<string, unknown>).window = { dispatchEvent: (e: { detail: { root: string } }) => { events.push(e.detail.root); return true; } };
(globalThis as Record<string, unknown>).CustomEvent = class { detail: unknown; constructor(_t: string, o: { detail: unknown }) { this.detail = o.detail; } };
const { writeSessionThread, readSessionThread, loadStore, chatStoreKey } = await import("./wsChatStore.ts");

const root = "/r";
// 질문 화면에 이미 있던 repo 세션 + 다른 파일 세션
mem.set(chatStoreKey(root), JSON.stringify({ sessions: { repo: { kind: "repo", label: "레포", subs: [{ id: "s0", messages: [{ role: "user", content: "old" }] }], activeSubId: "s0" } }, openKeys: ["repo"], activeKey: "repo" }));
assert.deepEqual(readSessionThread(root, "file:a.ts", "레포").messages, []);
const sub = writeSessionThread(root, "file:a.ts", "file", "a.ts", [{ role: "user", content: "q" }], "레포");
assert.equal(events.at(-1), root);
const sub2 = writeSessionThread(root, "file:a.ts", "file", "a.ts", [{ role: "user", content: "q" }, { role: "assistant", content: "a" }], "레포", sub);
assert.equal(sub2, sub);
const d = loadStore(chatStoreKey(root), "레포");
assert.equal(d.sessions["file:a.ts"].subs.length, 1);
assert.equal(d.sessions["file:a.ts"].subs[0].messages.length, 2);
assert.equal(d.sessions.repo.subs[0].messages[0].content, "old"); // 기존 대화 보존
assert.deepEqual(d.openKeys, ["repo"]); // 질문 화면 탭은 안 건드림
console.log("wsChatStore ok");
