import type { CursorTheme, HistoryEntry, ThemeFileGap } from "@/types/theme";

/**
 * 主题的纯派生计算（筛选、分组、排序）
 *
 * 这里全部是纯函数：**不要**把它们塞进 zustand selector。
 * selector 返回新数组/新对象会让 `useSyncExternalStore` 认为快照一直在变，
 * 触发无限重渲染直到整页白屏（本仓库踩过）。正确用法是组件里
 * `const rows = useMemo(() => mineThemes(themes, query), [themes, query])`。
 */

/** 按来源把主题分成两组：系统方案与我的主题 */
export function splitBySource(themes: CursorTheme[]): {
  builtIn: CursorTheme[];
  mine: CursorTheme[];
} {
  return {
    builtIn: themes.filter((theme) => theme.is_built_in),
    mine: themes.filter((theme) => !theme.is_built_in),
  };
}

/** 关键词过滤（名称、不区分大小写） */
export function filterByName(themes: CursorTheme[], query: string): CursorTheme[] {
  const q = query.trim().toLowerCase();
  if (!q) return themes;
  return themes.filter((theme) => theme.name.toLowerCase().includes(q));
}

/**
 * 「我的主题」的排序键（决策 48）
 *
 * `newest` 是缺省值，也是后端既有口径（导入时间倒序）——不排序就是它。
 * `usage`（决策 53）按事件流里的应用次数降序，配合「从未使用的」筛选做清理决策。
 */
export type MineSort = "newest" | "oldest" | "name" | "slots" | "usage";

/** 「我的主题」的筛选（决策 48）：缺口与使用记录都来自 store，不落盘 */
export type MineFilter = "all" | "gapped" | "unused";

export interface MineViewOptions {
  sort?: MineSort;
  filter?: MineFilter;
  /** 文件缺口清单（决策 31）：「缺文件的」筛选依据 */
  fileGaps?: ThemeFileGap[];
  /** 最近使用里出现过的主题 ID：「从未使用的」取反 */
  usedIds?: ReadonlySet<string>;
  /** 各主题的应用次数（决策 53）：「按应用次数」排序依据 */
  applyCounts?: Readonly<Record<string, number>>;
}

/** 「我的主题」页的数据：非系统方案 + 关键词过滤 + 排序与筛选（决策 48） */
export function mineThemes(
  themes: CursorTheme[],
  query: string,
  options: MineViewOptions = {},
): CursorTheme[] {
  let rows = filterByName(
    themes.filter((theme) => !theme.is_built_in),
    query,
  );

  const { sort = "newest", filter = "all", fileGaps = [], usedIds, applyCounts = {} } = options;
  if (filter === "gapped") {
    const gapped = new Set(fileGaps.map((gap) => gap.theme_id));
    rows = rows.filter((theme) => gapped.has(theme.id));
  } else if (filter === "unused" && usedIds) {
    rows = rows.filter((theme) => !usedIds.has(theme.id));
  }

  // 「导入于」列显示 updated_at（重命名不动它）。升序给「最早导入」用；
  // 并列时的次序跟决策 48 写死的口径：同数按导入时间**新在前**
  const byDate = (a: CursorTheme, b: CursorTheme) =>
    (a.updated_at ?? "").localeCompare(b.updated_at ?? "") || a.name.localeCompare(b.name, "zh");
  const byDateNewestFirst = (a: CursorTheme, b: CursorTheme) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.name.localeCompare(b.name, "zh");
  switch (sort) {
    case "oldest":
      rows = [...rows].sort(byDate);
      break;
    case "name":
      rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "zh"));
      break;
    case "slots":
      // 完整度 = 非空槽位数（cursors 数组本身就是非空槽位，决策 31 同口径）
      rows = [...rows].sort((a, b) => b.cursors.length - a.cursors.length || byDateNewestFirst(a, b));
      break;
    case "usage":
      // 应用次数（决策 53）降序：常用的在前，方便反着看「谁一直没用」；
      // 没记录的按 0 计，同数按导入时间新在前（决策 48 口径）
      rows = [...rows].sort(
        (a, b) => (applyCounts[b.id] ?? 0) - (applyCounts[a.id] ?? 0) || byDateNewestFirst(a, b),
      );
      break;
    default:
      // newest：保持后端顺序
      break;
  }
  return rows;
}

/**
 * 取某主题的文件缺口（槽位注册表键名列表）；没有缺口返回空数组（决策 31）
 *
 * 纯查表：缺口清单整体来自 store（后端现算），这里只按主题 ID 找自己那份。
 */
export function missingSlotsOf(fileGaps: ThemeFileGap[], themeId: string): string[] {
  return fileGaps.find((gap) => gap.theme_id === themeId)?.slots ?? [];
}

/** 缺口里的注册表键名 → 主题内的中文名；键名必然来自主题自身，找不到才原样显示 */
export function missingSlotNames(theme: CursorTheme, slots: string[]): string[] {
  return slots.map(
    (key) => theme.cursors.find((slot) => slot.registry_key === key)?.display_name ?? key,
  );
}

