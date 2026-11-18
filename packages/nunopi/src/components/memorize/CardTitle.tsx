// #1379 카드 앞면 제목 — 긴 코드 이름도 카드 안에서 줄바꿈(말줄임 X). 나눌 자리는 titleBreaks, 그래도 넘치면 아무 데서나.
import { Fragment } from "react";
import { titleBreaks } from "../../lib/titleBreak";

export function CardTitle({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`max-w-full [overflow-wrap:anywhere] ${className}`}>
      {titleBreaks(text).map((p, i) => <Fragment key={i}>{i > 0 && <wbr />}{p}</Fragment>)}
    </span>
  );
}
