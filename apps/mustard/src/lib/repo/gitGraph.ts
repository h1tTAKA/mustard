// 깃 커밋 그래프 레인 모델(#649) — 순수 로직. git log 파싱 결과를 DAG 레인(세로줄)으로 배정.
// UI(GitGraph.tsx)는 이 결과로 점·선을 그린다. self-check로 직선·분기·머지·결정성 고정.

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;   // 작성자 이메일(%ae) — GitHub 닉 파싱용(화면엔 원문 미표시)
  ts: number;      // author time (unix seconds)
  refs: string[];  // 브랜치/태그 라벨(정리됨)
  subject: string;
  body: string;    // 커밋 본문(%b) — 여러 줄 가능, 없으면 "". 호버 툴팁용(#685)
  isHead: boolean; // 이 커밋이 HEAD인가(%D에 HEAD 토큰)
}

// GitHub noreply 이메일 → 로그인. "12345+login@users.noreply.github.com" / "login@users.noreply.github.com".
// 아니면 null(호출측서 이름 폴백).
export function githubLogin(email: string): string | null {
  const m = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec((email ?? "").trim());
  return m ? m[1] : null;
}

// git log --pretty=format 출력(필드=\x1f, 커밋=\x1e) → 커밋 배열(최신순).
// 필드: %H \x1f %P \x1f %an \x1f %ae \x1f %at \x1f %D \x1f %s \x1f %b
export function parseGitLog(text: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const rec of text.split("\x1e")) {
    const r = rec.replace(/^[\r\n]+/, ""); // format:가 커밋 사이 넣는 개행 제거(CRLF 포함)
    if (!r.trim()) continue;
    const [hash, parents, author, email, at, decor, subject, ...bodyParts] = r.split("\x1f");
    if (!hash) continue;
    const d = decor ?? "";
    out.push({
      hash,
      parents: (parents ?? "").split(" ").filter(Boolean),
      author: author ?? "",
      email: email ?? "",
      ts: Number(at) || 0,
      refs: parseRefs(d),
      subject: subject ?? "",
      body: bodyParts.join("\x1f").replace(/\s+$/, ""), // %b 뒤 개행 정리(body에 \x1f는 없음)
      isHead: /(^|,)\s*HEAD\b/.test(d), // "HEAD -> main" 또는 detached "HEAD"
    });
  }
  return out;
}

// "%D" (예: "HEAD -> main, origin/main, origin/HEAD, tag: v1") → ["main", "origin/main", "v1"].
// bare "HEAD"·"origin/HEAD"(심볼릭 기본브랜치 포인터)는 잡음이라 제거 — HEAD는 현재 브랜치 배지로 표시.
function parseRefs(decor: string): string[] {
  return decor.split(",").map((s) => s.trim()).filter(Boolean)
    .map((r) => r.replace(/^HEAD -> /, "").replace(/^tag: /, ""))
    .filter((r) => r && !/(^|\/)HEAD$/.test(r));
}

export interface GraphRow {
  commit: GitCommit;
  lane: number;                // 점(dot) 레인
  before: (string | null)[];   // 이 행 진입 시 활성 레인(위 경계) — 각 원소=그 레인이 기다리는 해시
  after: (string | null)[];    // 이 행 이탈 시 활성 레인(아래 경계)
}
export interface GitGraphModel { rows: GraphRow[]; laneCount: number; }

// 커밋 배열(최신순) → 레인 배정. 활성 레인에 "다음에 올 커밋 해시"를 담아 내려가며 배치.
export function assignLanes(commits: GitCommit[]): GitGraphModel {
  const inSet = new Set(commits.map((c) => c.hash)); // 로드된 커밋 집합 — 윈도우(-n) 밖 부모 판별용(#828)
  const lanes: (string | null)[] = []; // 각 레인이 기다리는 커밋 해시
  const rows: GraphRow[] = [];
  const firstNull = () => { const i = lanes.indexOf(null); return i === -1 ? lanes.length : i; };

  for (const c of commits) {
    const before = [...lanes];
    // 점 레인 = 이 커밋을 기다리는 첫 레인. 없으면(브랜치 tip) 빈 레인.
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) { lane = firstNull(); lanes[lane] = c.hash; }
    // 이 커밋을 기다리던 다른 레인들(머지 수렴)은 비운다 — 점 레인 하나로 모임.
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i] === c.hash) lanes[i] = null;

    // 부모 라우팅: 첫 부모는 점 레인이 계속 이어감(부모가 이미 다른 레인에 있어도 "즉시 비우지 않고" 예약 유지 —
    // 수렴은 부모 커밋 행에서 처리). 이래야 서로 다른 브랜치가 같은 레인을 재사용해 겹쳐 그려지지 않는다(#707).
    // 윈도우 밖 부모(-n 한도 초과로 안 실린 커밋)는 레인을 예약하지 않는다 — 영영 안 풀려 "유령 레인"이 되면
    // laneCount만 부풀고 나머지 브랜치를 오른쪽으로 밀며 댕글링 스텁이 생긴다(#828). 렌더러가 짧은 스텁만 표시.
    const [p0, ...rest] = c.parents;
    if (p0 !== undefined && inSet.has(p0)) lanes[lane] = p0;
    else lanes[lane] = null; // 루트 커밋(부모 없음) 또는 윈도우 밖 첫 부모 → 레인 종료
    // 나머지 부모(머지)는 새 레인으로 분기(윈도우 안인 것만).
    for (const p of rest) {
      if (!inSet.has(p)) continue; // 윈도우 밖 머지 부모 → 유령 레인 방지
      if (lanes.indexOf(p) === -1) { const e = firstNull(); lanes[e] = p; }
    }
    // 꼬리 null 정리.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ commit: c, lane, before, after: [...lanes] });
  }
  const laneCount = Math.max(1, ...rows.map((r) => Math.max(r.before.length, r.after.length, r.lane + 1)));
  return { rows, laneCount };
}
