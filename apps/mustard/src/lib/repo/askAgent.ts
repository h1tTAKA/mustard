"use client";
// 에이전트 한 번 묻기(#743 → #1322 공용) — /api/agent/analyze chat 모드 스트림에서 result.summary만. 흐름 패널·그래프 노드 설명이 같이 씀.
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";

type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

export async function askAgent(providerId: AgentProviderKind, providerSettings: ProviderSettings, locale: string, ctx: string, prompt: string): Promise<{ text: string; err?: string }> {
  const res = await fetch("/api/agent/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
  });
  if (!res.ok || !res.body) return { text: "", err: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answer = "", streamErr = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const ls = buf.split("\n"); buf = ls.pop() ?? "";
    for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; }
  }
  return streamErr ? { text: "", err: streamErr } : { text: answer };
}
