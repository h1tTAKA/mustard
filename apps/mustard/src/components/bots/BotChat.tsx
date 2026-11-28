"use client";
// 봇 Home Chat(#1401) — 봇 홈 가운데 칸. 채팅 모드의 대화 화면(ChatSession)을 그대로, 대화 폴더(root) = 봇 폴더.
// root가 봇 폴더라 레포 채팅 탭과 안 섞이고, 서버는 시작 때 봇 지시문(정체성·기억·규칙)을 덧붙임.
// Home Chat = 봇 폴더의 열린 대화 중 최근 것. 없으면 봇 설정(실행 AI·모델)으로 하나 만듦. /new = 지금 대화는 기록으로, 새 Home Chat.
import { useCallback, useEffect, useState } from "react";
import { getSetting, useT, CHATKEYS, CHAT_DEFAULTS } from "@mustard/core";
import ChatSession from "@/components/workspace/ChatSession";
import { PROVIDERS, post, type AppCommand, type Meta } from "@/components/workspace/ChatComposer";
import type { Bot } from "./useBots";

// 같은 봇 폴더를 동시에 열면(개발 모드 이펙트 두 번·빠른 봇 전환) 대화가 둘 생기지 않게 진행 중인 열기를 같이 씀
const opening = new Map<string, Promise<Meta | null>>();
async function openHome(bot: Bot, fresh: boolean): Promise<Meta | null> {
  const root = bot.home;
  if (!fresh) {
    const r = await fetch(`/api/chat/sessions?root=${encodeURIComponent(root)}`).then((x) => x.json()).catch(() => null);
    if (!r?.ok) return null;
    const open = (r.chats as Meta[]).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (open) return open;
  }
  const c = await post("/api/chat/sessions", { root, op: "create", provider: bot.provider, ...(bot.model ? { model: bot.model } : {}), mode: getSetting(CHATKEYS.newChatMode, CHAT_DEFAULTS.newChatMode) });
  return c?.ok ? (c.chat as Meta) : null;
}
const openOnce = (bot: Bot, fresh = false) => {
  let p = opening.get(bot.home);
  if (!p) { p = openHome(bot, fresh).finally(() => opening.delete(bot.home)); opening.set(bot.home, p); }
  return p;
};

export default function BotChat({ bot }: { bot: Bot }) {
  const t = useT();
  const [chat, setChat] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback((fresh = false) => {
    setFailed(false);
    return openOnce(bot, fresh).then((m) => { if (m) setChat(m); else setFailed(true); });
  }, [bot]);
  useEffect(() => {
    let alive = true;
    void openOnce(bot).then((m) => { if (!alive) return; if (m) setChat(m); else setFailed(true); });
    return () => { alive = false; };
  }, [bot.home]); // eslint-disable-line react-hooks/exhaustive-deps -- 봇이 바뀔 때만(목록 다시 읽기로 bot 객체가 새로 와도 다시 열지 않음)

  const appCommand = (c: AppCommand) => {
    if (c !== "new" || !chat) return; // 기록·터미널은 봇 홈에 없음(대화 기록 탭은 H7)
    const old = chat;
    setChat(null);
    // 새로 만든 뒤 옛 대화를 닫음(보관 = 기록에 남음) — 먼저 닫으면 실패했을 때 빈 화면만 남음
    void openOnce(bot, true).then((m) => { if (m) { setChat(m); void post("/api/chat/sessions", { root: bot.home, op: "close", id: old.id }); } else { setChat(old); setFailed(true); } });
  };

  if (failed && !chat) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{t("bots.chat.failed")}</p>
      <button type="button" onClick={() => void load()} className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-mustard-700 hover:bg-mustard-500/10 dark:text-mustard-300">{t("bots.retry")}</button>
    </div>
  );
  if (!chat) return <div className="flex-1" />; // 여는 중 — 깜빡임 없게 빈 칸
  return (
    <div className="relative min-h-0 flex-1 bg-white dark:bg-[var(--s-pane)]">
      <ChatSession key={chat.id} root={bot.home} meta={chat} providers={PROVIDERS} onMeta={(m) => setChat((c) => (c && c.id === chat.id ? { ...c, ...m } : c))} onAppCommand={appCommand} />
    </div>
  );
}
