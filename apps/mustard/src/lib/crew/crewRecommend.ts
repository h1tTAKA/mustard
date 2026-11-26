// 봇 추천(#1394) — "맡길 일" 한 줄 + 레포 언어 비율 → 카탈로그 id 3개. AI 한 번 묻기, 실패하면 단어·언어 규칙.
// repoLangs만 서버(git) 전용, 나머지는 순수 함수.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CATALOG, type CatalogItem } from "./crewCatalog.ts";

export type LangShare = { ext: string; share: number };

// 카탈로그가 아는 코드 확장자만 센다(md·json 같은 건 언어로 안 침).
const KNOWN = new Set(CATALOG.flatMap((c) => c.langs).filter((e) => !["md", "mdx", "html"].includes(e)));

export function langShares(files: string[]): LangShare[] {
  const n = new Map<string, number>();
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
    if (f.includes(".") && KNOWN.has(ext)) n.set(ext, (n.get(ext) ?? 0) + 1);
  }
  const total = [...n.values()].reduce((a, b) => a + b, 0);
  return [...n].map(([ext, c]) => ({ ext, share: Math.round((c / total) * 100) / 100 })).sort((a, b) => b.share - a.share).slice(0, 5);
}

// 레포 언어 비율 — git이 추적하는 파일 확장자. 레포가 아니거나 실패하면 빈 목록(언어 무관 추천).
// 비동기 — 큰 레포에서 서버 전체가 멈추지 않게(리뷰).
export async function repoLangs(root: string): Promise<LangShare[]> {
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, timeout: 10_000 });
    return langShares(stdout.split("\0").filter(Boolean));
  } catch { return []; }
}

// 맡길 일 단어 → 할 일 종류(ko/ja/en). 순서 = 우선순위.
const INTENTS: { re: RegExp; ids: string[] | "review" | "build" }[] = [
  { re: /리뷰|검토|review|レビュー|\bPR\b/i, ids: "review" },
  { re: /보안|취약|security|vulnerab|セキュリティ|脆弱/i, ids: ["security-reviewer"] },
  { re: /빌드|컴파일|\bCI\b|build|compile|ビルド|コンパイル/i, ids: "build" },
  { re: /테스트|\b(?:tests?|testing|vitest|pytest|unittest|jest)\b|テスト|\btdd\b|\be2e\b/i, ids: ["tdd-guide", "pr-test-analyzer"] },
  { re: /릴리스|배포|release|deploy|リリース|デプロイ/i, ids: ["release-checker"] },
  { re: /문서|readme|docs?\b|ドキュメント|文書/i, ids: ["doc-updater"] },
  { re: /메일|이메일|슬랙|일정|mail|slack|calendar|schedule|メール|予定|スケジュール/i, ids: ["chief-of-staff"] },
  { re: /seo|검색 노출/i, ids: ["seo-specialist"] },
  { re: /마케팅|카피|광고|marketing|\bcopy(writing)?\b|campaign|マーケ|広告/i, ids: ["marketing-agent"] },
  { re: /성능|느리|최적화|performance|slow|optimi|パフォーマンス|遅い|最適化/i, ids: ["performance-optimizer"] },
  { re: /설계|아키텍처|architect|design|設計|アーキ/i, ids: ["architect"] },
  { re: /계획|기획|\bplan(?:s|ned|ning|ner)?\b|計画|企画/i, ids: ["planner"] },
  { re: /리팩터|코드 ?정리|안 ?쓰는 코드|refactor|dead code|cleanup|リファクタ|コード整理/i, ids: ["refactor-cleaner"] },
  { re: /접근성|a11y|accessib|アクセシビリティ/i, ids: ["a11y-architect"] },
  { re: /만들|구현|기능|implement|feature|build an? app|実装|機能/i, ids: ["app-builder"] },
];

// 가장 많은 언어에 맞는 그 분류의 봇(없으면 다음 언어).
const forLang = (langs: LangShare[], group: CatalogItem["group"]) =>
  langs.map((l) => CATALOG.find((c) => c.group === group && c.langs.includes(l.ext))?.id).find(Boolean);

export function ruleRecommend(want: string, langs: LangShare[]): string[] {
  const out: string[] = [];
  for (const it of INTENTS) {
    if (!it.re.test(want)) continue;
    if (it.ids === "review") out.push("code-reviewer", ...[forLang(langs, "lang")].filter((x): x is string => !!x));
    else if (it.ids === "build") out.push(forLang(langs, "build") ?? "build-error-resolver");
    else out.push(...it.ids);
  }
  out.push(...[forLang(langs, "lang")].filter((x): x is string => !!x), "code-reviewer", "planner", "app-builder"); // 모자라면 채움
  return [...new Set(out)].slice(0, 3);
}

// AI용 질문 — 카탈로그 id·영어 설명 목록에서 3개만 고르게. 기본 역할 설명은 호출부가(i18n) 넘김.
export function recommendPrompt(want: string, langs: LangShare[], items: { id: string; desc: string }[]): string {
  return [
    "Pick the 3 best bots for this user's request from the catalog below. Order by fit.",
    `Request: ${want}`,
    `Repository languages (file extension: share): ${langs.length ? langs.map((l) => `${l.ext} ${Math.round(l.share * 100)}%`).join(", ") : "unknown"}`,
    "Prefer a language-specific bot when the repository language matches.",
    "",
    "Catalog:",
    ...items.map((i) => `- ${i.id}: ${i.desc}`),
    "",
    'Answer with ONLY a JSON array of 3 ids, e.g. ["code-reviewer","security-reviewer","typescript-reviewer"].',
  ].join("\n");
}

// AI 답 → 카탈로그에 있는 id만, 겹침 없이, 나온 순서대로. 모자라면 규칙으로 채움.
// 배열이 없으면 규칙 그대로 — 글 속 id를 줍다 보면 "planner 말고"처럼 부정한 것까지 고름(리뷰).
export function parseRecommend(text: string, fallback: string[]): string[] {
  const known = new Set(CATALOG.map((c) => c.id));
  const arr = text.match(/\[[^\]]*\]/)?.[0];
  let ids: string[] = [];
  try { ids = arr ? (JSON.parse(arr) as unknown[]).filter((x): x is string => typeof x === "string") : []; } catch { /* 아래 낱말로 */ }
  const picked = [...new Set(ids.filter((id) => known.has(id)))].slice(0, 3);
  return [...new Set([...picked, ...fallback])].slice(0, 3);
}
