// findSources self-check — 실행: node --experimental-strip-types src/lib/browser/sourceLookup.check.ts
import assert from "node:assert";
import { findSources } from "./sourceLookup.ts";

// VLQ 인코더(테스트용) — 세그먼트 [genCol, src, sLine, sCol]은 앞 세그먼트 대비 차이값.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const vlq = (n: number) => { let v = n < 0 ? (-n << 1) | 1 : n << 1, s = ""; do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B64[d]; } while (v); return s; };
const seg = (a: number[]) => a.map(vlq).join("");
// 생성 줄 0: 비어 있음 / 줄 1: 칸 0 → src0 줄 9 칸 0, 칸 20 → src0 줄 41 칸 6  (원본 1부터 = 10:1, 42:7)
const mappings = ";" + seg([0, 0, 9, 0]) + "," + seg([20, 0, 32, 6]);
const map = { version: 3, sources: ["webpack://_N_E/./src/components/Header.tsx"], mappings };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const files: Record<string, string> = {
  "http://localhost:3000/_next/static/chunks/app.js": `x\nyy\n//# sourceMappingURL=data:application/json;base64,${b64(map)}`,
  // Turbopack 식 index map(섹션 2개, 두 번째가 줄 5부터) + 외부 .map 파일
  "http://localhost:3000/_next/static/chunks/tp.js": "a\n//# sourceMappingURL=tp.js.map",
  "http://localhost:3000/_next/static/chunks/tp.js.map": JSON.stringify({ version: 3, sections: [
    { offset: { line: 0, column: 0 }, map: { version: 3, sources: ["turbopack:///[project]/src/a.tsx"], mappings: seg([0, 0, 0, 0]) } },
    { offset: { line: 5, column: 0 }, map: { version: 3, sources: ["turbopack:///[project]/src/app/page.tsx"], mappings: ";" + seg([4, 0, 2, 3]) } },
  ] }),
};
const fetchText = (u: string) => (u in files ? Promise.resolve(files[u]) : Promise.reject(new Error("404 " + u)));
const stack = (url: string, line: number, col: number) => ({ stack: `Error: react-stack-top-frame\n    at jsxDEV (http://localhost:3000/_next/static/chunks/node_modules_react_jsx-dev-runtime.js:1:2)\n    at Header (${url}:${line}:${col})` });

function Header() { return null; }
function Page() { return null; }

// React 19: host(button)._debugStack → Header.tsx:42:7, owner(Header)._debugStack → page.tsx:3:4(index map 섹션 2, 줄 5+1)
const pageFiber = { type: Page, _debugStack: null };
const headerFiber = { type: Header, _debugOwner: pageFiber, _debugStack: stack("http://localhost:3000/_next/static/chunks/tp.js", 7, 5) };
const btn = { __reactFiber$abc: { type: "button", _debugOwner: headerFiber, _debugStack: stack("http://localhost:3000/_next/static/chunks/app.js", 2, 21) } };
const r19 = await findSources(btn, fetchText);
assert.deepStrictEqual(r19[0], { name: "Header", file: "src/components/Header.tsx", line: 42, col: 7 });
assert.deepStrictEqual(r19[1], { name: "Page", file: "src/app/page.tsx", line: 3, col: 4 });
assert.strictEqual(r19.length, 2, "위치 없는 Page fiber는 빠짐");

// 칸 C 이하 마지막 세그먼트 — 칸 5(0부터 4)면 첫 세그먼트(10:1)
const early = await findSources({ __reactFiber$x: { type: "b", _debugOwner: headerFiber, _debugStack: stack("http://localhost:3000/_next/static/chunks/app.js", 2, 5) } }, fetchText, 0);
assert.deepStrictEqual(early, [{ name: "Header", file: "src/components/Header.tsx", line: 10, col: 1 }]);

// React 18: _debugSource 그대로, owner 없으면 return 체인의 컴포넌트 이름
const r18 = await findSources({ __reactFiber$y: { type: "div", _debugSource: { fileName: "/Users/me/app/src/Card.jsx", lineNumber: 12, columnNumber: 3 }, return: { type: "div", return: { type: Header } } } }, fetchText, 0);
assert.deepStrictEqual(r18, [{ name: "Header", file: "/Users/me/app/src/Card.jsx", line: 12, col: 3 }]);

// 실패: React 아님 / 맵 없음 / fetch 실패 → 빈 배열(예외 X)
assert.deepStrictEqual(await findSources({}, fetchText), []);
assert.deepStrictEqual(await findSources({ __reactFiber$z: { type: "a", _debugStack: stack("http://localhost:3000/missing.js", 1, 1) } }, fetchText), []);

// toString으로 페이지에 주입해도 돌아야 함 — 바깥 참조 없이 다시 만들어 같은 결과
const injected = new Function(`return (${findSources.toString()})`)() as typeof findSources;
assert.deepStrictEqual(await injected(btn, fetchText), r19);
console.log("browser sourceLookup ok");
