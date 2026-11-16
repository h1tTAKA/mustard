// markScript self-check — 실행: node --experimental-strip-types src/lib/browser/markScript.check.ts
// 가짜 DOM으로 주입 스크립트를 실제로 돌려 봄(선택자로 찾기·못 찾으면 스크롤 따라가기·다시 넣으면 목록 교체·빈 목록이면 지움).
import assert from "node:assert";
import { markScript } from "./markScript.ts";

type El = { style: Record<string, string> & { cssText?: string }; children: El[]; textContent?: string; isConnected: boolean; remove(): void; appendChild(c: El): El; attachShadow(): El };
const mk = (): El => {
  const e: El = { style: {}, children: [], isConnected: true,
    remove() { e.isConnected = false; },
    appendChild(c) { e.children.push(c); return c; },
    attachShadow() { return mk(); } };
  return e;
};
const g = globalThis as Record<string, unknown>;
const body = mk();
const found: Record<string, { left: number; top: number; width: number; height: number }> = { "#a": { left: 100, top: 50, width: 40, height: 20 }, "#hidden": { left: 0, top: 0, width: 0, height: 0 } };
g.window = g; g.scrollX = 0; g.scrollY = 0; g.innerWidth = 800; g.innerHeight = 600;
g.document = { body, documentElement: body, createElement: () => mk(),
  querySelector: (s: string) => { if (s === "bad[") throw new Error("syntax"); return found[s] ? { getBoundingClientRect: () => found[s] } : null; } };
let frames = 0;
g.requestAnimationFrame = () => ++frames; g.cancelAnimationFrame = () => {};
const listeners = new Set<string>(); let timers = 0;
g.addEventListener = (t: string) => listeners.add(t); g.removeEventListener = (t: string) => listeners.delete(t);
g.setInterval = () => ++timers; g.clearInterval = () => { timers = 0; };

const run = (m: Parameters<typeof markScript>[0]) => new Function(markScript(m))();
const S = () => (g.__mustardMarks as { host: El | null; dots: Record<string, El> });

run([{ id: 1, n: 1, selector: "#a", rect: { x: 0, y: 0 } }, { id: 2, n: 2, selector: "", rect: { x: 300, y: 200 } }, { id: 3, n: 3, selector: "bad[", rect: { x: 5, y: 5 } }]);
assert.ok(S().host && body.children.length === 1, "레이어 하나");
assert.strictEqual(S().dots[1].style.left, "100px"); assert.strictEqual(S().dots[1].style.top, "50px");
assert.strictEqual(S().dots[2].style.left, "300px"); assert.strictEqual(S().dots[2].textContent, "2");
assert.strictEqual(S().dots[3].style.left, "10px", "잘못된 선택자도 죽지 않고 rect로, 가장자리는 원 반지름만큼 안쪽");
g.scrollY = 150; run([{ id: 2, n: 1, selector: "", rect: { x: 300, y: 200 } }]);
assert.strictEqual(S().dots[2].style.top, "50px", "못 찾는 항목은 처음 본 페이지 좌표에서 스크롤만큼 이동");
assert.strictEqual(S().dots[2].textContent, "1", "번호 갱신");
assert.ok(!S().dots[1] && !S().dots[3], "목록에서 빠진 원은 지움");
assert.strictEqual(body.children.length, 1, "다시 넣어도 레이어는 하나");
g.scrollY = 400; run([{ id: 4, n: 1, selector: "", rect: { x: 50, y: 200 }, scroll: { x: 0, y: 300 } }]);
assert.strictEqual(S().dots[4].style.top, "100px", "페이지 좌표 = 고른 화면 좌표 200 + 그때 스크롤 300, 지금 스크롤 400이면 100");
g.scrollY = 0; run([{ id: 5, n: 1, selector: "#hidden", rect: { x: 70, y: 80 }, scroll: { x: 0, y: 0 } }]);
assert.strictEqual(S().dots[5].style.left, "70px", "찾았어도 크기 0이면 고른 자리로");
assert.ok(listeners.has("scroll") && listeners.has("resize") && timers > 0, "스크롤·크기·주기로 다시 잼");
g.scrollY = 1000; run([{ id: 2, n: 1, selector: "", rect: { x: 300, y: 200 } }]);
assert.strictEqual(S().dots[2].style.display, "none", "화면 밖이면 숨김");
run([]);
assert.ok(!S().host && !body.children[0].isConnected, "빈 목록이면 레이어째 지움");
assert.ok(!listeners.size && !timers, "빈 목록이면 이벤트·주기도 끔");
new Function(markScript([{ id: 9, n: 1, selector: 'a[title="x\\"y</script>"]', rect: { x: 0, y: 0 } }])); // 선택자에 따옴표·태그가 있어도 문법 OK
console.log("browser markScript ok");
