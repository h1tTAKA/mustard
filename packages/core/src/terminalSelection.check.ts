// trimSelectionGutter 점검 — node --experimental-strip-types packages/core/src/terminalSelection.check.ts
import assert from "node:assert";
import { trimSelectionGutter as t } from "./terminalSelection.ts";

assert.strictEqual(t("  a\n    b\n  c"), "a\n  b\nc", "공통 2칸만, 상대 들여쓰기 유지");
assert.strictEqual(t("  a\n\n  b"), "a\n\nb", "빈 줄은 판단에서 뺌");
assert.strictEqual(t("  a\n   \n  b"), "a\n \nb", "공백만 있는 줄도 같은 만큼만 자름");
assert.strictEqual(t("x\n  a\nb"), "x\n  a\nb", "첫 줄이 아닌 0칸 줄이 있으면 그대로");
assert.strictEqual(t("mid line\n    b\n      c"), "mid line\nb\n  c", "줄 중간에서 시작한 선택 — 첫 줄은 판단에서 빼고 나머지 공통 여백만");
assert.strictEqual(t("    foo"), "    foo", "한 줄 선택은 그대로");
assert.strictEqual(t("  a\r\n\r\n  b\r"), "a\r\n\r\nb\r", "CRLF — 빈 CRLF 줄이 여백을 0으로 만들지 않음");
assert.strictEqual(t("   "), "   ", "공백뿐이면 그대로");
assert.strictEqual(t("\tx\n\ty"), "\tx\n\ty", "탭은 건드리지 않음");
assert.strictEqual(t("    한글\n    줄"), "한글\n줄");
assert.strictEqual(t("  a\n    b"), "a\n  b", "첫 줄도 들여쓰기가 있으면 판단에 넣음");
console.log("terminalSelection ok");
