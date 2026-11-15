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
  const buf = leftover.length ? Buffer.concat([leftover, b]) : b;
  const n = Math.floor(buf.length / 4);
  leftover = buf.subarray(n * 4);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = buf.readFloatLE(i * 4);
  chunks.push(f); samples += n;
});

let lastLen = 0, gen = 0; // gen = 받아쓰기 세대(새로 시작·취소마다 +1) — 늦게 끝난 옛 디코딩이 새 소리를 건드리지 않게(리뷰)
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
  const langs = model.capabilities.languages ?? [];
  const lang = language && (langs.find((c) => c === language) ?? langs.find((c) => c.startsWith(`${language}-`)));
  const r = await session.run(pcm, { timestamps: "none", ...(lang ? { language: lang } : {}) });
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
  try { return await decoding; } finally { decoding = null; }
}
setInterval(() => {
  if (!active || decoding || samples - decodedAt < RATE * 0.6) return;
  void step(false).then((t) => { if (active && t) send({ type: "partial", text: t }); }).catch((e) => send({ type: "error", message: String(e?.message || e) }));
}, 1200);

process.on("message", async (m) => {
  touch();
  try {
    if (m.type === "load") {
      if (modelPath !== m.modelPath || !model) {
        try { session?.dispose(); model?.dispose(); } catch { /* */ }
        await tc.initialize();
        model = await tc.TranscribeModel.load(m.modelPath);
        session = model.createSession({ nThreads: 4 });
        modelPath = m.modelPath;
      }
      send({ type: "loaded" });
    } else if (m.type === "start") {
      gen++; active = true; committed = ""; chunks = []; samples = 0; decodedAt = 0; leftover = Buffer.alloc(0); language = m.language || "";
    } else if (m.type === "finish") {
      // 끝 — 지금 소리·확정 글을 떼어 내 그것만으로 최종 글(공용 상태는 바로 비움 → 바로 다시 시작해도 안 섞임, 재리뷰)
      active = false; gen++;
      const pcm = windowPcm(), before = committed;
      committed = ""; chunks = []; samples = 0; decodedAt = 0;
      if (decoding) await decoding.catch(() => {});
      const text = await decode(pcm);
      send({ type: "final", text: join2(before, text) });
    } else if (m.type === "cancel") {
      gen++; active = false; committed = ""; chunks = []; samples = 0;
    }
  } catch (e) { active = false; send({ type: "error", message: String(e?.message || e) }); }
});
