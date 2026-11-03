import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";

/**
 * 右键菜单（决策 66）。base-ui 的 ContextMenu 自封装，风格与 Dialog 同源：
 * popover 底 + ring 描边、入场 slow 档缩放淡入、退场 exit 档（浮层口径）。
 * 定位、Esc / 点外关闭、方向键漫游、焦点圈定都交给 base-ui。
 *
 * 触发区由 `ContextMenuTrigger` 渲染：块级内容直接包 div；表格行把
 * `render` 指向 `<tr>`（合并属性，不破坏 table 语义）。
 */
function ContextMenuRoot(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger(
  props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>,
) {
  return <ContextMenuPrimitive.Trigger {...props} />;
}

function ContextMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10 shadow-overlay outline-none",
            "transition-[opacity,scale] duration-(--motion-slow) ease-standard",
            "data-[starting-style]:pointer-events-none data-[starting-style]:scale-96 data-[starting-style]:opacity-0",
            "data-[ending-style]:pointer-events-none data-[ending-style]:scale-96 data-[ending-style]:opacity-0",
            "data-[ending-style]:duration-(--motion-exit) data-[ending-style]:ease-exit",
            className,
          )}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex min-w-0 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none select-none",
        "transition-colors duration-(--motion-fast) ease-standard",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
