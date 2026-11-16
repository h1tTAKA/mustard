// #1361 담은 곳 번호 표시 — webview.executeJavaScript로 페이지에 주입. 페이지 쪽 코드라 문자열 하나(import·클로저 X).
// shadow root 안 fixed 레이어(페이지 CSS와 안 섞임), pointer-events:none(페이지 클릭·요소 고르기를 안 막음).
// 위치 = 선택자로 다시 찾은 요소의 왼쪽 위. 못 찾으면(영역·사라진 요소) 처음 본 순간의 페이지 좌표(rect + 그때 스크롤)를 기억해 스크롤만 따라감.
// 같은 스크립트를 다시 넣으면 목록만 바꿈(레이어·루프는 하나). 빈 목록이면 레이어째 지움.
// 한계: 새로고침 뒤 선택자로 못 찾는 항목은 고를 때 rect를 지금 스크롤 기준으로 씀(조금 어긋날 수 있음).
export interface Mark { id: number; n: number; selector: string; rect: { x: number; y: number } }

export function markScript(marks: Mark[]): string {
  return `(() => {
  const marks = ${JSON.stringify(marks)};
  const S = window.__mustardMarks || (window.__mustardMarks = { anchors: {}, host: null, raf: 0, marks: [] });
  S.marks = marks;
  if (!marks.length) { if (S.host) S.host.remove(); S.host = null; cancelAnimationFrame(S.raf); S.raf = 0; return; }
  if (!S.host || !S.host.isConnected) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    S.root = host.attachShadow({ mode: "closed" });
    (document.body || document.documentElement).appendChild(host);
    S.host = host; S.dots = {};
  }
  const place = () => {
    const seen = {};
    for (const m of S.marks) {
      seen[m.id] = 1;
      let d = S.dots[m.id];
      if (!d) {
        d = document.createElement("div");
        d.style.cssText = "position:fixed;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:9999px;border:1.5px solid rgba(255,255,255,.95);background:#d4a017;color:#18181b;font:600 11px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.2);pointer-events:none;user-select:none";
        S.root.appendChild(d); S.dots[m.id] = d;
      }
      d.textContent = String(m.n);
      let x, y, el = null;
      try { el = m.selector ? document.querySelector(m.selector) : null; } catch { el = null; }
      if (el) { const r = el.getBoundingClientRect(); x = r.left; y = r.top; }
      else {
        const a = S.anchors[m.id] || (S.anchors[m.id] = { x: m.rect.x + scrollX, y: m.rect.y + scrollY });
        x = a.x - scrollX; y = a.y - scrollY;
      }
      const off = y < -10 || y > innerHeight + 10 || x < -10 || x > innerWidth + 10; // 화면 밖이면 숨김(가장자리에 붙이면 엉뚱한 곳을 가리킴)
      d.style.display = off ? "none" : "";
      d.style.left = Math.max(10, x) + "px"; // 화면 맨 위·왼쪽 끝 요소도 원이 잘리지 않게
      d.style.top = Math.max(10, y) + "px";
    }
    for (const id in S.dots) if (!seen[id]) { S.dots[id].remove(); delete S.dots[id]; }
    S.raf = requestAnimationFrame(place);
  };
  cancelAnimationFrame(S.raf);
  place();
})()`;
}
