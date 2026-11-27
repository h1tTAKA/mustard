// 봇 아바타(#1397) — 봇 색 바탕 + 이름 첫 글자. 색은 봇 정보(color, 밝은 7색)라 글자는 늘 어두운 색.
export default function BotAvatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center font-bold text-zinc-900"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), background: color, fontSize: Math.round(size * 0.42) }}>
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}
