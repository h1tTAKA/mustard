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

// 라이트 강조 글자(#1289) — :root:not(.dark)의 mustard-600을 모든 라이트 테마에 공통으로 씀.
const accent = css.match(/:root:not\(\.dark\) \{[^}]*--color-mustard-600:\s*(#[0-9a-f]{6})/i)?.[1];
assert.ok(accent, "라이트 강조색 블록");
// 기본 Light 팔레트 = globals.css(흰 면·zinc-50·100) + Tailwind 기본 zinc(500~700) — 블록에 없는 값만.
const LIGHT_BASE: Record<string, string> = { background: "#ffffff", foreground: "#171717", "color-white": "#ffffff", "color-zinc-50": "#fafafa", "color-zinc-100": "#f4f4f5", "color-zinc-500": "#71717b", "color-zinc-600": "#52525c", "color-zinc-700": "#3f3f46" };

// 테마 이름은 고유명사라 모든 언어에서 영어 그대로(#1283 유저 결정).
const label = (k: string) => [...msgs.matchAll(new RegExp(`"${k.replace(".", "\\.")}": "([^"]*)"`, "g"))].map((m) => m[1]);
for (const t of THEMES) {
  assert.ok(label(t.labelKey).every((x) => /^[\x20-\x7eé]+$/.test(x)), `${t.id}: 이름은 영어로`);
  assert.strictEqual(msgs.split(`"${t.labelKey}":`).length - 1, 3, `${t.id}: 이름이 3개 언어에 다 있어야`);
  assert.ok(new RegExp(`^\\s+"?${t.id}"?: \\{ bg: "#`, "m").test(drawer), `${t.id}: 견본 색`);
  if (t.id === "dark") continue; // 기본 다크 팔레트는 globals.css 기본값
  const block = css.match(new RegExp(`:root\\[data-theme="${t.id}"\\] \\{([^}]*)\\}`))?.[1];
  assert.ok(block, `${t.id}: CSS 블록`);
  const v = (k: string) => {
    const m = block.match(new RegExp(`--${k}:\\s*(#[0-9a-f]{6})`, "i"));
    const hex = m?.[1] ?? (t.id === "light" ? LIGHT_BASE[k] : undefined); // 기본 Light 블록은 덮는 값만 있음
    assert.ok(hex, `${t.id}: --${k}`);
    return hex;
  };
  if (t.base === "light") {
    // #1289 라이트는 흰 면만이 아니라 hover·칩 면(zinc-100)·작은 입력 면(zinc-50)에서도 잼 — 흐린 글자가 거기서 많이 안 보였음.
    const [z50, z100] = [v("color-zinc-50"), v("color-zinc-100")];
    const need = (fg: string, bg: string, min: number, what: string) => assert.ok(contrast(fg, bg) >= min, `${t.id}: ${what} ${contrast(fg, bg).toFixed(2)} < ${min}`);
    need(v("color-zinc-700"), z100, 4.5, "본문(zinc-700)/zinc-100");
    need(v("color-zinc-600"), z100, 4.5, "본문(zinc-600)/zinc-100");
    need(v("color-zinc-500"), z50, 4.5, "보조(zinc-500)/zinc-50");
    need(v("color-zinc-500"), z100, 4, "보조(zinc-500)/zinc-100");
    need(v("color-zinc-400"), z100, 3, "흐린(zinc-400)/zinc-100");
    need(v("color-zinc-400"), v("background"), 3, "흐린(zinc-400)/배경");
    need(accent, v("color-white"), 4.5, "강조(mustard-600)/흰 면");
    need(accent, z100, 3, "강조(mustard-600)/zinc-100");
    // 옅음 → 진함 순서가 뒤집히지 않게(진하게 맞추다 단계가 섞이는 것 방지).
    const steps = ["color-zinc-400", "color-zinc-500", "color-zinc-600", "color-zinc-700"].map((k) => contrast(v(k), z100));
    assert.ok(steps.every((c, i) => i === 0 || c >= steps[i - 1]), `${t.id}: 글자 단계 순서 ${steps.map((c) => c.toFixed(2)).join(" ")}`);
  }
  // 본문 글자(라이트 zinc-700 on 패널 white, 다크 zinc-300 on 패널 zinc-900) ≥ 4.5, 흐린 글자 ≥ 3.
  const [panel, body, faint] = t.base === "light" ? [v("color-white"), v("color-zinc-700"), v("color-zinc-500")] : [v("color-zinc-900"), v("color-zinc-300"), v("color-zinc-400")];
  assert.ok(contrast(panel, body) >= 4.5, `${t.id}: 본문 대비 ${contrast(panel, body).toFixed(2)}`);
  assert.ok(contrast(panel, faint) >= 3, `${t.id}: 흐린 글자 대비 ${contrast(panel, faint).toFixed(2)}`);
  // 더 흐린 글자(라이트 zinc-400·다크 zinc-500)도 글자로 많이 씀 → ≥ 3.
  // 한계: 다크는 주 패널 위에서만 잼 — 한 단계 밝은 면(zinc-800) 위 흐린 글자는 기본 팔레트도 3 미만이라 같은 기준을 안 씀.
  // 한계: Solarized Dark는 원래 값(base01 2.99)이라 예외(#914 그대로). Solarized Light는 #1289에서 진하게 맞춰 예외 없음.
  // 한계: 반투명 면(bg-mustard-500/10 등) 위는 섞인 색이 테마마다 달라 안 잼.
  const fainter = t.base === "light" ? v("color-zinc-400") : v("color-zinc-500");
  if (t.id !== "solarized-dark") assert.ok(contrast(panel, fainter) >= 3, `${t.id}: 더 흐린 글자 대비 ${contrast(panel, fainter).toFixed(2)}`);
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