/** 整理模式的派生数据（决策 43 / 62）：勾选口径只有这一个来源 */
export interface MineBatchSelection {
  /** 眼前可勾选的行（使用中的主题不进批量操作） */
  deletableRows: CursorTheme[];
  /** 已勾选且仍可勾选的主题——「删除所选 / 导出所选」的提交目标 */
  selectedThemes: CursorTheme[];
  allSelected: boolean;
  someSelected: boolean;
}

/**
 * 批量整理的勾选派生（纯函数）
 *
 * 从 MyThemesView 抽出（v0.5.0 重构）：勾选范围永远等于眼前列表，
 * 使用中的行不可进勾选——这两条口径在这里集中可测，组件只消费结果。
 */
export function mineBatchSelection(
  rows: CursorTheme[],
  activeThemeId: string | null,
  selectedIds: ReadonlySet<string>,
): MineBatchSelection {
  const deletableRows = rows.filter((theme) => theme.id !== activeThemeId);
  const selectedThemes = deletableRows.filter((theme) => selectedIds.has(theme.id));
  const allSelected = deletableRows.length > 0 && selectedThemes.length === deletableRows.length;
  const someSelected = selectedThemes.length > 0 && !allSelected;
  return { deletableRows, selectedThemes, allSelected, someSelected };
}

/**
 * 某主题在事件流里的应用次数（决策 53）；没有记录返回 null（界面显示「—」）
 *
 * 没记录和 0 次是同一件事（事件流里没出现过），但展示上「—」比「0 次」
 * 更符合「从来没换过」的语义，也不暗示存在被清掉的记录。
 */
export function applyCountOf(
  applyCounts: Readonly<Record<string, number>> | undefined,
  themeId: string,
): number | null {
  const count = applyCounts?.[themeId];
  return typeof count === "number" && count > 0 ? count : null;
}

/** 「最近使用」列表项：主题可能已被删除，所以 theme 允许为 null */
export interface RecentItem {
  entry: HistoryEntry;
  theme: CursorTheme | null;
}

/**
 * 把后端派生的最近主题映射成列表项（每个主题一条，最新在前）
 *
 * 被删掉的主题 `theme` 为 null，但仍然保留这一条：它是「你什么时候用过什么」
 * 的事实记录，删掉主题不等于没发生过。
 */
export function buildRecentItems(
  themes: CursorTheme[],
  recent: HistoryEntry[],
  query: string,
): RecentItem[] {
  const byId = new Map(themes.map((theme) => [theme.id, theme]));
  const q = query.trim().toLowerCase();

  return recent
    .map((entry) => ({ entry, theme: byId.get(entry.theme_id) ?? null }))
    .filter(({ entry, theme }) => {
      if (!q) return true;
      // 主题还在就按当前名字搜（可能改过名），被删了才退回快照名
      return (theme?.name ?? entry.name).toLowerCase().includes(q);
    });
}

export interface RecentGroup {
  /** 分组键，形如 `2026-10-22` */
  key: string;
  /** 展示用日期，「今天」「昨天」或「10月20日」 */
  label: string;
  items: RecentItem[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 本地时区的 `YYYY-MM-DD`，与后端 `applied_at` 的前半段同格式 */
function dayKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 今天 / 昨天 / 具体日期 —— 只做展示映射，不参与排序 */
function labelOf(key: string, now: Date): string {
  if (!DAY_RE.test(key)) return "更早";

  const today = dayKeyOf(now);
  if (key === today) return "今天";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKeyOf(yesterday)) return "昨天";

  const [year, month, day] = key.split("-");
  // 跨年记录必须带年份，否则「1月3日」说不清是哪一年的
  return Number(year) === now.getFullYear()
    ? `${Number(month)}月${Number(day)}日`
    : `${year}年${Number(month)}月${Number(day)}日`;
}

/**
 * 按自然日分组（保持传入顺序：最新在前）
 *
 * `applied_at` 是后端给的本地时区字符串 `YYYY-MM-DD HH:mm`，
 * 这里只切字符串取日期，不做 Date 解析 —— 避免时区把「今天」算错一天。
 */
export function groupRecentByDay(items: RecentItem[], now = new Date()): RecentGroup[] {
  const groups: RecentGroup[] = [];
  const index = new Map<string, RecentGroup>();

  for (const item of items) {
    const key = item.entry.applied_at.slice(0, 10);
    let group = index.get(key);
    if (!group) {
      group = { key, label: labelOf(key, now), items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}

/** 只取 `HH:mm`，时间轴左列只放得下这个精度；格式不认识就原样返回 */
export function timeOfDay(appliedAt: string): string {
  const time = appliedAt.split(" ")[1];
  return time && /^\d{1,2}:\d{2}$/.test(time) ? time : appliedAt;
}

/**
 * `applied_at` → `<time dateTime>` 可用的机器可读格式
 *
 * 后端存的是本地时区 `YYYY-MM-DD HH:mm`，HTML 的 datetime 属性要求日期与时间
 * 之间用 `T`；原样塞进去是无效值，读屏与工具拿不到时间语义。
 */
export function appliedAtMachine(appliedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(:\d{2})?$/.exec(appliedAt);
  if (!match) return appliedAt;
  return `${match[1]}T${match[2]}${match[3] ?? ""}`;
}
