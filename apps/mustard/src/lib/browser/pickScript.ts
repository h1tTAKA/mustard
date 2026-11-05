import { findSources, type SourceLoc } from "./sourceLookup.ts"; // .ts — check 스크립트(node)에서도 풀리게

// 인앱 브라우저 요소 선택(#1037) — webview.executeJavaScript로 페이지 안에 주입하는 스크립트.
// 페이지 쪽 코드라 import·클로저 없이 문자열 하나. 결과는 Promise: 클릭 → PickedElement, Esc/취소 → null.
// 오버레이는 shadow root 안(페이지 CSS와 안 섞임). 클릭은 capture 단계에서 막아 페이지 버튼이 눌리지 않게.

// kind: 클릭 = element(요소 하나), 드래그 = region(사각형 영역 — 안에 완전히 들어간 바깥쪽 요소들을 items로).
export interface PickedItem { tag: string; selector: string; text: string; components: string[] }
// 화면을 만든 틀(#1287) — 컴포넌트 이름 출처. flutter = 접근성 요소(라벨만), canvas = 그린 화면이라 HTML 구조 없음.
export type PickFramework = "react" | "vue" | "svelte" | "angular" | "flutter" | "canvas" | "";
export interface PickedElement {
  kind: "element" | "region";
  items: PickedItem[]; // region일 때만 채움(최대 8)
  url: string;
  viewport: { w: number; h: number; dpr: number };
  tag: string;
  selector: string;
  text: string;
  attrs: Record<string, string>;
  rect: { x: number; y: number; w: number; h: number };
  styles: Record<string, string>;
  html: string;
  framework: PickFramework; // region이면 페이지 단위(Flutter 앱인지)
  components: string[]; // 안쪽 → 바깥 컴포넌트 이름
  sources: SourceLoc[]; // 소스 file:line(#1039) — [요소 자신, 바깥 컴포넌트…], 못 찾으면 []
}

export const PICK_CANCEL = "window.__mustardPickCancel && window.__mustardPickCancel()";

