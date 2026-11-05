// formatPickFeedback self-check — 실행: node --experimental-strip-types src/lib/browser/feedback.check.ts
import assert from "node:assert";
import { formatPickFeedback, sanitizePaste } from "./feedback.ts";

const p = {
  kind: "element" as const,
  items: [],
  url: "http://localhost:3000/settings?tab=a",
  viewport: { w: 1280, h: 800, dpr: 2 },
  tag: "button",
  selector: "header > button:nth-of-type(2)",
  text: "Save ```now```",
  attrs: { class: "btn primary", "aria-label": "Save" },
  rect: { x: 10, y: 20, w: 80, h: 32 },
  styles: { color: "rgb(0, 0, 0)", margin: "0px", display: "flex" },
  html: '<button class="btn">Save</button>',
  framework: "react" as const,
  components: ["SaveButton", "Header"],
  sources: [{ name: "Header", file: "src/components/Header.tsx", line: 42, col: 7 }, { name: "Page", file: "src/app/page.tsx", line: 3, col: 4 }],
};
const md = formatPickFeedback(p, "  간격 이상함, 고쳐줘 ", "/tmp/shot.png");
assert.ok(md.startsWith("## UI feedback: /settings?tab=a"));
assert.ok(md.includes("**Request:** 간격 이상함, 고쳐줘"));
assert.ok(md.includes("SaveButton < Header"));
assert.ok(md.includes("- Source: src/components/Header.tsx:42:7 (in Header)") && md.includes("- Used from: src/app/page.tsx:3:4 (in Page)"));
assert.ok(!formatPickFeedback({ ...p, sources: [] }, "x").includes("Source:"), "못 찾으면 줄 없음");
assert.ok(md.includes("- Screenshot: /tmp/shot.png"));
assert.ok(md.includes("color: rgb(0, 0, 0)") && !md.includes("margin: 0px"), "기본값 스타일 생략");
assert.ok(md.includes("````\nSave ```now```\n````"), "내용 백틱보다 긴 펜스");
assert.ok(md.includes("- React components (inner → outer): SaveButton < Header"));
assert.ok(!formatPickFeedback({ ...p, components: [] }, "x").includes("omponents (inner"));
assert.ok(formatPickFeedback({ ...p, framework: "vue", components: ["UserCard"] }, "x").includes("- Vue components (inner → outer): UserCard"));
assert.ok(formatPickFeedback({ ...p, framework: "", components: ["X"] }, "x").includes("- Components (inner → outer): X"));
// #1287 그린 화면 — 선택자·HTML 대신 무엇을 믿을지 안내
const fl = formatPickFeedback({ ...p, framework: "flutter", components: [], tag: "flt-semantics", attrs: { role: "button" }, text: "Increment" }, "x");
assert.ok(fl.includes("- Note: Flutter app") && fl.includes("Increment"));
assert.ok(formatPickFeedback({ ...p, framework: "canvas", components: [] }, "x").includes("- Note: Drawn on a <canvas>"));
assert.ok(formatPickFeedback({ ...p, framework: "flutter", components: [], tag: "flutter-view" }, "x").includes("no accessibility node at this spot"), "Flutter 빈 자리");
assert.ok(!md.includes("Note:"), "보통 화면엔 안내 없음");
assert.strictEqual(sanitizePaste("a\x1b[201~b\tc\nd\x07"), "a[201~b\tc\nd", "ESC·BEL 제거, 탭·줄바꿈 유지");
assert.ok(!md.includes("\x1b"));
// 영역(드래그)
const rg = formatPickFeedback({ ...p, kind: "region", tag: "region", items: [{ tag: "nav", selector: "header > nav", text: "Home About", components: ["Nav"] }] }, "여백 줄여줘", "/tmp/a.png");
assert.ok(rg.startsWith("## UI feedback (selected area): /settings?tab=a"));
assert.ok(rg.includes("- Screenshot of the area: /tmp/a.png") && rg.includes("nav  header > nav  [Nav]") && rg.includes('"Home About"'));
assert.ok(!rg.includes("Selector:") && !rg.includes("Note:"));
assert.ok(formatPickFeedback({ ...p, kind: "region", framework: "flutter", items: [] }, "x").includes("- Note: Flutter app"));
console.log("browser feedback ok");
