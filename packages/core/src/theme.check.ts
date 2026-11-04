// 화면 테마 점검(#1283) — node --experimental-strip-types packages/core/src/theme.check.ts
// 테마 하나 추가할 때 빠뜨리기 쉬운 곳(CSS 블록·견본·이름·깜빡임 방지 목록)과 글자 대비를 본다.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { THEMES, DARK_THEME_IDS, DEFAULT_THEME } from "./theme.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("./styles/themes.css");
const msgs = read("./i18n/messages.ts");
const drawer = read("../../nunopi/src/components/settings/SettingsDrawer.tsx");

// 상대 휘도 대비(WCAG).
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 테마 이름은 고유명사라 모든 언어에서 영어 그대로(#1283 유저 결정).
const label = (k: string) => [...msgs.matchAll(new RegExp(`"${k.replace(".", "\\.")}": "([^"]*)"`, "g"))].map((m) => m[1]);
for (const t of THEMES) {
  assert.ok(label(t.labelKey).every((x) => /^[\x20-\x7eé]+$/.test(x)), `${t.id}: 이름은 영어로`);
  assert.strictEqual(msgs.split(`"${t.labelKey}":`).length - 1, 3, `${t.id}: 이름이 3개 언어에 다 있어야`);
  assert.ok(new RegExp(`^\\s+"?${t.id}"?: \\{ bg: "#`, "m").test(drawer), `${t.id}: 견본 색`);
  if (t.id === "dark" || t.id === "light") continue; // 기본 두 팔레트는 globals.css 기본값
  const block = css.match(new RegExp(`:root\\[data-theme="${t.id}"\\] \\{([^}]*)\\}`))?.[1];
  assert.ok(block, `${t.id}: CSS 블록`);
  const v = (k: string) => {
    const m = block.match(new RegExp(`--${k}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(m, `${t.id}: --${k}`);
    return m[1];
  };
  // 본문 글자(라이트 zinc-700 on 패널 white, 다크 zinc-300 on 패널 zinc-900) ≥ 4.5, 흐린 글자 ≥ 3.
  const [panel, body, faint] = t.base === "light" ? [v("color-white"), v("color-zinc-700"), v("color-zinc-500")] : [v("color-zinc-900"), v("color-zinc-300"), v("color-zinc-400")];
  assert.ok(contrast(panel, body) >= 4.5, `${t.id}: 본문 대비 ${contrast(panel, body).toFixed(2)}`);
  assert.ok(contrast(panel, faint) >= 3, `${t.id}: 흐린 글자 대비 ${contrast(panel, faint).toFixed(2)}`);
  // 더 흐린 글자(라이트 zinc-400·다크 zinc-500)도 글자로 많이 씀 → ≥ 3.
  // 한계: 대비는 주 패널 위에서만 잼. 한 단계 밝은 면(다크 zinc-800·라이트 zinc-100) 위 흐린 글자는
  //   기본 Tailwind 팔레트·기존 테마도 3 미만(라이트 기본 ≈2.3)이라 같은 기준을 쓰지 않음.
  // 한계: solarized 두 테마는 원래 값(라이트 base1 2.58·다크 2.99)이라 예외(#914 그대로).
  const fainter = t.base === "light" ? v("color-zinc-400") : v("color-zinc-500");
  if (!t.id.startsWith("solarized-")) assert.ok(contrast(panel, fainter) >= 3, `${t.id}: 더 흐린 글자 대비 ${contrast(panel, fainter).toFixed(2)}`);
  assert.ok(contrast(v("background"), v("foreground")) >= 4.5, `${t.id}: 배경·글자 대비`);
}

// 깜빡임 방지 스크립트(두 앱 layout)의 다크 목록 = THEMES의 dark.
for (const p of ["../../../apps/mustard/app/layout.tsx", "../../../apps/nunopi/app/layout.tsx"]) {
  const list = read(p).match(/var dark=\[([^\]]*)\]/)?.[1];
  assert.ok(list, `${p}: 다크 목록`);
  assert.ok(read(p).includes(`if(!t)t='${DEFAULT_THEME}'`), `${p}: 기본 테마가 DEFAULT_THEME와 달라`);
  assert.deepStrictEqual(list.split(",").map((s) => s.replace(/'/g, "").trim()).sort(), [...DARK_THEME_IDS].sort(), `${p}: 다크 목록이 THEMES와 달라`);
}
console.log(`theme ok (${THEMES.length})`);