// findSources를 글자 그대로 끼워 넣음(페이지 안에서 돌아야 같은 origin이라 chunk·source map을 CORS 없이 fetch).
export const PICK_SCRIPT = `(() => new Promise((resolve) => {
  const __findSources = (${findSources.toString()});
  if (window.__mustardPickCancel) window.__mustardPickCancel();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;border:2px solid #d4a017;background:rgba(212,160,23,.12);border-radius:3px;pointer-events:none;display:none";
  const tip = document.createElement("div");
  tip.style.cssText = "position:fixed;padding:2px 6px;font:11px ui-monospace,monospace;background:#18181b;color:#fff;border-radius:3px;pointer-events:none;display:none;white-space:nowrap";
  root.append(box, tip);
  document.documentElement.appendChild(host);
  let cur = null;
  // #1287 스택 무관 — 열린 shadow root 안 요소까지 전부(Web Components·Flutter 일부 버전은 shadow 안에 그림).
  const allEls = () => {
    const out = [];
    const walk = (root) => { for (const el of root.querySelectorAll("*")) { if (el === host) continue; out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
    walk(document);
    return out;
  };
  // Flutter 웹은 화면을 canvas 하나에 그려서 위젯마다 HTML 요소가 없음 → 화면 읽기용 접근성 트리(flt-semantics)를 켜면
  // 위젯마다 위치·라벨 가진 투명 요소가 생김. 스위치는 "Enable accessibility" placeholder 클릭(아래 click 리스너 걸기 전에).
  // 한계: 접근성 모드는 새로고침 전까지 켜진 채(끄는 공식 방법 없음), 라벨 = 화면 글자라 위젯 이름·Dart 소스 줄은 없음.
  const flutterA11y = allEls().find((el) => el.tagName === "FLT-SEMANTICS-PLACEHOLDER");
  if (flutterA11y) try { flutterA11y.click(); } catch {}
  const isFlt = (el) => el.tagName.startsWith("FLT-") || el.tagName === "FLUTTER-VIEW";
  // 접근성 요소(flt-semantics·-container·-img…) — 스위치(placeholder)·담는 틀(host)은 빼고.
  const isSem = (el) => el.tagName.startsWith("FLT-SEMANTICS") && el.tagName !== "FLT-SEMANTICS-PLACEHOLDER" && el.tagName !== "FLT-SEMANTICS-HOST";
  // canvas로 그린 자리 — canvas 자체이거나 Flutter 껍데기. 여기선 elementFromPoint가 큰 껍데기만 줌.
  const isPainted = (el) => el.tagName === "CANVAS" || (isFlt(el) && !isSem(el));
  // 접근성 요소 + 사각형 — 움직일 때마다 문서 전체를 훑고 크기를 재지 않게 잠깐(300ms) 재사용(스크롤로 바뀌니 오래는 안 둠).
  let semCache = null;
  const semRects = () => {
    if (!semCache || performance.now() - semCache.t > 300) semCache = { t: performance.now(), list: allEls().filter(isSem).map((el) => ({ el, b: el.getBoundingClientRect() })) };
    return semCache.list;
  };
  // 마우스 아래 요소 — shadow host에서 멈추지 않게 안으로 내려가고, Flutter 화면이면 그 점을 덮는 가장 작은 접근성 요소를 사각형으로 찾음
  // (접근성 요소는 pointer-events:none이라 elementFromPoint에 안 잡힘). 못 찾으면 껍데기 그대로. 일반 canvas(차트·지도)는 그대로 canvas.
  // 한계: 사각형만 봐서 겹친 순서·잘림(모달 뒤, 스크롤 밖으로 잘린 목록 항목)은 모름 — 접근성 트리는 보통 보이는 것만 두지만 예외 가능.
  const pickAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    if (!el || !isFlt(el) || isSem(el)) return el;
    const hb = el.getBoundingClientRect();
    let best = null, bestArea = hb.width * hb.height; // 껍데기보다 작은 것만 — 빈 자리는 껍데기(body 같은 조상 말고)
    for (const { el: c, b } of semRects()) {
      const a = b.width * b.height;
      if (a > 0 && a < bestArea && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) { best = c; bestArea = a; }
    }
    return best || el;
  };
  const role = (el) => el.getAttribute("role") || "";
  const label = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "") + (role(el) ? "[" + role(el) + "]" : "") + (isFlt(el) && textOf(el) ? ' "' + textOf(el).slice(0, 30) + '"' : "");
  const move = (e) => {
    if (down && e.buttons === 0) { down = null; dragging = false; } // 놓는 걸 놓쳤으면(창 밖) 드래그 해제
    if (down && (dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)) {
      dragging = true;
      const r = regionRect(e);
      Object.assign(box.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
      tip.textContent = Math.round(r.w) + "×" + Math.round(r.h);
      Object.assign(tip.style, { display: "block", left: r.x + "px", top: (r.y > 22 ? r.y - 20 : r.y + r.h + 4) + "px" });
      return;
    }
    const el = pickAt(e.clientX, e.clientY);
    if (!el || el === host) return;
    cur = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tip.textContent = label(el) + "  " + Math.round(r.width) + "×" + Math.round(r.height);
    Object.assign(tip.style, { display: "block", left: Math.max(0, r.left) + "px", top: (r.top > 22 ? r.top - 20 : r.bottom + 4) + "px" });
  };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  // 드래그 = 영역 지정(6px 넘게 끌면). 그냥 클릭 = 요소 하나.
  let down = null, dragging = false;
  const onDown = (e) => {
    stop(e);
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY }; dragging = false;
    try { document.documentElement.setPointerCapture(e.pointerId); } catch {} // 창 밖에서 놓아도 pointerup 받음
  };
  const regionRect = (e) => ({ x: Math.min(down.x, e.clientX), y: Math.min(down.y, e.clientY), w: Math.abs(e.clientX - down.x), h: Math.abs(e.clientY - down.y) });
  const onUp = (e) => {
    stop(e);
    if (!down) return;
    if (!dragging) { down = null; return; } // 클릭은 click 핸들러가 처리
    const r = regionRect(e);
    down = null;
    // 드래그 끝의 mouseup 뒤에 click이 한 번 더 옴 — 리스너를 다 걷으면 그 click이 페이지 버튼을 눌러버림 → 한 번만 더 삼킴.
    const swallow = (ev) => { stop(ev); window.removeEventListener("click", swallow, true); };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 400);
    cleanup();
    resolve(regionResult(r));
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", onUp, true);
    for (const t of ["mousedown", "mouseup"]) window.removeEventListener(t, stop, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", key, true);
    host.remove();
    delete window.__mustardPickCancel;
  };
  const selectorOf = (el) => {
    // shadow root 안이면 그 안에서 고유한지 보고, 앞에 host 선택자 + " >>> "(경계 표시 — document.querySelector로는 바로 못 찾음).
    const root = el.getRootNode();
    const pre = root !== document && root.host ? selectorOf(root.host) + " >>> " : "";
    const scope = pre ? root : document;
    const uniq = (id) => scope.querySelectorAll("#" + CSS.escape(id)).length === 1;
    if (el.id && uniq(el.id)) return pre + "#" + CSS.escape(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && uniq(n.id)) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
      parts.unshift(p);
    }
    return pre + parts.join(" > ");
  };
  // 컴포넌트 이름(안쪽 → 바깥, 최대 6) — 틀마다 요소에 남기는 내부 값이 다름. Vue·Svelte·Angular는 개발 모드에서만 남김.
  // 한계: Svelte는 컴포넌트 = 파일이라 파일 이름만(줄 번호는 버전마다 0/1 기준이 달라 안 씀), 그 밖의 틀(Solid·Lit 등)은 이름 없음.
  const compOf = (el) => {
    const out = [];
    const add = (n) => { if (n && !out.includes(n) && out.length < 6) out.push(n); };
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$"));
    if (k) {
      for (let f = el[k]; f && out.length < 6; f = f.return) {
        const t = f.type;
        add(typeof t === "function" ? (t.displayName || t.name) : (t && typeof t === "object" && (t.displayName || (t.render && (t.render.displayName || t.render.name)))) || "");
      }
      return { framework: "react", names: out };
    }
    const fileName = (f) => String(f || "").split("/").pop().replace(/\\.(vue|svelte)$/, "");
    let n = el;
    while (n && !n.__vueParentComponent && !n.__vue__ && !n.__svelte_meta) n = n.parentElement; // 요소 자신엔 안 붙는 경우가 있어 조상까지
    if (n && n.__vueParentComponent) { // Vue 3
      for (let i = n.__vueParentComponent; i; i = i.parent) add(i.type && (i.type.name || i.type.__name || fileName(i.type.__file)));
      return { framework: "vue", names: out };
    }
    if (n && n.__vue__) { // Vue 2
      for (let v = n.__vue__; v; v = v.$parent) add(v.$options && (v.$options.name || v.$options._componentTag || fileName(v.$options.__file)));
      return { framework: "vue", names: out };
    }
    if (n) { // Svelte — 조상들의 파일 이름
      for (let m = n; m; m = m.parentElement) if (m.__svelte_meta && m.__svelte_meta.loc) add(fileName(m.__svelte_meta.loc.file));
      return { framework: "svelte", names: out };
    }
    const ng = window.ng;
    if (ng && ng.getOwningComponent) { // Angular
      try {
        for (let c = ng.getComponent(el) || ng.getOwningComponent(el), i = 0; c && i < 20 && out.length < 6; c = ng.getOwningComponent(ng.getHostElement(c)), i++) add(c.constructor && c.constructor.name.replace(/^_/, ""));
      } catch {}
      if (out.length) return { framework: "angular", names: out };
    }
    return { framework: isFlt(el) ? "flutter" : el.tagName === "CANVAS" ? "canvas" : "", names: out }; // Flutter 빈 자리(flutter-view)도 flutter — 글에서 태그로 나눔
  };
  const base = () => ({ url: location.href, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } });
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim(); // aria-label = Flutter 접근성 요소의 글자
  // 영역 안에 완전히 들어간 요소 중 바깥쪽(부모는 영역에 안 들어감)만, 보이는 것, 최대 8개.
  const regionResult = (r) => {
    const inside = (b) => b.width > 0 && b.height > 0 && b.left >= r.x - 1 && b.top >= r.y - 1 && b.right <= r.x + r.w + 1 && b.bottom <= r.y + r.h + 1;
    const items = [];
    for (const el of allEls()) {
      if (items.length >= 8) break;
      if (["HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName) || isPainted(el)) continue;
      if (isSem(el) && !textOf(el) && !role(el)) continue; // 라벨 없는 접근성 묶음 = 위치 단서 아님
      if (!inside(el.getBoundingClientRect())) continue;
      const p = el.parentElement || (el.getRootNode().host ?? null); // shadow 맨 위 요소의 부모 = host
      if (p && p !== document.body && inside(p.getBoundingClientRect())) continue;
      items.push({ tag: el.tagName.toLowerCase(), selector: selectorOf(el), text: textOf(el).slice(0, 120), components: compOf(el).names.slice(0, 3) });
    }
    return { kind: "region", items, ...base(), tag: "region", selector: "", text: "", attrs: {}, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, styles: {}, html: "", framework: allEls().some((e) => e.tagName === "FLUTTER-VIEW") ? "flutter" : "", components: [], sources: [] };
  };
  const click = (e) => {
    stop(e);
    if (dragging) return;
    const el = cur;
    cleanup();
    if (!el) return resolve(null);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const attrs = {};
    for (const a of ["id", "class", "role", "aria-label", "href", "name", "type", "placeholder", "alt", "data-testid"]) { const v = el.getAttribute(a); if (v) attrs[a] = v.slice(0, 200); }
    const styles = {};
    for (const s of ["display", "position", "color", "background-color", "font-size", "font-weight", "line-height", "padding", "margin", "border", "border-radius", "gap", "width", "height"]) styles[s] = cs.getPropertyValue(s);
    const comp = compOf(el);
    const data = {
      kind: "element",
      items: [],
      ...base(),
      tag: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      text: textOf(el).slice(0, 300),
      attrs,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles,
      html: el.outerHTML.slice(0, 1500),
      framework: comp.framework,
      components: comp.names,
    };
    // 소스 위치는 chunk·map을 받아야 해서 시간이 걸릴 수 있음 → 3초 넘으면 없이 보냄(#1039, Metro 같은 큰 단일 맵 대비 #1047).
    const fetchText = (u) => fetch(u).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    const timeout = new Promise((r) => setTimeout(() => r([]), 3000));
    Promise.race([__findSources(el, fetchText), timeout]).catch(() => []).then((sources) => resolve({ ...data, sources: sources || [] }));
  };
  const key = (e) => { if (e.key === "Escape") { stop(e); cleanup(); resolve(null); } };
  window.__mustardPickCancel = () => { cleanup(); resolve(null); };
  // 포인터 이벤트로 받음(#1037 리뷰) — pointerdown을 preventDefault하면 Chromium이 뒤따르는 mousedown/mousemove/mouseup을
  // 안 보내서 마우스 이벤트로는 드래그가 시작조차 안 됨. mousedown/up은 페이지로 안 가게 막기만.
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", onUp, true);
  for (const t of ["mousedown", "mouseup"]) window.addEventListener(t, stop, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
}))()`;
