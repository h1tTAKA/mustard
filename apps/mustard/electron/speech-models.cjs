// 로컬 음성 모델(#1341) — 받아쓰기 고급 엔진(transcribe-cpp)용 GGUF 모델 목록·받기·지우기. 저장: userData/speech-models/<id>/<파일>.
// 받기: <파일>.partial에 이어받기(Range) → sha256 확인 → 이름 바꿔 완성. 취소 가능. 진행은 onProgress로(main이 창에 뿌림).
// 오류율(%)은 transcribe-cpp 0.4.1·Metal(M4 Max) 공개 측정값 — 영어 LibriSpeech 73클립 WER, 그 밖은 FLEURS 5클립(ko·ja·zh는 글자 오류율). 우리가 직접 잰 값 아님.
// 리비전·sha256 고정(같은 파일만 받음). 한계: 새 모델·새 리비전은 여기 갱신.
const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } = require("node:fs");
const { join } = require("node:path");

const HF = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${encodeURIComponent(file)}?download=true`;
const CATALOG = [
  { id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo", repo: "handy-computer/whisper-large-v3-turbo-gguf", rev: "5eaf945c7978e564bae5b28a5b1639dd93c2bfb1", file: "whisper-large-v3-turbo-Q8_0.gguf", size: 886381760, sha256: "b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183", errors: { ko: 2.6, ja: 7.4, en: 4.5, zh: 9.4, de: 1.1, es: 1.7, fr: 5.3, ru: 3.4 }, recommended: ["ko", "ja", "zh", "de", "es", "fr", "ru"], licence: "MIT" },
  { id: "parakeet-tdt-0.6b-v2", label: "Parakeet TDT v2", repo: "handy-computer/parakeet-tdt-0.6b-v2-gguf", rev: "07cee0616125a08ef619729bb47f40ef747e4bc4", file: "parakeet-tdt-0.6b-v2-Q8_0.gguf", size: 729574912, sha256: "f0d0e99cebb6d3b83f1f7069b82b5d3c2e39a54545b0da039cb4bafd9c4e5caa", errors: { en: 2.8 }, recommended: ["en"], licence: "CC-BY-4.0" },
  { id: "sense-voice", label: "SenseVoice", repo: "handy-computer/SenseVoiceSmall-gguf", rev: "4a08b8e900b38a977e32eb08d5d0697d6e72ba04", file: "SenseVoiceSmall-Q8_0.gguf", size: 252684608, sha256: "6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29", errors: { en: 6.9, ja: 10.7, ko: 10, zh: 12.9 }, recommended: [], licence: "FunASR Model License" },
  { id: "whisper-tiny", label: "Whisper Tiny", repo: "handy-computer/whisper-tiny-gguf", rev: "6687f30c99641ee265df421e582354adbc8848fc", file: "whisper-tiny-Q8_0.gguf", size: 45981088, sha256: "325b9c7997cd1eff81ef709d55766565e71be696130cc3a3d444713798706834", errors: { en: 13, ko: 24.9, ja: 69.3, zh: 47.5, de: 10, es: 13.6 }, recommended: [], licence: "MIT" },
];

let base = "";
const jobs = new Map(); // id → {ctrl, done, total}
const fileOf = (m) => join(base, m.id, m.file);
function setBase(dir) { base = dir; }
function status() {
  return CATALOG.map((m) => ({ id: m.id, label: m.label, size: m.size, errors: m.errors, recommended: m.recommended, licence: m.licence, installed: !!base && existsSync(fileOf(m)), downloading: jobs.has(m.id) ? { done: jobs.get(m.id).done, total: m.size } : null }));
}
function modelPath(id) { const m = CATALOG.find((x) => x.id === id); return m && base && existsSync(fileOf(m)) ? fileOf(m) : ""; }

async function sha256(file) {
  const h = createHash("sha256");
  await new Promise((res, rej) => createReadStream(file).on("data", (c) => h.update(c)).on("end", res).on("error", rej));
  return h.digest("hex");
}
// 받기 — 이미 받는 중이면 그대로. 끝나면 {ok}·실패 {ok:false,error}
async function download(id, onProgress) {
  const m = CATALOG.find((x) => x.id === id);
  if (!m || !base) return { ok: false, error: "unknown model" };
  if (jobs.has(id)) return { ok: true, already: true };
  const dir = join(base, m.id), part = `${fileOf(m)}.partial`;
  mkdirSync(dir, { recursive: true });
  const job = { ctrl: new AbortController(), done: 0 };
  jobs.set(id, job);
  let last = 0;
  const tick = (force) => { const now = Date.now(); if (force || now - last > 250) { last = now; onProgress?.({ id, done: job.done, total: m.size }); } };
  try {
    for (let attempt = 0; ; attempt++) {
      const have = existsSync(part) ? statSync(part).size : 0;
      job.done = have; tick(true);
      try {
        const res = await fetch(HF(m.repo, m.rev, m.file), { headers: have ? { Range: `bytes=${have}-` } : {}, signal: job.ctrl.signal, redirect: "follow" });
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const append = res.status === 206 && have > 0;
        if (!append) job.done = 0;
        const out = createWriteStream(part, { flags: append ? "a" : "w" });
        for await (const chunk of res.body) { if (!out.write(chunk)) await new Promise((r) => out.once("drain", r)); job.done += chunk.length; tick(false); }
        await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
        break;
      } catch (e) {
        if (job.ctrl.signal.aborted || attempt >= 2) throw e; // 네트워크 끊김은 2번 더(이어받기)
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if ((await sha256(part)) !== m.sha256) { rmSync(part, { force: true }); throw new Error("checksum mismatch"); }
    renameSync(part, fileOf(m));
    tick(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: job.ctrl.signal.aborted ? "cancelled" : String(e?.message || e) };
  } finally { jobs.delete(id); onProgress?.({ id, done: -1, total: m.size }); }
}
function cancel(id) { jobs.get(id)?.ctrl.abort(); }
function remove(id) { const m = CATALOG.find((x) => x.id === id); if (!m || !base) return false; cancel(id); rmSync(join(base, m.id), { recursive: true, force: true }); return true; }

module.exports = { setBase, status, modelPath, download, cancel, remove, CATALOG };
