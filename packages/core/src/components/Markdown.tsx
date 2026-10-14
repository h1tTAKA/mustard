"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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
const keepAppLinks = (url: string) => (/^catchup:/i.test(url) ? url : defaultUrlTransform(url));
export default function Markdown({ children, className, onLink }: { children: string; className?: string; onLink?: (href: string) => boolean }) {
  return (
    <div className={className ? `nunopi-md ${className}` : "nunopi-md"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]} urlTransform={keepAppLinks}
        components={onLink ? { a: ({ href, children: c, ...rest }) => <a {...rest} href={href} onClick={(e) => { if (href && onLink(href)) e.preventDefault(); }}>{c}</a> } : undefined}>
        {fixCjkEmphasis(children)}
      </ReactMarkdown>
    </div>
  );
}
