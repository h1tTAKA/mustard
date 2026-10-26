// 캐치업 내레이션 중복 방지(#1019 → #1031) — "이미 본 텍스트"면 해설 대상에서 뺀다.
// #1019: 탭 클릭·재시작 resize로 TUI가 옛 화면을 다시 그리는 것 → 공백 제거 말뭉치에 부분문자열로 있으면 버림(줄바꿈 위치가 바뀌어도 인식).
// #1031: 탭 닫고 `claude --resume`이 예전 대화를 다시 찍는 것 → 상태를 레포별·디스크 저장으로(main), 그리고 말뭉치 꼬리(250k)에서
//        밀려난 오래된 줄도 잡게 정규화 줄 해시 집합(최근 HASH_CAP개)을 같이 둔다(resume은 보통 같은 폭이라 줄이 같음).
// 한계: 짧고 흔한 줄("}" 등)은 새 줄이어도 버려질 수 있음 — 해설 기준(150자)엔 영향 미미.
const CAP = 250_000;
const HASH_CAP = 20_000;

const norm = (line) => String(line).replace(/\s+/g, "");
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// 상태 = { corpus: string(공백 제거 줄들 "\n" 연결, 꼬리 CAP), hashes: string[](삽입 순, 꼬리 HASH_CAP) }. 순수 — 새 상태를 반환.
function emptyState() { return { corpus: "", hashes: [] }; }

function has(state, n, hashSet) { return state.corpus.includes(n) || hashSet.has(hash(n)); }

// 본 텍스트를 상태에 추가(이미 있는 줄은 다시 안 넣음).
function seen(state, text) {
  const s = state || emptyState();
  const hs = new Set(s.hashes);
  const add = [];
  const addSet = new Set();
  const addH = [];
  for (const n of String(text || "").split("\n").map(norm)) {
    if (!n || addSet.has(n) || has(s, n, hs)) continue;
    add.push(n); addSet.add(n);
    const h = hash(n); hs.add(h); addH.push(h);
  }
  if (!add.length) return s;
  const corpus = (s.corpus ? s.corpus + "\n" : "") + add.join("\n");
  const hashes = [...s.hashes, ...addH];
  return { corpus: corpus.length > CAP ? corpus.slice(-CAP) : corpus, hashes: hashes.length > HASH_CAP ? hashes.slice(-HASH_CAP) : hashes };
}

// 델타에서 처음 보는 줄만 남김. { fresh, state } — state엔 이번 델타 전체를 반영.
function freshLines(state, text) {
  const s = state || emptyState();
  const hs = new Set(s.hashes);
  const fresh = String(text || "").split("\n").filter((l) => { const n = norm(l); return n && !has(s, n, hs); }).join("\n");
  return { fresh, state: seen(s, text) };
}

module.exports = { emptyState, seen, freshLines, CAP, HASH_CAP };
