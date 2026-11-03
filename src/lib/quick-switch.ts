import type { CursorTheme } from "@/types/theme";

/** Ctrl+K 面板里的一行候选（决策 68） */
export interface QuickSwitchItem {
  id: string;
  name: string;
  /** 系统方案 / 我的主题，来源徽章用 */
  isBuiltIn: boolean;
  /** 正在使用中的排最前并带徽标 */
  isActive: boolean;
}

/**
 * 快速切换面板的候选清单（决策 68，纯函数可单测）
 *
 * 过滤 = 名称包含关键词（大小写不敏感，空词全量）；
 * 排序 = 使用中第一，然后我的主题（名称序）、系统方案（名称序）——
 * 面板的任务是「切」，自己导入的主题是主要目标，排在前。
 */
export function quickSwitchItems(
  themes: CursorTheme[],
  query: string,
  activeThemeId: string | null,
): QuickSwitchItem[] {
  const keyword = query.trim().toLowerCase();
  return themes
    .filter((theme) => !keyword || theme.name.toLowerCase().includes(keyword))
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      isBuiltIn: theme.is_built_in,
      isActive: theme.id === activeThemeId,
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? 1 : -1;
      return a.name.localeCompare(b.name, "zh");
    });
}
