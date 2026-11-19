"use client";

import { createContext, memo, useContext, useMemo, useRef, useState, type ComponentProps } from "react";
import { codeKind } from "../codeKind";
import { useShiki, ShikiLines, hastText } from "./shikiCode";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { common } from "lowlight";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import scala from "highlight.js/lib/languages/scala";
import elixir from "highlight.js/lib/languages/elixir";
import haskell from "highlight.js/lib/languages/haskell";
import groovy from "highlight.js/lib/languages/groovy";
import gradle from "highlight.js/lib/languages/gradle";
import protobuf from "highlight.js/lib/languages/protobuf";
import powershell from "highlight.js/lib/languages/powershell";
import ocaml from "highlight.js/lib/languages/ocaml";
import clojure from "highlight.js/lib/languages/clojure";
import erlang from "highlight.js/lib/languages/erlang";
import julia from "highlight.js/lib/languages/julia";
import nix from "highlight.js/lib/languages/nix";
import cmake from "highlight.js/lib/languages/cmake";
import nginx from "highlight.js/lib/languages/nginx";
import fsharp from "highlight.js/lib/languages/fsharp";
import properties from "highlight.js/lib/languages/properties";

// CJK 강조 버그 보정: 닫는 `*`/`**` 앞이 ASCII 문장부호이고 바로 뒤가 한글/가나/한자면
// CommonMark flanking 규칙상 강조가 안 닫혀 `**`가 리터럴로 남는다(예: `**A (a.ts)**는`).
// 부호와 별표 사이에 제로폭공백(U+200B)을 끼우면 flanking을 통과해 정상 볼드/이탤릭이 된다(보이지 않음).
const CJK_EMPHASIS = /([)\]}>.,!?%:;"'’”》」』])(\*{1,2})(?=[가-힣぀-ヿ一-鿿])/g;
const ZWSP = "​"; // 제로폭 공백(보이지 않음)
// 코드 펜스(```…```)와 인라인 코드(`…`)는 원문 그대로 두고, 텍스트 구간에만 강조 보정을 적용.
// (코드 안에 우연히 `).**한글` 같은 패턴이 있어도 ZWSP가 코드에 섞이지 않게.)
const CODE_OR_TEXT = /(```[\s\S]*?```|`[^`]*`)|([^`]+)/g;
const fixCjkEmphasis = (s: string) =>
  s.replace(CODE_OR_TEXT, (m, code, text) => (code !== undefined ? code : (text as string).replace(CJK_EMPHASIS, `$1${ZWSP}$2`)));

