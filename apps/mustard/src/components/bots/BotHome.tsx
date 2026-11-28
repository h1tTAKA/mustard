"use client";
// 봇 홈(#1397, 에픽 #1391 재정의 2) — 레포 없이 봇들만 보는 화면. 왼쪽 목록 · 가운데 · 오른쪽 [할 일 | 정보] 탭(#1404) 3단.
// 좁은 폭: 본문 폭을 재서 오른쪽 칸(900px 미만) → 왼쪽 칸(560px 미만) 순으로 붙박이에서 빠짐.
// 빠진 칸은 헤더 토글로 가운데 위에 덮어 열고, 가운데를 누르면 닫힘. 붙박이 칸의 토글은 그냥 접기/펴기.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconLayoutSidebarLeftExpand, IconLayoutSidebarLeftCollapse, IconLayoutSidebarRightExpand, IconLayoutSidebarRightCollapse } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { useFullscreen } from "@mustard/nunopi";
import BotSidebar, { type BotProject } from "./BotSidebar";
import BotInfo from "./BotInfo";
import BotItems from "./BotItems";
import BotChat from "./BotChat";
import BotDialog, { type BotFields, type CreateResult } from "./BotDialog";
import { botName, useBots } from "./useBots";

const SEL_KEY = "nunopi:bots-selected";
const TAB_KEY = "nunopi:bots-right-tab"; // 오른쪽 탭 기억(할 일 | 정보)
// 휴지통 부탁 중인 삭제 폴더 — 삭제 직후 부탁과 "남은 폴더 다시 부탁"이 같은 폴더를 겹쳐 부탁하면 뒤쪽이 실패로 보임(리뷰).
// 겹치면 진행 중인 부탁을 같이 기다림(새로 안 보냄) → 누가 불러도 진짜 결과를 받음. 데스크톱이 아니면 null.
const trashing = new Map<string, Promise<{ ok: boolean }>>();
function trashOnce(p: string): Promise<{ ok: boolean }> | null {
  const ask = window.nunopiDesktop?.trashBotFolder;
  if (!ask) return null;
  let run = trashing.get(p);
  if (!run) { run = ask(p).finally(() => trashing.delete(p)); trashing.set(p, run); }
  return run;
}

const TOGGLE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const LEFT_MIN = 560, RIGHT_MIN = 900;

