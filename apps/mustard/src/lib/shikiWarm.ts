"use client";
// 코드 하이라이트 미리 데우기(#1326 후속) — shiki는 처음 쓰는 언어 문법·테마를 그때 불러와서, 처음 연 파일은
// 잠깐 흰 글씨였다가 색이 칠해짐(유저 피드백: python). 앱이 한가할 때 흔한 언어를 같은 싱글톤에 미리 올려 둠
// → CodePane(codeToHtml)·DiffPane(codeToTokens)이 바로 칠함. 목록에 없는 언어는 처음 한 번만 그 자리에서 불러옴.
import { getSingletonHighlighter, type BundledLanguage } from "shiki";

const LANGS: BundledLanguage[] = ["typescript", "tsx", "javascript", "jsx", "json", "python", "swift", "kotlin", "java", "dart", "go", "rust", "ruby", "php",
  "c", "cpp", "csharp", "objective-c", "html", "css", "scss", "vue", "svelte", "markdown", "yaml", "toml", "shellscript", "sql", "xml", "dockerfile", "groovy", "ini", "lua", "elixir"];
let started = false;
export function warmShiki() {
  if (started || typeof window === "undefined") return;
  started = true;
  const run = () => { void getSingletonHighlighter({ themes: ["github-dark", "github-light"], langs: LANGS }).catch(() => { /* 실패해도 그때그때 불러옴 */ }); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 }); else setTimeout(run, 1500);
}
