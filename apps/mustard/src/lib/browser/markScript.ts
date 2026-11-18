// #1361 담은 곳 번호 표시 — webview.executeJavaScript로 페이지에 주입. 페이지 쪽 코드라 문자열 하나(import·클로저 X).
// shadow root 안 fixed 레이어(페이지 CSS와 안 섞임), pointer-events:none(페이지 클릭·요소 고르기를 안 막음).
// 위치 = 선택자로 다시 찾은 요소의 왼쪽 위. 못 찾거나 크기가 0이면(영역·사라진·숨은 요소) 고른 순간의 페이지 좌표(rect + 그때 스크롤)로.
// 다시 재는 때 = 스크롤(안쪽 스크롤 칸 이벤트 포함)·창 크기 변화 + 0.5초마다(스크롤 없이 화면이 바뀐 경우). 매 프레임 재지 않음(큰 페이지에서 스크롤 끊김, 리뷰).
// 같은 스크립트를 다시 넣으면 목록만 바꿈(레이어·이벤트는 하나). 빈 목록이면 레이어·이벤트째 지움.
// 한계: scroll이 없는 옛 항목은 처음 본 순간의 스크롤로 가늠. 페이지 좌표라 안쪽 스크롤 칸 속 영역(선택자 없음)은 그 칸이 스크롤되면 원이 내용에서 떨어짐
// (선택자로 다시 찾는 요소는 안쪽 스크롤도 따라감).
export interface Mark { id: number; n: number; selector: string; rect: { x: number; y: number }; scroll?: { x: number; y: number } }

export function markScript(marks: Mark[]): string {
  return `(() => {
  const marks = ${JSON.stringify(marks)};
  const S = window.__mustardMarks || (window.__mustardMarks = { anchors: {}, host: null, raf: 0, timer: 0, marks: [] });
  S.marks = marks;
  const stop = () => { removeEventListener("scroll", S.onScroll, true); removeEventListener("resize", S.onScroll); clearInterval(S.timer); cancelAnimationFrame(S.raf); S.timer = 0; S.raf = 0; };
  if (!marks.length) { if (S.host) S.host.remove(); S.host = null; if (S.onScroll) stop(); return; }
  if (!S.host || !S.host.isConnected) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    S.root = host.attachShadow({ mode: "closed" });
    (document.body || document.documentElement).appendChild(host);
    S.host = host; S.dots = {};
  }
  S.place = () => {
    S.raf = 0;
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
      let x, y, r = null;
      try { const el = m.selector ? document.querySelector(m.selector) : null; r = el ? el.getBoundingClientRect() : null; } catch { r = null; }
      if (r && (r.width || r.height)) { x = r.left; y = r.top; } // 크기 0(숨김) = 못 찾은 것으로(리뷰)
      else {
        const a = S.anchors[m.id] || (S.anchors[m.id] = m.scroll ? { x: m.rect.x + m.scroll.x, y: m.rect.y + m.scroll.y } : { x: m.rect.x + scrollX, y: m.rect.y + scrollY });
        x = a.x - scrollX; y = a.y - scrollY;
      }
      const off = y < -10 || y > innerHeight + 10 || x < -10 || x > innerWidth + 10; // 화면 밖이면 숨김(가장자리에 붙이면 엉뚱한 곳을 가리킴)
      d.style.display = off ? "none" : "flex"; // ""로 두면 cssText의 display:flex까지 지워져 숫자가 원 왼쪽 위로 샘(#1378 중 유저 지적)
      d.style.left = Math.max(10, x) + "px"; // 화면 맨 위·왼쪽 끝 요소도 원이 잘리지 않게
      d.style.top = Math.max(10, y) + "px";
    }
    for (const id in S.dots) if (!seen[id]) { S.dots[id].remove(); delete S.dots[id]; }
  };
  if (!S.onScroll) S.onScroll = () => { if (!S.raf) S.raf = requestAnimationFrame(() => S.place()); };
  stop();
  addEventListener("scroll", S.onScroll, { capture: true, passive: true });
  addEventListener("resize", S.onScroll);
  S.timer = setInterval(() => S.place(), 500);
  S.place();
})()`;
}
