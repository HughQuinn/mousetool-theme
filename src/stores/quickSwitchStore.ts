import { create } from "zustand";

/**
 * Ctrl+K 快速切换面板的开关（决策 67）
 *
 * 快捷键注册在 `lib/shortcuts.ts`（组件外），面板组件在 App 挂载——
 * 两边需要一个共同的状态源；面板是任务层浮层，不进 PAGE_META / VIEWS。
 */
interface QuickSwitchStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useQuickSwitchStore = create<QuickSwitchStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
