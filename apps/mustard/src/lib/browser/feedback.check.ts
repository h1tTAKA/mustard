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
  react: ["SaveButton", "Header"],
};
const md = formatPickFeedback(p, "  간격 이상함, 고쳐줘 ", "/tmp/shot.png");
assert.ok(md.startsWith("## UI feedback: /settings?tab=a"));
assert.ok(md.includes("**Request:** 간격 이상함, 고쳐줘"));
assert.ok(md.includes("SaveButton < Header"));
assert.ok(md.includes("- Screenshot: /tmp/shot.png"));
assert.ok(md.includes("color: rgb(0, 0, 0)") && !md.includes("margin: 0px"), "기본값 스타일 생략");
assert.ok(md.includes("````\nSave ```now```\n````"), "내용 백틱보다 긴 펜스");
assert.ok(!formatPickFeedback({ ...p, react: [] }, "x").includes("React components"));
assert.strictEqual(sanitizePaste("a\x1b[201~b\tc\nd\x07"), "a[201~b\tc\nd", "ESC·BEL 제거, 탭·줄바꿈 유지");
assert.ok(!md.includes("\x1b"));
// 영역(드래그)
const rg = formatPickFeedback({ ...p, kind: "region", tag: "region", items: [{ tag: "nav", selector: "header > nav", text: "Home About", react: ["Nav"] }] }, "여백 줄여줘", "/tmp/a.png");
assert.ok(rg.startsWith("## UI feedback (selected area): /settings?tab=a"));
assert.ok(rg.includes("- Screenshot of the area: /tmp/a.png") && rg.includes("nav  header > nav  [Nav]") && rg.includes('"Home About"'));
assert.ok(!rg.includes("Selector:"));
console.log("browser feedback ok");
