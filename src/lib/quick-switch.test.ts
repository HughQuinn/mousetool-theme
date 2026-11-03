import assert from "node:assert/strict";
import { test } from "node:test";

import { quickSwitchItems } from "./quick-switch.ts";
import type { CursorTheme } from "../types/theme";

function theme(id: string, name: string, isBuiltIn = false): CursorTheme {
  return {
    id,
    name,
    is_built_in: isBuiltIn,
    description: "",
    cursors: [],
    updated_at: "",
  } as unknown as CursorTheme;
}

// 名称用 ASCII：localeCompare 的 zh 拼音序在 WebView2 里有、Node 测试环境没有，
// 断言只锁定跨环境稳定的部分（分组先后、包含过滤、使用中置顶）
const themes = [
  theme("sys-b", "Windows 默认", true),
  theme("mine-b", "beta"),
  theme("mine-a", "alpha"),
  theme("sys-a", "firefly", true),
];

test("空词列出全部：我的主题在前（名称序）、系统方案在后（名称序）", () => {
  const items = quickSwitchItems(themes, "", null);
  assert.deepEqual(
    items.map((item) => item.id),
    ["mine-a", "mine-b", "sys-a", "sys-b"],
  );
});

test("关键词大小写不敏感过滤名称", () => {
  const items = quickSwitchItems(themes, "FIREFLY", null);
  assert.deepEqual(items.map((item) => item.id), ["sys-a"]);
});

test("关键词前后空格不影响匹配，无命中返回空", () => {
  assert.deepEqual(quickSwitchItems(themes, " alpha ", null).map((i) => i.id), ["mine-a"]);
  assert.deepEqual(quickSwitchItems(themes, "不存在", null), []);
});

test("使用中的主题排最前", () => {
  const items = quickSwitchItems(themes, "", "sys-a");
  assert.equal(items[0].id, "sys-a");
  assert.equal(items[0].isActive, true);
  // 其余相对顺序不变
  assert.deepEqual(items.slice(1).map((i) => i.id), ["mine-a", "mine-b", "sys-b"]);
});

test("未选中时 isActive 全为 false", () => {
  assert.ok(quickSwitchItems(themes, "", null).every((item) => !item.isActive));
});
