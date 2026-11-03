/**
 * 从键盘事件解析物理键位码（决策 67 的快捷键分发用）
 *
 * 正常物理键盘事件同时带 `code`（KeyK / Digit1…）。但注入式键盘
 * （PowerShell SendKeys、屏幕键盘、部分辅助工具）只带 `key`、`code` 为空——
 * 只认 `code` 会让所有应用内快捷键在这类输入下集体失灵。`code` 优先，
 * 缺失时按 `key` 回退（小写后匹配），保持与浏览器 mock 相同的分发结果。
 */
const CODE_BY_KEY: Record<string, string> = {
  "1": "Digit1",
  "2": "Digit2",
  "3": "Digit3",
  "4": "Digit4",
  k: "KeyK",
  o: "KeyO",
  f: "KeyF",
};

export function shortcutCodeOf(event: { code: string; key: string }): string {
  if (event.code) return event.code;
  return CODE_BY_KEY[event.key.toLowerCase()] ?? "";
}
