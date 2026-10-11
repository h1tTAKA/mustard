// 고른 요소의 소스 file:line(#1039). 페이지 안에서 돌도록 **자기완결** 함수 하나 — pick 스크립트가 toString()으로 끼워 넣음.
// 그래서 바깥 변수·import·async/await(빌드가 헬퍼를 끼울 수 있음) 없이 Promise 체인만 씀.
//
// React 19 dev: fiber._debugStack = JSX를 만든 자리의 Error → 스택의 첫 사용자 프레임(번들 chunk URL:줄:칸)
//   → chunk를 fetch(같은 origin) → sourceMappingURL → source map(일반·Turbopack index map) VLQ 디코드 → 원본 위치.
// React ≤18: fiber._debugSource 그대로. 첫 항목 = 요소 자신(을 쓴 JSX), 다음 = 그 요소를 그린 바깥 컴포넌트들(_debugOwner).
export interface SourceLoc { name: string; file: string; line: number; col: number }

/* eslint-disable @typescript-eslint/no-explicit-any -- 페이지의 React 내부 객체(타입 없음) */
export function findSources(el: any, fetchText: (url: string) => Promise<string>, maxOwners = 2): Promise<SourceLoc[]> {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleanPath = (p: string) => String(p)
    .replace(/^webpack:\/\/[^/]*\//, "").replace(/^turbopack:\/\/\/(\[project\]\/)?/, "").replace(/^\[project\]\//, "")
    .replace(/^file:\/\//, "").replace(/^\.\//, "").replace(/\?.*$/, "");
  const nameOf = (f: any): string => {
    const t = f && f.type;
    if (typeof t === "function") return t.displayName || t.name || "";
    if (t && typeof t === "object") return t.displayName || (t.render && (t.render.displayName || t.render.name)) || "";
    return (f && typeof f.name === "string" && f.name) || ""; // React 19 서버 컴포넌트 정보(ReactComponentInfo)
  };
  // 스택 프레임들(위→아래). eval 프레임은 URL이 엉망이라 뺌. 번들 URL로는 거르지 않음 — Metro(Expo)는 앱 코드까지
  // 한 번들이고 그 URL에 node_modules가 들어 있어 다 버려짐(#1047). 라이브러리 여부는 원본 위치로만 판단(locate).
  const framesOf = (stack: string) => {
    const out: { url: string; line: number; col: number }[] = [];
    for (const ln of String(stack || "").split("\n").slice(1)) {
      if (ln.includes("eval at ")) continue;
      const m = ln.match(/at (?:.*? \()?(.+?):(\d+):(\d+)\)?\s*$/);
      if (m) out.push({ url: m[1], line: Number(m[2]), col: Number(m[3]) });
    }
    return out.slice(0, 8);
  };
  const LIB = /node_modules|next\/dist|^react(-dom)?\//;
  // VLQ — mappings에서 생성 줄 L(0부터)의 칸 C 이하 마지막 세그먼트 → [srcIdx, srcLine, srcCol](0부터).
  const lookup = (mappings: string, L: number, C: number) => {
    let line = 0, genCol = 0, src = 0, sLine = 0, sCol = 0, best: number[] | null = null;
    let i = 0;
    while (i < mappings.length && line <= L) {
      const ch = mappings[i];
      if (ch === ";") { line++; genCol = 0; i++; continue; }
      if (ch === ",") { i++; continue; }
      const seg: number[] = [];
      while (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
        let v = 0, shift = 0, d: number;
        do {
          if (i >= mappings.length) return best; // 잘린 맵 — 끝을 넘어 indexOf(undefined)=-1이면 무한 루프(페이지가 멈춤, #1039 리뷰)
          d = B64.indexOf(mappings[i++]);
          if (d < 0) return best;
          v += (d & 31) << shift; shift += 5;
        } while (d & 32);
        seg.push(v & 1 ? -(v >> 1) : v >> 1);
      }
      genCol += seg[0];
      if (seg.length >= 4) { src += seg[1]; sLine += seg[2]; sCol += seg[3]; }
      if (line === L && seg.length >= 4 && genCol <= C) best = [src, sLine, sCol];
    }
    return best;
  };
  // 맵의 상대 경로 source(Vite: "App.tsx")는 맵 URL 기준으로 풀어 경로만(/src/App.tsx → src/App.tsx). 스킴·절대경로는 그대로.
  const resolveSrc = (s: string, base: string) => {
    if (/^[a-z][\w+.-]*:|^\//i.test(s)) return s;
    try { return decodeURIComponent(new URL(s, base).pathname).slice(1); } catch { return s; }
  };
  const fromMap = (map: any, L: number, C: number, base: string): { file: string; line: number; col: number } | null => {
    if (map && Array.isArray(map.sections)) { // Turbopack index map — 이 위치를 덮는 마지막 섹션
      let pick: any = null;
      for (const s of map.sections) { const o = s.offset || { line: 0, column: 0 }; if (o.line < L || (o.line === L && o.column <= C)) pick = s; }
      if (!pick || !pick.map) return null;
      const o = pick.offset || { line: 0, column: 0 };
      return fromMap(pick.map, L - o.line, o.line === L ? C - o.column : C, base);
    }
    if (!map || typeof map.mappings !== "string") return null;
    const hit = lookup(map.mappings, L, C);
    if (!hit || !map.sources || !map.sources[hit[0]]) return null;
    const root = map.sourceRoot || "";
    const src = resolveSrc((root && !root.endsWith("/") ? root + "/" : root) + map.sources[hit[0]], base);
    return { file: cleanPath(src), line: hit[1] + 1, col: hit[2] + 1 };
  };
  const maps: Record<string, Promise<any>> = {};
  const mapFor = (url: string): Promise<any> => {
    if (!maps[url]) maps[url] = fetchText(url).then((js) => {
      const all = js.match(/\/\/[#@] sourceMappingURL=(\S+)/g);
      if (!all) return null;
      const ref = all[all.length - 1].replace(/^\/\/[#@] sourceMappingURL=/, "");
      const m = ref.match(/^data:application\/json[^,]*?;base64,(.+)$/);
      if (m) return { map: JSON.parse(decodeURIComponent(escape(atob(m[1])))), base: url };
      const mapUrl = new URL(ref, url).href; // 상대·절대·//host(Metro) 모두
      return fetchText(mapUrl).then((t) => ({ map: JSON.parse(t), base: mapUrl }));
    }).catch(() => null);
    return maps[url];
  };
  const locate = (f: any): Promise<{ file: string; line: number; col: number } | null> => {
    const ds = f && f._debugSource;
    if (ds && ds.fileName) return Promise.resolve({ file: cleanPath(ds.fileName), line: ds.lineNumber || 0, col: ds.columnNumber || 0 });
    const st = f && f._debugStack;
    const frames = framesOf(st && typeof st === "object" ? st.stack : st);
    // 위에서부터 하나씩 원본으로 바꿔 보고, 라이브러리가 아닌 첫 위치를 씀(못 바꾸면 다음 프레임).
    const tryAt = (k: number): Promise<{ file: string; line: number; col: number } | null> => {
      if (k >= frames.length) return Promise.resolve(null);
      const fr = frames[k];
      // next dev --webpack(eval-source-map): webpack-internal:///(…)/./src/x.tsx:줄:칸 — fetch 불가, 경로·줄을 그대로(줄은 대략).
      if (fr.url.startsWith("webpack-internal:")) {
        const file = cleanPath(fr.url.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, ""));
        return LIB.test(file) ? tryAt(k + 1) : Promise.resolve({ file, line: fr.line, col: fr.col });
      }
      return mapFor(fr.url).then((map) => {
        const loc = map ? fromMap(map.map, fr.line - 1, fr.col - 1, map.base) : null;
        return loc && !LIB.test(loc.file) ? loc : tryAt(k + 1);
      });
    };
    return tryAt(0);
  };

  const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  const host = key ? el[key] : null;
  if (!host) return Promise.resolve([]);
  // [요소 자신(이름 = 그린 컴포넌트), 바깥 컴포넌트들] — owner가 없는 React 18은 return 체인의 컴포넌트로.
  const chain: { f: any; name: string }[] = [];
  let owner = host._debugOwner;
  if (!owner) { for (let r = host.return; r; r = r.return) if (typeof r.type === "function" || (r.type && typeof r.type === "object")) { owner = r; break; } }
  chain.push({ f: host, name: nameOf(owner) });
  for (let o = owner; o && chain.length < maxOwners + 1; o = o._debugOwner) chain.push({ f: o, name: nameOf(o._debugOwner) || nameOf(o) });
  return Promise.all(chain.map((c) => locate(c.f).catch(() => null)))
    .then((locs) => locs.map((l, i) => (l ? { name: chain[i].name, ...l } : null)).filter((x): x is SourceLoc => !!x && !!x.file));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
