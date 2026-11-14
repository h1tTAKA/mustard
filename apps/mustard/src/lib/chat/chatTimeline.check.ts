// chatTimeline 점검 — node --experimental-strip-types src/lib/chat/chatTimeline.check.ts
import assert from "node:assert";
import { applyEvent, extractImages, itemsFromClaudeTranscript, type Timeline } from "./chatTimeline.ts";

const saved: string[] = [];
const save = (b64: string, mime: string) => { saved.push(`${mime}:${b64.length}`); return `img${saved.length}`; };
const t: Timeline = { items: [], streaming: "", busy: true };
const ev = (e: Record<string, unknown>) => applyEvent(t, e, save);

// 글 조각 → 도구가 끼어들면 굳힘 → assistant 전체 글이 그 자리를 덮음(중복 없음)
ev({ type: "assistant_delta", delta: "파일을 " }); ev({ type: "assistant_delta", delta: "읽을게요" });
assert.strictEqual(t.streaming, "파일을 읽을게요");
ev({ type: "tool_use", message: "Read", data: { toolName: "Read", id: "t1", input: null, streaming: true } });
assert.deepStrictEqual(t.items.map((i) => i.k), ["text", "tool"]);
assert.strictEqual(t.streaming, "");
ev({ type: "tool_use", data: { toolName: "Read", id: "t1", input: { file_path: "/a.txt" }, update: true } });
ev({ type: "assistant", message: "파일을 읽을게요." });
assert.deepStrictEqual(t.items.map((i) => i.k), ["text", "tool"], "assistant가 굳힌 글을 덮음");
assert.deepStrictEqual(t.items[0], { k: "text", text: "파일을 읽을게요." });
const tool = t.items[1];
assert.ok(tool.k === "tool" && tool.input === '{"file_path":"/a.txt"}');
// 결과 — 스크린샷(MCP 꼴) 떼어 냄
const png = "A".repeat(200);
ev({ type: "tool_result", message: JSON.stringify([{ type: "text", text: "찍음" }, { type: "image", data: png, mimeType: "image/jpeg" }]), data: { toolUseId: "t1" } });
const r = t.items[1];
assert.ok(r.k === "tool" && r.result === "찍음" && r.images?.[0] === "img1" && !r.error);
assert.deepStrictEqual(saved, ["image/jpeg:200"]);
// 다음 답 → 완료
ev({ type: "assistant_delta", delta: "끝" }); ev({ type: "assistant", message: "끝났어요" });
ev({ type: "complete", message: "끝났어요", data: { inputTokens: 3, outputTokens: 5, costUsd: 0.01, durationMs: 900 } });
assert.deepStrictEqual(t.items.map((i) => i.k), ["text", "tool", "text", "done"]);
assert.strictEqual(t.busy, false);
// 오류 결과·모르는 도구 결과는 무시
ev({ type: "tool_use", data: { toolName: "Bash", id: "t2" } });
ev({ type: "tool_result", message: "denied", data: { toolUseId: "t2", isError: true } });
ev({ type: "tool_result", message: "x", data: { toolUseId: "nope" } });
const b = t.items.at(-1)!;
assert.ok(b.k === "tool" && b.error === true && b.result === "denied");
// 멈춤 — 흘러오던 글은 남기고 멈춤 표시
ev({ type: "assistant_delta", delta: "하던 말" }); ev({ type: "interrupted" });
assert.deepStrictEqual(t.items.slice(-2).map((i) => i.k), ["text", "stopped"]);
// 오류 메시지가 data 안에만 있어도
ev({ type: "error", message: "", data: { error: { message: "login needed" } } });
assert.deepStrictEqual(t.items.at(-1), { k: "error", text: "login needed" });

// 이미지 추출 — Anthropic 꼴·글 속 data URL·평문
const a = extractImages(JSON.stringify({ content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }] }));
assert.deepStrictEqual(a.images, [{ base64: "QUJD", mime: "image/png" }]);
const d = extractImages(`shot: data:image/png;base64,${"B".repeat(120)} done`);
assert.strictEqual(d.text, "shot: [image] done"); assert.strictEqual(d.images.length, 1);
assert.deepStrictEqual(extractImages("plain {not json"), { text: "plain {not json", images: [] });
// 컨텍스트 사용량 — 입력 + 캐시 읽기·쓰기
const t2: Timeline = { items: [], streaming: "", busy: true };
applyEvent(t2, { type: "complete", data: { inputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 90, contextWindow: 200000 } }, save);
assert.deepStrictEqual([(t2.items[0] as { ctx?: number }).ctx, (t2.items[0] as { win?: number }).win], [1100, 200000]);

// CLI 기록 가져오기 — 사람 말·답·도구·결과, 시스템 줄·사이드체인 뺌
const L = (o: unknown) => JSON.stringify(o);
const tr = itemsFromClaudeTranscript([
  L({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
  L({ type: "user", message: { content: "a.txt 읽어줘" } }),
  L({ type: "assistant", message: { content: [{ type: "text", text: "읽을게요" }, { type: "tool_use", id: "u1", name: "Read", input: { file_path: "a.txt" } }] } }),
  L({ type: "assistant", isSidechain: true, message: { content: "서브" } }),
  L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: [{ type: "text", text: "hello" }] }] } }),
  "{broken",
  L({ type: "assistant", message: { content: [{ type: "text", text: "hello 래요" }] } }),
], save);
assert.deepStrictEqual(tr.map((i) => i.k), ["user", "text", "tool", "text"]);
const rt = tr[2]; assert.ok(rt.k === "tool" && rt.result === "hello" && rt.input === '{"file_path":"a.txt"}');
console.log("chatTimeline.check ok");
