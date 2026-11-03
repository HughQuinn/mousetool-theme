import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { MousePointer2, RotateCcw, Search } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { quickSwitchItems } from "@/lib/quick-switch";
import { useQuickSwitchStore } from "@/stores/quickSwitchStore";
import { useThemeStore } from "@/stores/themeStore";

/**
 * Ctrl+K 快速切换面板（决策 68）
 *
 * 应用内等价于托盘快速切换（决策 30）：输入即过滤全部主题，↑↓ 选择、
 * Enter 直接应用，应用的核心动作「挑一个 → 应用」从这里一步直达。
 * 底部常驻「还原系统默认光标」动作行；应用 / 还原走 store 同一条链路，
 * 失败由 toast 报——面板只负责选，不复制确认流程。
 *
 * 受设置「快捷键开关」管辖（shortcuts_enabled），关闭后 Ctrl+K 不再拉起。
 */
export function QuickSwitcher() {
  const open = useQuickSwitchStore((s) => s.open);
  const setOpen = useQuickSwitchStore((s) => s.setOpen);
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const restoreDefault = useThemeStore((s) => s.restoreDefault);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo(
    () => quickSwitchItems(themes, query, activeThemeId),
    [themes, query, activeThemeId],
  );
  // 动作行 = 主题候选之后的一项（还原默认光标）
  const rowCount = items.length + 1;

  // 打开时重置：上次的搜索词与高亮不该带进下一次
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // 高亮项跟着滚动，键盘漫游不能滚出视野
  useEffect(() => {
    document
      .getElementById(`qs-item-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const close = () => setOpen(false);

  const runItem = (index: number) => {
    if (index < items.length) {
      const item = items[index];
      close();
      // 先关面板再应用：动作独立进行，失败由 toast 报，面板不背确认流程
      void applyTheme(item.id);
    } else {
      close();
      void restoreDefault();
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(rowCount - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(activeIndex);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/30",
            "transition-opacity duration-(--motion-base) ease-standard",
            "data-[starting-style]:opacity-0",
            "data-[ending-style]:duration-(--motion-exit) data-[ending-style]:ease-exit data-[ending-style]:opacity-0",
          )}
        />
        <DialogPrimitive.Popup
          data-slot="quick-switcher"
          aria-label="快速切换主题"
          className={cn(
            "fixed top-[14%] left-1/2 z-50 w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2",
            "overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-overlay outline-none",
            "origin-top transition-[opacity,scale] duration-(--motion-slow) ease-standard",
            "data-[starting-style]:pointer-events-none data-[starting-style]:scale-96 data-[starting-style]:opacity-0",
            "data-[ending-style]:pointer-events-none data-[ending-style]:scale-96 data-[ending-style]:opacity-0",
            "data-[ending-style]:duration-(--motion-exit) data-[ending-style]:ease-exit",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              data-quick-switch-input
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="输入名称，回车应用…"
              aria-label="搜索主题"
              autoComplete="off"
              spellCheck={false}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div role="listbox" aria-label="主题候选" className="scroll-thin max-h-80 overflow-y-auto p-1.5">
            {items.map((item, index) => (
              <button
                key={item.id}
                id={`qs-item-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                data-quick-switch-item={item.id}
                onClick={() => runItem(index)}
                onMouseMove={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none",
                  "transition-colors duration-(--motion-fast) ease-standard",
                  index === activeIndex ? "bg-accent" : "hover:bg-muted/50",
                )}
              >
                <MousePointer2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                {item.isActive ? (
                  <StatusBadge tone="success" dot>
                    使用中
                  </StatusBadge>
                ) : (
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {item.isBuiltIn ? "系统方案" : "我的主题"}
                  </span>
                )}
              </button>
            ))}

            <div className="my-1 border-t border-border/60" role="separator" />
            <button
              id={`qs-item-${items.length}`}
              role="option"
              aria-selected={activeIndex === items.length}
              data-quick-switch-restore
              onClick={() => runItem(items.length)}
              onMouseMove={() => setActiveIndex(items.length)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none",
                "transition-colors duration-(--motion-fast) ease-standard",
                activeIndex === items.length ? "bg-accent" : "hover:bg-muted/50",
              )}
            >
              <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">还原系统默认光标</span>
            </button>

            {items.length === 0 && (
              <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
                没有匹配「{query.trim()}」的主题
              </p>
            )}
          </div>

          <div className="border-t border-border/60 px-3.5 py-2 text-2xs text-muted-foreground">
            ↑↓ 选择 · Enter 应用 · Esc 关闭
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
