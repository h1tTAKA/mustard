import type { Metadata } from "next";
import { Inter, Space_Grotesk, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// PDF 디자인 시스템 타이포: Inter(본문/long-form), Space Grotesk(헤딩/UI 라틴),
// Noto Sans KR(한글). 코드(--font-mono)는 유저 요청대로 제외 — 기존 mono 스택 유지.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const notoSansKr = Noto_Sans_KR({
  weight: ["400", "500", "700"],
  // next/font의 Noto_Sans_KR named subset은 latin/cyrillic 등뿐 — 한글 글리프는
  // 별도 subset이 아니라 unicode-range 블록으로 항상 @font-face에 포함된다.
  // subsets는 preload 대상만 제어. 한글 글리프 용량이 커서 preload는 끄고 swap.
  subsets: ["latin"],
  preload: false,
  variable: "--font-noto",
  display: "swap",
});

// 테마 FOUC 방지(#914) — 하이드레이션 전 저장 테마를 data-theme + .dark(base)로 반영.
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('nunopi:theme');var dark=['dark','midnight','nord','solarized-dark'];var e=document.documentElement;if(!t)t='dark';e.setAttribute('data-theme',t);e.classList.toggle('dark',dark.indexOf(t)>=0);}catch(_){}})();`;

export const metadata: Metadata = {
  title: "Mustard",
  description:
    "Agentic development environment (ADE): open repos as tabs and build with agents, terminals and git — with the optional nunopi code-learning module.", // #1095 정적 메타라 언어 중립(영어)
  icons: { icon: "/brand/mustard-mark.svg" }, // 브랜드 심볼(겨자 꽃가지, #906)
  openGraph: {
    title: "Mustard",
    description: "Agentic development environment (ADE)",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Mustard",
    description: "Agentic development environment (ADE)",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`h-full antialiased ${inter.variable} ${spaceGrotesk.variable} ${notoSansKr.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* 테마 FOUC 방지 — 서버 렌더 시 head에 인라인(#914). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