// 챗/카드설명 답변을 마크다운으로 렌더(GFM 표 포함). raw HTML은 렌더하지 않아 안전.
// 코드펜스는 rehype-highlight(highlight.js)로 신택스 하이라이팅(테마는 globals.css의 hljs).
// detect: 언어 태그 없는 펜스(``` 만)도 자동 감지해 하이라이팅 — 모델 출력의 언어 표기가
// 들쭉날쭉해도 색이 입혀진다. (미등록 언어 태그는 rehype-highlight v7이 에러 없이 스킵 — 기본 동작.)
// 스타일은 globals.css의 .nunopi-md로 스코프한다(표/코드/목록/제목/링크 등).
// onLink(선택, #1081): 링크 클릭을 앱이 먼저 처리(true 반환 = 처리함, 기본 이동 막음). catchup: 같은 앱 내부 스킴은 지우지 않음.
// 빈 href(javascript: 등이 걸러져 ""가 된 것)는 이동 막음 — 같은 문서로 이동 = 화면 새로고침(#1139 리뷰).
const keepAppLinks = (url: string) => (/^catchup:/i.test(url) ? url : defaultUrlTransform(url));
// #1228 ReactMarkdown은 그릴 때마다 플러그인을 새로 붙이는데, rehype-highlight는 붙을 때마다 언어 수십 개를 새로 등록(createLowlight)함
// → 카드가 많은 화면이 다시 그려질 때마다 정규식 수천 개를 만들고 버려 화면 CPU 100%+·GC 30% 가까이(실측). 한 번 만든 변환기를 계속 씀.
// memo — 부모가 다시 그려져도 같은 글이면 다시 파싱하지 않음(onLink를 매번 새로 넘기는 곳은 효과 없음).
// #1272 기본 37개(common)에 없던 언어(dart 등)를 더 등록. 표기 없는 펜스 자동 감지는 지금처럼 37개 안에서만(subset).
const EXTRA = { dart, dockerfile, scala, elixir, haskell, groovy, gradle, protobuf, powershell, ocaml, clojure, erlang, julia, nix, cmake, nginx, fsharp, properties };
let highlight: ReturnType<typeof rehypeHighlight> | undefined;
// #1380 펜스에 언어 표시가 원래 있었는지 — rehype-highlight가 자동 감지한 언어도 같은 class로 붙여서, 그 전에 표시해 둠(추측한 언어는 shiki에 안 씀)
type HEl = { type?: string; tagName?: string; children?: HEl[]; properties?: Record<string, unknown> };
const markTagged = () => (tree: HEl) => {
  const walk = (n: HEl) => {
    if (n.type === "element" && n.tagName === "pre") for (const c of n.children ?? []) if (c.type === "element" && c.tagName === "code") {
      const cls = c.properties?.className;
      c.properties = { ...c.properties, dataTagged: Array.isArray(cls) && cls.some((x) => String(x).startsWith("language-")) ? "1" : "0" };
    }
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
};
const highlightOnce = () => (highlight ??= rehypeHighlight({ detect: true, languages: { ...common, ...EXTRA }, subset: Object.keys(common), aliases: { xml: ["vue", "svelte"] } }));
// #1325 인라인 코드 역할별 색 — `백틱` 조각을 모양으로 분류해 data-k를 붙임(색은 globals.css, 블록 코드 안은 CSS에서 제외).
const InPre = createContext(false); // 펜스 코드(<pre> 안)는 한 줄이라도 분류 안 함(리뷰)
function Pre({ node: _node, ...rest }: ComponentProps<"pre"> & { node?: unknown }) {
  return <InPre.Provider value><pre {...rest} /></InPre.Provider>;
}
// #1341 채팅 — 코드 블록에 마우스를 올리면 복사(copyCode 켠 곳만, 다른 화면 모양은 그대로)
function CopyPre({ node: _node, children, ...rest }: ComponentProps<"pre"> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(ref.current?.innerText ?? "").then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); };
  return (
    <div className="group/code relative">
      <InPre.Provider value><pre ref={ref} {...rest}>{children}</pre></InPre.Provider>
      <button type="button" onClick={copy} aria-label="Copy" className="absolute right-1.5 top-1.5 rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] text-zinc-500 opacity-0 shadow-sm transition hover:text-zinc-800 group-hover/code:opacity-100 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:text-zinc-100">{done ? "✓" : "Copy"}</button>
    </div>
  );
}
// #1380 펜스 코드 = shiki로 다시 칠함(오기 전·실패는 highlight.js 그대로)
function FenceCode({ node, className, children, ...rest }: ComponentProps<"code"> & { node?: unknown }) {
  const r = rest as Record<string, unknown>;
  const tagged = r["data-tagged"] === "1";
  const { ["data-tagged"]: _t, ...attrs } = r;
  const lang = tagged ? /(?:^|\s)language-([\w+#.-]+)/.exec(className ?? "")?.[1] : undefined;
  const painted = useShiki(hastText(node as never), lang);
  return <code className={className} {...attrs}>{painted ? <ShikiLines lines={painted.lines} /> : children}</code>;
}
function InlineCode({ node: _node, className, children, ...rest }: ComponentProps<"code"> & { node?: unknown }) {
  const inPre = useContext(InPre);
  if (inPre) return <FenceCode node={_node} className={className} {...rest}>{children}</FenceCode>;
  const text = typeof children === "string" ? children : Array.isArray(children) && children.every((c) => typeof c === "string") ? children.join("") : null;
  const k = !inPre && !className && text !== null && !text.includes("\n") ? codeKind(text) : "plain"; // 언어 클래스가 붙은 건 펜스 코드 → 분류 안 함
  return k === "plain" ? <code className={className} {...rest}>{children}</code> : <code data-k={k} {...rest}>{children}</code>;
}
export default memo(function Markdown({ children, className, onLink, copyCode }: { children: string; className?: string; onLink?: (href: string) => boolean; copyCode?: boolean }) {
  const components = useMemo(() => ({
    code: InlineCode, pre: copyCode ? CopyPre : Pre,
    ...(onLink ? { a: ({ href, children: c, node: _n, ...rest }: ComponentProps<"a"> & { node?: unknown }) => <a {...rest} href={href} onClick={(e) => { if (!href || onLink(href)) e.preventDefault(); }}>{c}</a> } : {}),
  }), [onLink, copyCode]);
  return (
    <div className={className ? `nunopi-md ${className}` : "nunopi-md"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[markTagged, highlightOnce]} urlTransform={keepAppLinks}
        components={components}>
        {fixCjkEmphasis(children)}
      </ReactMarkdown>
    </div>
  );
});
