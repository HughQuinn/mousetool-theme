import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedProps<T extends string> {
  /** 当前值 */
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** 无障碍名称（整组） */
  label: string;
}

/** 滑块几何：相对分组容器的偏移与尺寸（offsetParent 就是容器，天然含内边距） */
interface ThumbBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 分段单选（role="radiogroup"）
 *
 * 选项恒定少而短（2–3 个），对应 Windows 里「三选一」式的外观 / 行为选择。
 * 选中态用「抬起」表达（浅底 + 细环 + 阴影），不靠状态色——状态色只做反馈。
 * 抬起底不在按钮上，而是整组共享一个绝对定位滑块（决策 69）：切换时
 * translate + width 同走 spring，滑块从旧选项流到新选项、移动中被拉伸、
 * 到位时收回——选项宽度不等时纯 translate 对不齐两条边，覆盖层改宽度
 * 不牵动任何内容布局，是「不做宽高动画」禁令的绝对定位特例。
 *
 * 键盘模型按 WAI-ARIA 单选组：整组一个 Tab 停靠点（roving tabindex），
 * 方向键在选项间移动并**立即选中**，Home / End 跳到首尾。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState<ThumbBox | null>(null);
  const checkedIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = checkedIndex === -1 ? 0 : checkedIndex;

  const measure = useCallback(() => {
    const active = buttons.current[checkedIndex];
    if (!active) return;
    const next = {
      x: active.offsetLeft,
      y: active.offsetTop,
      w: active.offsetWidth,
      h: active.offsetHeight,
    };
    setThumb((prev) =>
      prev &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.w === next.w &&
      prev.h === next.h
        ? prev
        : next,
    );
  }, [checkedIndex]);

  useLayoutEffect(() => {
    // 首次量取发生在首帧绘制前，滑块带着正确位置挂载、不会从 0 滑入
    measure();
    const group = groupRef.current;
    if (!group) return;
    // 字体就位 / 容器尺寸变化都会挪动按钮几何，滑块跟着重量（仍走 spring）
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [measure]);

  const moveTo = (index: number) => {
    const next = options[index];
    if (!next) return;
    onChange(next.value);
    buttons.current[index]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className="relative flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {thumb && (
        <span
          aria-hidden
          className="segmented-thumb pointer-events-none absolute top-0 left-0 rounded-md transition-[translate,width] duration-(--motion-spring) ease-spring"
          style={{
            translate: `${thumb.x}px ${thumb.y}px`,
            width: thumb.w,
            height: thumb.h,
          }}
        />
      )}
      {options.map((option, index) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              let next: number | null = null;
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                next = (index + 1) % options.length;
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                next = (index - 1 + options.length) % options.length;
              } else if (event.key === "Home") {
                next = 0;
              } else if (event.key === "End") {
                next = options.length - 1;
              }
              if (next === null) return;
              event.preventDefault();
              moveTo(next);
            }}
            className={cn(
              // relative 让按钮画在绝对定位的滑块之上；文字颜色仍走 fast 档——
              // 320ms 的变色会显得反应慢，颜色不跟滑块一起弹（决策 59 口径）
              "focus-ring relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-[color] duration-(--motion-fast) ease-standard",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
