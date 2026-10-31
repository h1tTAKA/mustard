// #1218 공백 보이기 — 스페이스·탭을 span으로 감싸고 기호(·, →)는 CSS ::before로만 그림(globals.css .ws-s/.ws-t).
// 글자는 원래 공백 그대로라 복사·선택·suggestion에 기호가 안 섞임.
import type { ReactNode } from "react";
import type { ShikiTransformer } from "shiki";

type El = Parameters<NonNullable<ShikiTransformer["span"]>>[0];

const parts = (s: string) => s.split(/([ \t])/).filter(Boolean);
const cls = (p: string) => (p === " " ? "ws-s" : p === "\t" ? "ws-t" : null);

// React로 그리는 줄(diff)
export function showWs(text: string): ReactNode {
  return parts(text).map((p, i) => { const c = cls(p); return c ? <span key={i} className={c}>{p}</span> : p; });
}

// shiki HTML로 그리는 파일 보기
export const wsTransformer: ShikiTransformer = {
  span(node) {
    node.children = node.children.flatMap((c): El["children"] => c.type !== "text" ? [c] : parts(c.value).map((p) => {
      const k = cls(p);
      return k ? { type: "element", tagName: "span", properties: { class: k }, children: [{ type: "text", value: p }] } : { type: "text", value: p };
    }));
  },
};
