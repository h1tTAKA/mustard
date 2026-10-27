// 업데이트 확인(#1200) — GitHub 최신 릴리스 태그와 앱 버전 비교. 다운로드·설치는 배포 채널이 생기면(지금은 릴리스 페이지 링크만).
// 릴리스가 없으면(404) 최신으로 봄.

// "v1.2.3" / "1.2.3-beta.1" → [1,2,3] + 사전 릴리스 여부. 숫자가 아니면 null.
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(String(v || "").trim());
  return m ? { n: [+m[1], +m[2], +m[3]], pre: !!m[4] } : null;
}
// b가 a보다 새 버전인가 — 같은 숫자면 정식이 사전 릴리스보다 새것
function isNewer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return y.n[i] > x.n[i];
  return x.pre && !y.pre;
}

async function check(current, repo, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return { ok: true, current, latest: null, newer: false, url: null };
  if (!r.ok) return { ok: false, current, reason: `HTTP ${r.status}` };
  const j = await r.json();
  const latest = typeof j?.tag_name === "string" ? j.tag_name.replace(/^v/, "") : null;
  const url = typeof j?.html_url === "string" && j.html_url.startsWith(`https://github.com/${repo}/`) ? j.html_url : null; // 우리 저장소 주소만
  return { ok: true, current, latest, newer: !!latest && isNewer(current, latest), url };
}

module.exports = { parse, isNewer, check };