export default function BotHome({ modeSwitch, active, projects, onOpenProject }: { modeSwitch: ReactNode; active: boolean; projects: BotProject[]; onOpenProject: (key: string) => void }) {
  const t = useT();
  const { bots, error, reload, op, trashLeft } = useBots(active);
  // 고른 봇 — 기억해 두고, 없어졌으면(빼기·다른 창) 맨 위 봇.
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(SEL_KEY); } catch { return null; } });
  const [creating, setCreating] = useState(false); // 새 봇 창 열림
  const [editing, setEditing] = useState<string | null>(null); // 설정 창을 연 봇 id
  const [tab, setTabState] = useState<"items" | "info">(() => { try { return localStorage.getItem(TAB_KEY) === "info" ? "info" : "items"; } catch { return "items"; } });
  const setTab = (v: "items" | "info") => { setTabState(v); try { localStorage.setItem(TAB_KEY, v); } catch { /* ignore */ } };
  const toast = useToast();
  // 설정 중 봇이 사라지면(다른 창 삭제) 설정 상태도 비움 — 안 비우면 Esc가 막히고, 같은 id로 다시 만든 봇에 창이 저절로 열림(리뷰)
  useEffect(() => { if (editing && bots && !bots.some((b) => b.id === editing)) setEditing(null); }, [bots, editing]); // eslint-disable-line react-hooks/set-state-in-effect -- 목록이 바뀐 결과로 닫음
  // 지난번에 휴지통에 못 보낸 삭제 폴더 — 봇 홈을 다시 읽을 때 조용히 다시 부탁(실패해도 알림 안 함, 다음에 또)
  useEffect(() => { for (const p of trashLeft) void trashOnce(p)?.catch(() => {}); }, [trashLeft]);
  const pick = (id: string | null) => { setPicked(id); try { if (id) localStorage.setItem(SEL_KEY, id); else localStorage.removeItem(SEL_KEY); } catch { /* ignore */ } };
  const bot = bots?.find((b) => b.id === picked) ?? bots?.[0] ?? null;
  // 삭제 → 서버가 비켜 둔 봇 폴더를 데스크톱에 휴지통으로 부탁(웹·실패면 봇 폴더 안 .deleted-* 로 남음 — 목록엔 안 보임)
  const remove = async (id: string): Promise<"ok" | "rejected" | "unknown"> => {
    const r = await op({ op: "delete", id });
    if (typeof r !== "object") return r;
    if (r.trashed) void trashOnce(r.trashed)?.then((x) => { if (!x?.ok) toast(t("bots.trashFailed"), "error"); }, () => toast(t("bots.trashFailed"), "error"));
    return "ok";
  };
  const save = async (id: string, b: BotFields): Promise<CreateResult> => { const r = await op({ op: "update", id, ...b }); return typeof r === "object" ? "ok" : r; };
  // 새 봇 창에서 만들기 → 서버가 알려 준 새 봇 id를 고름
  const create = async (b: BotFields): Promise<CreateResult> => {
    const r = await op({ op: "create", name: b.name ?? "", mission: b.mission ?? "", provider: b.provider, model: b.model, color: b.color });
    if (typeof r !== "object") return r;
    if (r.created) pick(r.created);
    return "ok";
  };
  const openNew = () => setCreating(true);
  const left = <BotSidebar bots={bots} error={error} selected={bot?.id ?? null} onSelect={pick} onNew={openNew} onRetry={reload} projects={projects} onOpenProject={onOpenProject} />;
  const center = bot ? (
    <BotChat key={bot.id} bot={bot} /> // #1401 Home Chat
) : bots && bots.length === 0 ? (
    // 봇 없음 — 가운데는 조용히 한 줄 + [새 봇](만들기는 창으로)
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[13px] text-zinc-400 dark:text-zinc-500">{t("bots.noBots")}</p>
      <button type="button" onClick={openNew}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-mustard-500 px-3.5 text-[12.5px] font-semibold text-brown-900 transition hover:bg-mustard-400">
        <IconPlus size={14} stroke={2.2} aria-hidden /> {t("bots.new.title")}
      </button>
    </div>
  ) : null; // 읽는 중·못 읽음
  const tabBtn = (v: "items" | "info") => (
    <button type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
      className={`h-7 w-20 rounded-md text-[12px] font-medium transition ${tab === v ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
      {t(`bots.tab.${v}`)}
    </button>
  );
  const right = bot ? (
    <>
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">{tabBtn("items")}{tabBtn("info")}</div>
      {tab === "items"
        ? <BotItems key={bot.id} botId={bot.id} botName={botName(t, bot)} active={active} />
        : <BotInfo bot={bot} onDelete={remove} onEdit={() => setEditing(bot.id)} />}
    </>
  ) : error ? <BotInfo bot={null} onDelete={remove} onEdit={() => {}} /> : null; // 읽는 중·봇 없음엔 비움
  const fullscreen = useFullscreen(); // 신호등 자리 좌측 패딩(레포 헤더와 같은 규칙)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1440);
  const [leftOver, setLeftOver] = useState(false), [rightOver, setRightOver] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w <= 0) return;
      setWidth(w);
      // 붙박이로 돌아가면 덮개 상태는 버림 — 다시 좁혔을 때 안 눌렀는데 덮개가 열리지 않게(리뷰)
      if (w >= LEFT_MIN) setLeftOver(false);
      if (w >= RIGHT_MIN) setRightOver(false);
    }); // 레포 모드(display:none)의 0은 무시 — 돌아올 때 양옆 칸이 한 번 빠졌다 붙지 않게(리뷰)
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leftDocked = width >= LEFT_MIN, rightDocked = width >= RIGHT_MIN;
  // 붙박이일 땐 접기 상태, 빠졌을 땐 덮어 열기 상태 — 서로 따로(넓혔을 때 덮개가 남지 않게).
  const [leftShut, setLeftShut] = useState(false), [rightShut, setRightShut] = useState(false);
  const leftOn = leftDocked ? !leftShut : leftOver, rightOn = rightDocked ? !rightShut : rightOver;
  const toggleLeft = () => (leftDocked ? setLeftShut((v) => !v) : setLeftOver((v) => !v));
  const toggleRight = () => (rightDocked ? setRightShut((v) => !v) : setRightOver((v) => !v));
  const over = "absolute inset-y-0 z-20 shadow-lg";
  // 덮어 연 칸은 Esc로 닫힘(리뷰)
  useEffect(() => {
    if ((!leftOver && !rightOver) || creating || editing) return; // 새 봇·설정 창이 열려 있으면 Esc는 창 몫(같이 닫히지 않게, 리뷰)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setLeftOver(false); setRightOver(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOver, rightOver, creating, editing]);
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className={`titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800 ${fullscreen ? "pl-2" : "pl-[78px]"}`}>
        {modeSwitch}
        <button type="button" onClick={toggleLeft} aria-pressed={leftOn} title={t("bots.leftPanel")} aria-label={t("bots.leftPanel")} className={TOGGLE}>
          {leftOn ? <IconLayoutSidebarLeftCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarLeftExpand size={18} stroke={2} aria-hidden />}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={toggleRight} aria-pressed={rightOn} title={t("bots.rightPanel")} aria-label={t("bots.rightPanel")} className={TOGGLE}>
          {rightOn ? <IconLayoutSidebarRightCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarRightExpand size={18} stroke={2} aria-hidden />}
        </button>
      </header>
      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        {leftOn && (
          <aside className={`flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[var(--s-pane)] ${leftDocked ? "" : `${over} left-0`}`}>
            {left}
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col" onPointerDown={() => { setLeftOver(false); setRightOver(false); }}>{center}</main>
        {rightOn && (
          <aside className={`flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[var(--s-pane)] ${rightDocked ? "" : `${over} right-0`}`}>
            {right}
          </aside>
        )}
      </div>
      {creating && <BotDialog onClose={() => setCreating(false)} submit={create} />}
      {(() => { const eb = editing ? bots?.find((b) => b.id === editing) : undefined; // 설정 중 봇이 사라지면(다른 창 삭제) 창도 닫힘
        return eb && <BotDialog key={eb.id} bot={eb} nameHint={botName(t, eb)} onClose={() => setEditing(null)} submit={(f) => save(eb.id, f)} />; })()}
    </div>
  );
}
