import { listen } from "@tauri-apps/api/event";

import { inTauri } from "@/services/theme";

/**
 * 关窗询问（决策 57）的前端桥
 *
 * Rust 侧拦下主窗口的 CloseRequested 后发 `close-ask` 事件，这里把事件接到
 * 弹窗组件（`components/layout/CloseAskDialog.tsx`）；用户选了什么由组件调
 * services 执行。浏览器里没有真实关窗，验收脚本走 DEV-only 的 `__closeAsk`
 * 模拟事件、读动作日志。
 */

let onAsk: (() => void) | null = null;

/** 订阅 Rust 的关窗询问事件；返回解绑函数 */
export function initCloseAsk(callback: () => void): () => void {
  onAsk = callback;
  if (!inTauri) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen("close-ask", () => callback()).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
    onAsk = null;
  };
}

type DevCloseAskAction = "cancel" | "hide-to-tray" | "exit";

const devActions: DevCloseAskAction[] = [];

/** 记录关窗询问里实际执行的动作（浏览器验收脚本读；真机不记） */
export function noteDevCloseAskAction(action: DevCloseAskAction): void {
  if (import.meta.env.DEV) devActions.push(action);
}

// 仅开发环境：close_ask_check.mjs 需要模拟 Rust 的关窗事件与读取动作日志
if (import.meta.env.DEV) {
  (globalThis as unknown as { __closeAsk?: unknown }).__closeAsk = {
    simulate: () => onAsk?.(),
    actions: devActions,
  };
}
