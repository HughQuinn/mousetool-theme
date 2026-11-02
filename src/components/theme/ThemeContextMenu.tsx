import { Archive, Check, Pencil, Trash2 } from "lucide-react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExportTheme } from "@/hooks/useExportTheme";
import { cn } from "@/lib/utils";
import { actionBusyKey, useThemeStore } from "@/stores/themeStore";
import type { CursorTheme } from "@/types/theme";

/** 跨组件触发约定：检查器的 ThemeNameField / DeleteThemeDialog 监听这两个事件 */
export const REQUEST_RENAME_EVENT = "mousetool:request-rename";
export const REQUEST_DELETE_EVENT = "mousetool:request-delete";

export function requestThemeAction(event: string, themeId: string) {
  window.dispatchEvent(new CustomEvent(event, { detail: { id: themeId } }));
}

interface ThemeCardMenuProps {
  theme: CursorTheme;
  /** 触发区内容；`as` 传 `<tr>` 时触发器合并到表格行（不破坏 table 语义） */
  children: React.ReactNode;
  as?: "div" | "tr";
  className?: string;
}

/**
 * 主题卡 / 表格行的右键菜单（决策 65）
 *
 * 动作与检查器同源：应用走 store、导出走文件对话框；重命名与删除不直接执行
 * ——先选中该主题，再发请求事件让检查器里已有的编辑框 / 确认框接手，
 * 保证「无论从哪进，确认与后果说明只有一份」。
 *
 * 键盘入口不做：检查器头部已有全部动作的完整键盘路径（决策 20 的 busy / 焦点
 * 基线在那里），右键菜单是鼠标的快捷方式，不复制第二套键盘漫游。
 */
export function ThemeCardMenu({ theme, children, as = "div", className }: ThemeCardMenuProps) {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const selectTheme = useThemeStore((s) => s.selectTheme);
  const busy = useThemeStore((s) => s.busy);
  const { isExporting, pickAndExport } = useExportTheme();

  const isActive = theme.id === activeThemeId;
  const applying = Boolean(busy[actionBusyKey("apply", theme.id)]);
  const exporting = isExporting(theme.id) || Boolean(busy[actionBusyKey("export", "all")]);
  const deleting = Boolean(busy[actionBusyKey("delete", theme.id)]);

  const selectAndRequest = (event: string) => {
    selectTheme(theme.id);
    // 检查器要等这次选中渲染完才挂上监听：延到下一拍再发，别让请求落空
    setTimeout(() => requestThemeAction(event, theme.id), 0);
  };

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger
        render={as === "tr" ? (children as React.ReactElement) : undefined}
        className={as === "tr" ? undefined : className}
      >
        {as === "tr" ? undefined : children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`「${theme.name}」操作`}>
        {!isActive && (
          <ContextMenuItem
            data-context-menu-apply
            disabled={applying}
            onClick={() => void applyTheme(theme.id)}
          >
            <Check className="size-3.5 text-muted-foreground" />
            {applying ? "应用中…" : "应用此主题"}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          data-context-menu-export
          disabled={exporting || deleting}
          onClick={() => void pickAndExport(theme)}
        >
          <Archive className="size-3.5 text-muted-foreground" />
          {exporting ? "导出中…" : "导出 ZIP"}
        </ContextMenuItem>
        {!theme.is_built_in && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-context-menu-rename
              onClick={() => selectAndRequest(REQUEST_RENAME_EVENT)}
            >
              <Pencil className="size-3.5 text-muted-foreground" />
              重命名
            </ContextMenuItem>
            <ContextMenuItem
              data-context-menu-delete
              disabled={isActive || deleting}
              title={
                isActive
                  ? "使用中的主题需要先切换或还原系统默认才能删除"
                  : undefined
              }
              onClick={() => selectAndRequest(REQUEST_DELETE_EVENT)}
              className={cn(!isActive && "data-[highlighted]:text-destructive")}
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
              {isActive ? "使用中，需先恢复默认才能删除" : "删除…"}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
