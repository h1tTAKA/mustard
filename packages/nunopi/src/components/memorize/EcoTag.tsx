// #1388 토큰 카드 소속 표시 — [로고] 이름(예: Flutter). 아이콘이 있는 흔한 것만 로고(브랜드 색), 나머지는 코드 아이콘 + 이름.
import {
  IconBrandFlutter, IconBrandReact, IconBrandTypescript, IconBrandJavascript, IconBrandPython, IconBrandSwift, IconBrandKotlin, IconBrandGolang, IconBrandRust,
  IconBrandNextjs, IconBrandVue, IconBrandAngular, IconBrandSvelte, IconBrandNodejs, IconBrandDocker, IconBrandGit, IconBrandCss3, IconBrandHtml5, IconBrandTailwind,
  IconBrandPhp, IconBrandDeno, IconBrandAndroid, IconBrandApple, IconBrandUnity, IconBrandDjango, IconBrandLaravel, IconBrandMysql, IconBrandMongodb, IconBrandFirebase,
  IconBrandSupabase, IconBrandRedux, IconBrandVite, IconBrandGraphql, IconBrandPrisma, IconBrandCpp, IconBrandCSharp, IconBrandNpm, IconBrandGithub, IconBrandOpenai,
  IconBrandAws, IconBrandAzure, IconBrandTerraform, IconBrandNuxt, IconBrandSolidjs, IconBrandReactNative, IconBrandAstro, IconBrandSass, IconBrandBootstrap,
  IconBrandWindows, IconBrandPowershell, IconBrandVercel, IconBrandThreejs, IconCode, type Icon,
} from "@tabler/icons-react";

const LOGOS: [RegExp, Icon, string][] = [
  [/^flutter$/i, IconBrandFlutter, "#02569B"], [/^react native$/i, IconBrandReactNative, "#61DAFB"], [/^react$/i, IconBrandReact, "#0ea5c6"],
  [/^typescript$|^ts$/i, IconBrandTypescript, "#3178C6"], [/^javascript$|^js$/i, IconBrandJavascript, "#c9a700"], [/^python$/i, IconBrandPython, "#3776AB"],
  [/^swift(ui)?$/i, IconBrandSwift, "#F05138"], [/^kotlin$/i, IconBrandKotlin, "#7F52FF"], [/^go(lang)?$/i, IconBrandGolang, "#00ADD8"], [/^rust$/i, IconBrandRust, "#B7410E"],
  [/^next\.?js$/i, IconBrandNextjs, "#18181b"], [/^vue(\.js)?$/i, IconBrandVue, "#41B883"], [/^angular$/i, IconBrandAngular, "#DD0031"], [/^svelte(kit)?$/i, IconBrandSvelte, "#FF3E00"],
  [/^node(\.js)?$/i, IconBrandNodejs, "#5FA04E"], [/^docker$/i, IconBrandDocker, "#2496ED"], [/^git$/i, IconBrandGit, "#F05032"], [/^css3?$/i, IconBrandCss3, "#1572B6"],
  [/^html5?$/i, IconBrandHtml5, "#E34F26"], [/^tailwind( ?css)?$/i, IconBrandTailwind, "#06B6D4"], [/^php$/i, IconBrandPhp, "#777BB4"], [/^deno$/i, IconBrandDeno, "#18181b"],
  [/^android$/i, IconBrandAndroid, "#3DDC84"], [/^(ios|macos|uikit|appkit|xcode)$/i, IconBrandApple, "#18181b"], [/^unity$/i, IconBrandUnity, "#18181b"],
  [/^django$/i, IconBrandDjango, "#092E20"], [/^laravel$/i, IconBrandLaravel, "#FF2D20"], [/^mysql$/i, IconBrandMysql, "#4479A1"], [/^mongodb$/i, IconBrandMongodb, "#47A248"],
  [/^firebase$/i, IconBrandFirebase, "#DD2C00"], [/^supabase$/i, IconBrandSupabase, "#3ECF8E"], [/^redux$/i, IconBrandRedux, "#764ABC"], [/^vite$/i, IconBrandVite, "#646CFF"],
  [/^graphql$/i, IconBrandGraphql, "#E10098"], [/^prisma$/i, IconBrandPrisma, "#2D3748"], [/^c\+\+$/i, IconBrandCpp, "#00599C"], [/^c#$|^\.net$/i, IconBrandCSharp, "#512BD4"],
  [/^npm$/i, IconBrandNpm, "#CB3837"], [/^github( actions)?$/i, IconBrandGithub, "#18181b"], [/^openai$/i, IconBrandOpenai, "#18181b"], [/^aws$/i, IconBrandAws, "#FF9900"],
  [/^azure$/i, IconBrandAzure, "#0078D4"], [/^terraform$/i, IconBrandTerraform, "#7B42BC"], [/^nuxt$/i, IconBrandNuxt, "#00DC82"], [/^solid(js)?$/i, IconBrandSolidjs, "#2C4F7C"],
  [/^astro$/i, IconBrandAstro, "#BC52EE"], [/^(sass|scss)$/i, IconBrandSass, "#CC6699"], [/^bootstrap$/i, IconBrandBootstrap, "#7952B3"], [/^windows$/i, IconBrandWindows, "#0078D4"],
  [/^powershell$/i, IconBrandPowershell, "#5391FE"], [/^vercel$/i, IconBrandVercel, "#18181b"], [/^three\.?js$/i, IconBrandThreejs, "#18181b"],
];

export function EcoTag({ name, className = "" }: { name?: string; className?: string }) {
  if (!name) return null;
  const hit = LOGOS.find(([re]) => re.test(name.trim()));
  const Logo = hit?.[1] ?? IconCode;
  return (
    <span className={`relative inline-flex max-w-full items-center gap-1 font-bold text-zinc-700 ${className}`}>
      <Logo className="shrink-0" size="1.2em" stroke={2.2} style={{ color: hit?.[2] }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}
