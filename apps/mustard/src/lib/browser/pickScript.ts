import { findSources, type SourceLoc } from "./sourceLookup.ts"; // .ts — check 스크립트(node)에서도 풀리게

// 인앱 브라우저 요소 선택(#1037) — webview.executeJavaScript로 페이지 안에 주입하는 스크립트.
// 페이지 쪽 코드라 import·클로저 없이 문자열 하나. 결과는 Promise: 클릭 → PickedElement, Esc/취소 → null.
// 오버레이는 shadow root 안(페이지 CSS와 안 섞임). 클릭은 capture 단계에서 막아 페이지 버튼이 눌리지 않게.

// kind: 클릭 = element(요소 하나), 드래그 = region(사각형 영역 — 안에 완전히 들어간 바깥쪽 요소들을 items로).
export interface PickedItem { tag: string; selector: string; text: string; react: string[] }
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
  react: string[]; // 안쪽 → 바깥 컴포넌트 이름
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
  const label = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
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
    const el = document.elementFromPoint(e.clientX, e.clientY);
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
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && document.querySelectorAll("#" + CSS.escape(n.id)).length === 1) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const reactOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$"));
    const out = [];
    for (let f = k ? el[k] : null; f && out.length < 6; f = f.return) {
      const t = f.type;
      const n = typeof t === "function" ? (t.displayName || t.name) : (t && typeof t === "object" && (t.displayName || (t.render && (t.render.displayName || t.render.name)))) || "";
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  };
  const base = () => ({ url: location.href, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } });
  const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  // 영역 안에 완전히 들어간 요소 중 바깥쪽(부모는 영역에 안 들어감)만, 보이는 것, 최대 8개.
  const regionResult = (r) => {
    const inside = (b) => b.width > 0 && b.height > 0 && b.left >= r.x - 1 && b.top >= r.y - 1 && b.right <= r.x + r.w + 1 && b.bottom <= r.y + r.h + 1;
    const items = [];
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      if (items.length >= 8) break;
      if (el === host || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      if (!inside(el.getBoundingClientRect())) continue;
      const p = el.parentElement;
      if (p && p !== document.body && inside(p.getBoundingClientRect())) continue;
      items.push({ tag: el.tagName.toLowerCase(), selector: selectorOf(el), text: textOf(el).slice(0, 120), react: reactOf(el).slice(0, 3) });
    }
    return { kind: "region", items, ...base(), tag: "region", selector: "", text: "", attrs: {}, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, styles: {}, html: "", react: [], sources: [] };
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
      react: reactOf(el),
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
