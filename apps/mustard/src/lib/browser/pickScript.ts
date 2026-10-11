// 인앱 브라우저 요소 선택(#1037) — webview.executeJavaScript로 페이지 안에 주입하는 스크립트.
// 페이지 쪽 코드라 import·클로저 없이 문자열 하나. 결과는 Promise: 클릭 → PickedElement, Esc/취소 → null.
// 오버레이는 shadow root 안(페이지 CSS와 안 섞임). 클릭은 capture 단계에서 막아 페이지 버튼이 눌리지 않게.

export interface PickedElement {
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
}

export const PICK_CANCEL = "window.__mustardPickCancel && window.__mustardPickCancel()";

export const PICK_SCRIPT = `(() => new Promise((resolve) => {
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
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    cur = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tip.textContent = label(el) + "  " + Math.round(r.width) + "×" + Math.round(r.height);
    Object.assign(tip.style, { display: "block", left: Math.max(0, r.left) + "px", top: (r.top > 22 ? r.top - 20 : r.bottom + 4) + "px" });
  };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const cleanup = () => {
    window.removeEventListener("mousemove", move, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) window.removeEventListener(t, stop, true);
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
  const click = (e) => {
    stop(e);
    const el = cur;
    cleanup();
    if (!el) return resolve(null);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const attrs = {};
    for (const a of ["id", "class", "role", "aria-label", "href", "name", "type", "placeholder", "alt", "data-testid"]) { const v = el.getAttribute(a); if (v) attrs[a] = v.slice(0, 200); }
    const styles = {};
    for (const s of ["display", "position", "color", "background-color", "font-size", "font-weight", "line-height", "padding", "margin", "border", "border-radius", "gap", "width", "height"]) styles[s] = cs.getPropertyValue(s);
    resolve({
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      tag: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
      attrs,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles,
      html: el.outerHTML.slice(0, 1500),
      react: reactOf(el),
    });
  };
  const key = (e) => { if (e.key === "Escape") { stop(e); cleanup(); resolve(null); } };
  window.__mustardPickCancel = () => { cleanup(); resolve(null); };
  window.addEventListener("mousemove", move, true);
  for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) window.addEventListener(t, stop, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
}))()`;
