// PR 리뷰 판정 표시 규칙(#1131) — 순수 함수, 점검 reviewVerdict.check.ts
// 작성자별 판정(GitHub 방식, #1131 리뷰) — 가장 최근 승인·변경 요청이 판정(나중 코멘트가 덮지 않음), 그게 철회(DISMISSED)면 판정 없음.
// 판정 없이 본문 있는 코멘트만 있으면 "코멘트". 본문 없는 COMMENTED(줄 댓글 묶음)·PENDING은 뺌.
export function latestReviews(reviews: GhReview[]): GhReview[] {
  const later = (a: GhReview | undefined, b: GhReview) => !a || (b.submittedAt ?? "") >= (a.submittedAt ?? "");
  const dec = new Map<string, GhReview>(), com = new Map<string, GhReview>();
  for (const r of reviews) {
    const k = r.author?.login ?? "";
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED" || r.state === "DISMISSED") { if (later(dec.get(k), r)) dec.set(k, r); }
    else if (r.state === "COMMENTED" && r.body?.trim()) { if (later(com.get(k), r)) com.set(k, r); }
  }
  const out: GhReview[] = [];
  for (const k of new Set([...dec.keys(), ...com.keys()])) {
    const d = dec.get(k);
    const pick = d && d.state !== "DISMISSED" ? d : com.get(k);
    if (pick) out.push(pick);
  }
  return out.sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}
