// 파일 확장자 → 문법 색칠 언어(shiki) — 코드 보기·diff·캐치업이 같이 씀(#1229에서 한곳으로).
const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  rb: "ruby", php: "php", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  css: "css", scss: "scss", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "bash", sql: "sql", toml: "toml",
};
export const langOf = (file: string) => EXT_LANG[file.split(".").pop()?.toLowerCase() ?? ""] ?? "text";
