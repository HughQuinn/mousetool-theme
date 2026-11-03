import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { actionBusyKey, useThemeStore } from "@/stores/themeStore";
import type { CursorTheme } from "@/types/theme";

/**
 * 主题描述 + 原地编辑（决策 62）
 *
 * 只在检查器头部出现；与 ThemeNameField 共用同一套 Enter/Esc/失焦约定，
 * 走同一个 rename 命令（补丁语义：只动描述时名称原样回传）。
 * 空描述显示占位文案——它是可编辑字段的入口暗示，与不可点的槽位卡性质不同。
 */
export function ThemeDescriptionField({ theme }: { theme: CursorTheme }) {
  const renameTheme = useThemeStore((s) => s.renameTheme);
  const renaming = useThemeStore((s) => Boolean(s.busy[actionBusyKey("rename", theme.id)]));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme.description);
  const draftRef = useRef(theme.description);

  // 切换主题或保存成功后，退出编辑态并同步草稿
  useEffect(() => {
    draftRef.current = theme.description;
    setDraft(theme.description);
    setEditing(false);
  }, [theme.id, theme.description]);

  const startEdit = () => {
    draftRef.current = theme.description;
    setDraft(theme.description);
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    if (renaming) return;
    const description = draftRef.current.trim();
    if (description !== theme.description) {
      void renameTheme(theme.id, theme.name, description);
    }
  };

  const cancel = () => {
    draftRef.current = theme.description;
    setDraft(theme.description);
    setEditing(false);
  };

  if (theme.is_built_in) {
    // 系统方案的描述来自注册表，不是本应用的数据，不提供编辑
    return theme.description ? (
      <p className="truncate text-2xs text-muted-foreground">{theme.description}</p>
    ) : null;
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        maxLength={200}
        aria-label="主题描述"
        placeholder="一句话描述这个主题（可留空）"
        className="h-6 min-w-0 text-2xs"
        onChange={(e) => {
          draftRef.current = e.currentTarget.value;
          setDraft(e.currentTarget.value);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn(
          "truncate text-2xs",
          theme.description ? "text-muted-foreground" : "text-muted-foreground/50",
        )}
      >
        {theme.description || "添加描述…"}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={theme.description ? "编辑描述" : "添加描述"}
        aria-busy={renaming}
        title={renaming ? "保存中…" : theme.description ? "编辑描述" : "添加描述"}
        onClick={startEdit}
        disabled={renaming}
        className="shrink-0 text-muted-foreground opacity-60 transition-opacity duration-(--motion-fast) ease-standard hover:opacity-100"
      >
        <Pencil />
      </Button>
    </span>
  );
}
