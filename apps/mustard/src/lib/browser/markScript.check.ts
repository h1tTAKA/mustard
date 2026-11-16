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
const found: Record<string, { left: number; top: number }> = { "#a": { left: 100, top: 50 } };
g.window = g; g.scrollX = 0; g.scrollY = 0; g.innerWidth = 800; g.innerHeight = 600;
g.document = { body, documentElement: body, createElement: () => mk(),
  querySelector: (s: string) => { if (s === "bad[") throw new Error("syntax"); return found[s] ? { getBoundingClientRect: () => found[s] } : null; } };
let frames = 0;
g.requestAnimationFrame = () => ++frames; g.cancelAnimationFrame = () => {};

const run = (m: Parameters<typeof markScript>[0]) => new Function(markScript(m))();
const S = () => (g.__mustardMarks as { host: El | null; dots: Record<string, El> });

run([{ id: 1, n: 1, selector: "#a", rect: { x: 0, y: 0 } }, { id: 2, n: 2, selector: "", rect: { x: 300, y: 200 } }, { id: 3, n: 3, selector: "bad[", rect: { x: 5, y: 5 } }]);
assert.ok(S().host && body.children.length === 1, "레이어 하나");
assert.strictEqual(S().dots[1].style.left, "100px"); assert.strictEqual(S().dots[1].style.top, "50px");
assert.strictEqual(S().dots[2].style.left, "300px"); assert.strictEqual(S().dots[2].textContent, "2");
assert.strictEqual(S().dots[3].style.left, "9px", "잘못된 선택자도 죽지 않고 rect로, 가장자리는 9px");
g.scrollY = 150; run([{ id: 2, n: 1, selector: "", rect: { x: 300, y: 200 } }]);
assert.strictEqual(S().dots[2].style.top, "50px", "못 찾는 항목은 처음 본 페이지 좌표에서 스크롤만큼 이동");
assert.strictEqual(S().dots[2].textContent, "1", "번호 갱신");
assert.ok(!S().dots[1] && !S().dots[3], "목록에서 빠진 원은 지움");
assert.strictEqual(body.children.length, 1, "다시 넣어도 레이어는 하나");
g.scrollY = 1000; run([{ id: 2, n: 1, selector: "", rect: { x: 300, y: 200 } }]);
assert.strictEqual(S().dots[2].style.display, "none", "화면 밖이면 숨김");
run([]);
assert.ok(!S().host && !body.children[0].isConnected, "빈 목록이면 레이어째 지움");
new Function(markScript([{ id: 9, n: 1, selector: 'a[title="x\\"y</script>"]', rect: { x: 0, y: 0 } }])); // 선택자에 따옴표·태그가 있어도 문법 OK
console.log("browser markScript ok");
