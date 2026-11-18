"use client";
// #1380 마크다운 펜스 코드를 shiki(VS Code와 같은 TextMate 문법)로 다시 칠하기 — highlight.js는 문법이 얕아(Dart 등) 타입·호출·인자가 흰색.
// 처음엔 highlight.js 결과를 그대로 보여 주고(깜빡임 없음) 뒤에서 shiki 토큰이 오면 바꿔 그림. 모르는 언어·실패면 highlight.js 그대로.
// 언어: 펜스 표시(```dart)가 있을 때만. 표시 없는 블록은 highlight.js 자동 감지 그대로 — 한계: highlight.js 추측은 Dart를 php로 보는 등 믿을 수 없어 shiki엔 안 씀, 해설·카드 지시가 언어 표시를 하게 함.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ThemedToken } from "shiki";

// 다크 모드 — 코드블록마다 감시하지 않게 감시자 하나를 같이 씀
const darkSubs = new Set<() => void>();
let darkObs: MutationObserver | null = null;
function subscribeDark(cb: () => void) {
  darkSubs.add(cb);
  if (!darkObs && typeof document !== "undefined") {
    darkObs = new MutationObserver(() => darkSubs.forEach((f) => f()));
    darkObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  return () => { darkSubs.delete(cb); if (!darkSubs.size) { darkObs?.disconnect(); darkObs = null; } };
}
const isDark = () => document.documentElement.classList.contains("dark");
export const useDark = () => useSyncExternalStore(subscribeDark, isDark, () => false);

// hast(마크다운 → HTML 나무) 마디의 글자만
type HNode = { type?: string; value?: string; children?: HNode[]; properties?: Record<string, unknown> };
export const hastText = (n: HNode | undefined): string => !n ? "" : n.type === "text" ? n.value ?? "" : (n.children ?? []).map(hastText).join("");

type Painted = { key: string; lines: ThemedToken[][] };
export function useShiki(code: string, lang: string | undefined): Painted | null {
  const dark = useDark();
  const key = `${dark ? "d" : "l"}|${lang ?? ""}|${code}`;
  const [painted, setPainted] = useState<Painted | null>(null);
  useEffect(() => {
    let live = true; // 글이 바뀌면(스트리밍) 늦게 끝난 옛 결과는 버림
    const timer = setTimeout(() => void (async () => { // 스트리밍 중 글자 늘 때마다 다시 칠하지 않게 잠깐 멈췄을 때만(리뷰)
      const name = lang;
      if (!name || !code.trim()) return;
      const { codeToTokens, bundledLanguages, bundledLanguagesAlias } = await import("shiki");
      if (!(name in bundledLanguages) && !(name in (bundledLanguagesAlias as Record<string, unknown>))) return; // shiki가 모르는 언어 → highlight.js 그대로
      const r = await codeToTokens(code.replace(/\n$/, ""), { lang: name as never, theme: dark ? "github-dark" : "github-light" });
      if (live) setPainted({ key, lines: r.tokens });
    })().catch(() => { /* 실패 → highlight.js 그대로 */ }), 150);
    return () => { live = false; clearTimeout(timer); };
  }, [key, code, lang, dark]);
  return painted?.key === key ? painted : null;
}

export function ShikiLines({ lines }: { lines: ThemedToken[][] }): ReactNode {
  return lines.map((ln, i) => (
    <span key={i}>
      {ln.map((t, j) => <span key={j} style={{ color: t.color, fontStyle: (t.fontStyle ?? 0) & 1 ? "italic" : undefined, fontWeight: (t.fontStyle ?? 0) & 2 ? 600 : undefined }}>{t.content}</span>)}
      {i < lines.length - 1 ? "\n" : null}
    </span>
  ));
}
