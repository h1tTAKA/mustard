// #1388 소속이 아직 없는 토큰 카드를 모아 AI에 묻고 저장(키 이름은 core cardEco·bookmarkDetails와 같음 — node 점검 가능하게 직접 읽고 씀).
// 답 빠진 카드는 비워 둠(다음에 다시, 두 번 빠지면 ""), "" = 물어봤는데 모름(다시 안 물음). 반환: 새로 저장한 수.
type Store = Pick<Storage, "getItem" | "setItem">;
const TOKENS = "nunopi:bookmark-token-details", ECO = "nunopi:card-eco", MISS = "nunopi:card-eco-miss"; // MISS = 답이 빠진 횟수 — 두 번 빠지면 ""(모름)로 그만 물음(리뷰)
const read = <T,>(s: Store, k: string, d: T): T => { try { const v = s.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };

export async function fillCardEco(s: Store, ask: (items: { name: string; def: string }[]) => Promise<(string | null | undefined)[]>, max = 60): Promise<number> {
  const tokens = read<Record<string, { token?: unknown; description?: unknown }>>(s, TOKENS, {});
  const eco0 = read<Record<string, string>>(s, ECO, {});
  const todo = Object.values(tokens).map((t) => String(t.token ?? "")).filter((n) => n && !(`token:${n}` in eco0)).slice(0, max);
  if (!todo.length) return 0;
  const ans = await ask(todo.map((n) => { const t = Object.values(tokens).find((x) => x.token === n); return { name: n, def: String(t?.description ?? "") }; }));
  const eco = read<Record<string, string>>(s, ECO, {}); // 묻는 사이 바뀌었을 수 있어 다시 읽고 합침
  const miss = read<Record<string, number>>(s, MISS, {});
  let n = 0;
  todo.forEach((name, i) => {
    const k = `token:${name}`, a = ans[i];
    if (k in eco) return;
    if (typeof a === "string") { eco[k] = a; delete miss[k]; n++; }
    else if ((miss[k] = (miss[k] ?? 0) + 1) >= 2) { eco[k] = ""; delete miss[k]; n++; }
  });
  if (n) s.setItem(ECO, JSON.stringify(eco));
  s.setItem(MISS, JSON.stringify(miss));
  return n;
}
