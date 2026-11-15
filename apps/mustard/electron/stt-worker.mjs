// 받아쓰기 로컬 모델 일꾼(#1341) — main이 ELECTRON_RUN_AS_NODE로 띄움(asar 밖, extraResources). 인자: <transcribe-cpp가 있는 node_modules 폴더>.
// stdin = 16kHz 모노 float32 소리(도우미 --pcm 출력 그대로), IPC = {load,start,finish,cancel} → {loaded,partial,final,error}.
// 말하는 동안 1.2초마다 지금 창을 다시 풀어 중간 글(partial), 창이 25초를 넘으면 그 창을 확정하고 새 창(Whisper 30초 창 한계).
// 15분 동안 안 쓰면 모델을 내리고 끝냄(메모리 반납, 다음 받아쓰기 때 다시 뜸).
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const RATE = 16000, WINDOW = 25 * RATE, IDLE_MS = 15 * 60_000;
const tc = await import(pathToFileURL(join(process.argv[2], "transcribe-cpp", "dist", "index.js")).href);
let model = null, session = null, modelPath = "", language = "";
let active = false, committed = "", chunks = [], samples = 0, decodedAt = 0, decoding = null, leftover = Buffer.alloc(0), idle;
const send = (m) => { try { process.send(m); } catch { /* 부모 없음 */ } };
const touch = () => { clearTimeout(idle); idle = setTimeout(() => { try { session?.dispose(); model?.dispose(); } catch { /* */ } process.exit(0); }, IDLE_MS); };
touch();

process.stdin.on("data", (b) => {
  if (!active) return;
  touch(); // 말하는 동안엔 쉬는 타이머를 늦춤(15분 넘게 말해도 안 끊기게, 재리뷰)
  const buf = leftover.length ? Buffer.concat([leftover, b]) : b;
  const n = Math.floor(buf.length / 4);
  leftover = buf.subarray(n * 4);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = buf.readFloatLE(i * 4);
  chunks.push(f); samples += n;
});

let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
let lastLen = 0, gen = 0, sid = 0; // sid = main이 준 받아쓰기 번호 — 결과에 되돌려 줘서 옛 결과가 새 받아쓰기에 섞이지 않게(재리뷰) // gen = 받아쓰기 세대(새로 시작·취소마다 +1) — 늦게 끝난 옛 디코딩이 새 소리를 건드리지 않게(리뷰)
// 앞에서 n개 샘플을 버림(창 확정 때 — 그 사이 들어온 소리는 다음 창으로)
function dropFront(n) {
  while (n > 0 && chunks.length) { const c = chunks[0]; if (c.length <= n) { chunks.shift(); n -= c.length; samples -= c.length; } else { chunks[0] = c.subarray(n); samples -= n; n = 0; } }
}
const windowPcm = () => { const out = new Float32Array(samples); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
const join2 = (a, b) => (!a ? b : !b ? a : /[぀-ヿ㐀-鿿]$/.test(a) ? a + b : `${a} ${b}`);
async function decode(given) {
  const pcm = given ?? windowPcm();
  if (!given) lastLen = pcm.length;
  if (pcm.length < RATE / 4) return "";
  const lang0 = language;
  // 모델 올리기도 같은 줄(serial)이라 그 뒤에 돎 — 올리기 전에 부르면 순서대로 기다림(재리뷰)
  const r = await serial(() => {
    if (!session) throw new Error("speech model not loaded"); // 조용히 빈 글 대신 화면에 오류
    const langs = model.capabilities.languages ?? [];
    const lang = lang0 && (langs.find((c) => c === lang0) ?? langs.find((c) => c.startsWith(`${lang0}-`)));
    return session.run(pcm, { timestamps: "none", ...(lang ? { language: lang } : {}) });
  }); // 세션 호출은 늘 하나씩(재리뷰: 동시 실행이 계속 새어 나옴)
  return String(r.text ?? "").trim();
}
async function step(final) {
  if (decoding) await decoding;
  const my = gen;
  decoding = (async () => {
    const text = await decode();
    if (my !== gen) return ""; // 그 사이 취소·새 시작 — 버림
    if (final || samples >= WINDOW) { committed = join2(committed, text); dropFront(lastLen); decodedAt = 0; return committed; } // 디코딩 중 들어온 소리는 남김(리뷰)
    decodedAt = samples;
    return join2(committed, text);
  })();
  const mine = decoding;
  try { return await mine; } finally { if (decoding === mine) decoding = null; } // finish가 건 처리를 지우지 않게(재리뷰)
}
setInterval(() => {
  if (!active || !session || decoding || samples - decodedAt < RATE * 0.6) return; // 모델이 올라오기 전엔 중간 글 건너뜀
  const mySid = sid;
  void step(false).then((t) => { if (active && t && mySid === sid) send({ type: "partial", text: t, sid: mySid }); }).catch((e) => send({ type: "error", message: String(e?.message || e), sid: mySid }));
}, 1200);

process.on("message", async (m) => {
  touch();
  try {
    if (m.type === "load") {
      // 올리기도 인식 호출과 같은 줄 — 겹친 load가 모델을 덮어쓰거나 쓰는 중인 세션을 버리지 않게(재리뷰)
      await serial(async () => {
        if (modelPath === m.modelPath && session) return; // 세션까지 살아 있어야 '이미 올라옴'(재리뷰 6차)
        try { session?.dispose(); model?.dispose(); } catch { /* */ }
        session = null; model = null; modelPath = "";
        await tc.initialize();
        model = await tc.TranscribeModel.load(m.modelPath);
        session = model.createSession({ nThreads: 4 });
        modelPath = m.modelPath;
      });
      send({ type: "loaded", sid: m.sid });
    } else if (m.type === "start") {
      gen++; sid = m.sid ?? 0; active = true; committed = ""; chunks = []; samples = 0; decodedAt = 0; leftover = Buffer.alloc(0); language = m.language || "";
    } else if (m.type === "finish") {
      // 끝 — 지금 소리·확정 글을 떼어 내 그것만으로 최종 글(공용 상태는 바로 비움 → 바로 다시 시작해도 안 섞임, 재리뷰)
      active = false; gen++;
      const pcm = windowPcm(), before = committed, mySid = m.sid ?? sid;
      committed = ""; chunks = []; samples = 0; decodedAt = 0;
      const prev = decoding;
      const job = (async () => { if (prev) await prev.catch(() => {}); return decode(pcm); })();
      decoding = job; // 다음 중간 처리는 이걸 기다림(같은 세션을 동시에 부르지 않게, 재리뷰)
      let text = "";
      try { text = await job; } finally { if (decoding === job) decoding = null; }
      send({ type: "final", text: join2(before, text), sid: mySid });
    } else if (m.type === "cancel") {
      gen++; active = false; committed = ""; chunks = []; samples = 0;
    }
  } catch (e) { active = false; send({ type: "error", message: String(e?.message || e), sid: m.sid ?? sid }); }
});
