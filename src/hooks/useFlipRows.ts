import { useEffect, type RefObject } from "react";

/**
 * 表格行位置变化后的 FLIP 让位（决策 65）
 *
 * 删除 / 筛选 / 排序让行消失或挪位时，仍然存在的行从旧位置滑到新位置，
 * 而不是瞬移补位。与 toaster 的 useStackShift 同一套手法，但量位置用
 * `offsetTop` 而不是 `getBoundingClientRect()`：transform 不参与布局，
 * offsetTop 永远是"最终位置"，上一轮动画播到一半也不会污染测量
 * （toaster 那边量的是含 transform 的视口位置，才需要先 cancel）。
 *
 * 减少动态偏好下直接跳过：WAAPI 不受全局 CSS 压缩时长的影响，
 * 必须在 JS 侧自己不创建动画（motion.md §5）。
 *
 * @param containerRef 行容器（tbody）的 ref
 * @param rowSelector 行选择器，行根元素须带 `data-flip-key`（稳定标识）
 * @param deps 触发量测与补间的依赖（通常就是行数据数组）
 */
export function useFlipRows(
  containerRef: RefObject<HTMLElement | null>,
  rowSelector: string,
  deps: readonly unknown[],
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>(rowSelector);
    if (rows.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = positions.get(container) ?? new Map<string, number>();
    const current = new Map<string, number>();

    for (const row of rows) {
      const key = row.dataset.flipKey;
      if (!key) continue;
      const top = row.offsetTop;
      current.set(key, top);
      const before = previous.get(key);
      // 新插入的行没有旧位置；位移量 0 也不用补
      if (before === undefined || before === top || reduced) continue;
      row.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }],
        { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }

    positions.set(container, current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** 每个容器各记一份旧位置快照（WeakMap：容器卸载即作废，不用手动清） */
const positions = new WeakMap<HTMLElement, Map<string, number>>();
