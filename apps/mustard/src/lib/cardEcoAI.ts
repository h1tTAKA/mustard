// #1388 토큰 카드 소속(언어·라이브러리·프레임워크) 묻기 — 해설 AI에 [{name, def}]를 보내고 "번호 이름"으로 받음. 순수 함수(점검).
export function ecoPrompt(items: { name: string; def: string }[]): string {
  return `아래는 코드에 쓰는 이름(토큰)과 뜻이야. 각 토큰이 속한 **언어·라이브러리·프레임워크 하나**의 공식 이름을 골라.
- 가장 구체적인 것으로: Flutter 위젯이면 "Flutter"(Dart 아님), React 훅이면 "React", 표준 라이브러리면 그 언어("Python"·"TypeScript"·"Swift"·"Go" 등), CLI 명령·옵션이면 그 도구("Git"·"npm"·"Docker").
- 어디에도 속하지 않는 일반 이름이거나 모르겠으면 "-".
답은 한 줄에 하나, "번호 이름"만(예: "1 Flutter", "2 -"). 설명·다른 말 금지.

${items.map((x, i) => `${i + 1}. ${x.name.replace(/\s+/g, " ")} — ${x.def.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}`;
}

// "1 Flutter" / "2. React Native" / "3: -" → 번호별 이름("" = 모름). 빠진 번호는 undefined.
export function parseEco(text: string, n: number): (string | undefined)[] {
  const out: (string | undefined)[] = Array(n).fill(undefined);
  for (const m of String(text || "").matchAll(/^[ \t*#>-]*\[?(\d+)\]?\**[.): \t-]+\**([^\n]*?)\**[ \t]*$/gm)) {
    const i = Number(m[1]) - 1;
    const name = m[2].replace(/["'`*]/g, "").replace(/\s*[—–(].*$/, "").trim();
    if (i < 0 || i >= n || out[i] !== undefined) continue;
    if (/^-+$|^(없음|none|n\/a|unknown)$/i.test(name) || !name) out[i] = "";
    else if (name.length <= 30 && name.split(/\s+/).length <= 3 && !/[.,!?。、:;]|[가-힣]{2,}/.test(name.replace(/\.[a-z0-9]+\b/gi, "")) && !name.split(/\s+/).some((w) => /^(is|are|with|for|the|a|an|used|built|uses|in|by|from|of|and)$/i.test(w))) out[i] = name; // 문장 답(설명)은 이름 아님 → 빠진 것으로(다음에 다시, 리뷰). 한계: 낱말 목록으로 거르는 어림 — 틀려도 두 번 빠지면 "모름"이라 표시만 빠짐
  }
  return out;
}
