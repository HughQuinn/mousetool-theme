import type { SettingsSnapshot } from "@/services/settings";
import type { CursorTheme } from "@/types/theme";

/**
 * 定时轮换主题的**纯函数部分**（决策 55）
 *
 * 与 `lib/schedule-switch.ts` / `schedule-window.ts` 的拆分同款：状态机与
 * store 订阅住在 `theme-rotate.ts`，这里只放不碰 store 的判断，让
 * node --test 能直接覆盖（决策 49，`@/` 别名在 node 下解析不了）。
 */

/** 轮换间隔档位（分钟）；范围由后端 `validate_rotate_interval` 兜底（15–1440） */
export const ROTATE_INTERVAL_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "每 15 分钟" },
  { minutes: 30, label: "每 30 分钟" },
  { minutes: 60, label: "每 1 小时" },
  { minutes: 120, label: "每 2 小时" },
  { minutes: 240, label: "每 4 小时" },
  { minutes: 480, label: "每 8 小时" },
  { minutes: 1440, label: "每 24 小时" },
];

/**
 * 轮换候选：「我的主题」按名称排序（localeCompare zh，与批量导出的稳定
 * 口径一致，id 兜底避免重名抖动）。系统方案不参与——那是 Windows 的东西。
 */
export function rotationCandidates(themes: CursorTheme[]): CursorTheme[] {
  return themes
    .filter((theme) => !theme.is_built_in)
    .sort((a, b) => a.name.localeCompare(b.name, "zh") || a.id.localeCompare(b.id));
}

/**
 * 选出下一个要应用的主题：当前主题在候选里就转下一位，不在（刚还原默认 /
 * 用着系统方案）就从队首开始。候选不足 2 套时没有轮换意义，返回 null。
 */
export function pickRotationTarget(
  themes: CursorTheme[],
  activeThemeId: string | null,
): string | null {
  const candidates = rotationCandidates(themes);
  if (candidates.length < 2) return null;
  const index = candidates.findIndex((theme) => theme.id === activeThemeId);
  // findIndex 为 -1 时 (-1 + 1) % n = 0，正好落到队首
  const next = candidates[(index + 1) % candidates.length];
  return next.id;
}

/** 轮换此刻是否让位：其它自动行为开启时轮换不动作（决策 55 的优先级规则） */
export function rotationYields(
  settings: Pick<SettingsSnapshot, "auto_switch_enabled" | "schedule_switch_enabled">,
): boolean {
  return settings.auto_switch_enabled || settings.schedule_switch_enabled;
}
