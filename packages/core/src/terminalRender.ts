// #1214 터미널 렌더링 — GPU 자동/켜짐/끄기, 최소 색상 대비 자동/끄기/직접.
export type GpuMode = "auto" | "on" | "off";
export const GPU_MODES: readonly GpuMode[] = ["auto", "on", "off"];

// 새 키가 없으면 옛 스위치에서(켜짐 = 자동, 꺼짐 = 끄기).
export function readGpuMode(stored: unknown, legacyOn: unknown): GpuMode {
  if (typeof stored === "string" && (GPU_MODES as readonly string[]).includes(stored)) return stored as GpuMode;
  return legacyOn === false ? "off" : "auto";
}

// 자동 — 맥·윈도우는 WebGL. 리눅스는 GPU 이름을 못 읽거나 소프트웨어 렌더(가상머신·원격)면 일반 렌더.
const SOFTWARE_GPU = /\b(swiftshader|llvmpipe|softpipe|software rasterizer|software adapter|basic render|virgl|svga3d)\b/i;
export function gpuAllowed(mode: GpuMode, isLinux: boolean, gpuName: string | null): boolean {
  if (mode !== "auto") return mode === "on";
  if (!isLinux) return true;
  return !!gpuName && !SOFTWARE_GPU.test(gpuName);
}

// 최소 대비 — "auto"(밝은 배경 4.5, 어두운 배경 3), 1 = 끄기, 숫자 = 직접(1~21, xterm 범위).
export type MinContrast = "auto" | number;
export function resolveMinContrast(setting: unknown, lightBackground: boolean): number {
  if (typeof setting === "number" && Number.isFinite(setting)) return Math.min(21, Math.max(1, setting));
  return lightBackground ? 4.5 : 3;
}

// #rrggbb·#rgb 밝기(상대 휘도)가 중간보다 밝은지 — 검정 대비가 흰색 대비보다 크면 밝은 배경.
export function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05);
}
