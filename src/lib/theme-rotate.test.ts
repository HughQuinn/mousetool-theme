import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pickRotationTarget,
  rotationCandidates,
  rotationYields,
} from "./theme-rotate-core.ts";
import type { CursorTheme } from "../types/theme.ts";

function theme(overrides: Partial<CursorTheme> & { id: string; name: string }): CursorTheme {
  return {
    description: "",
    created_at: "2026-11-01 08:00",
    updated_at: "2026-11-01 08:00",
    is_built_in: false,
    cursors: [],
    ...overrides,
  };
}

const A = theme({ id: "a", name: "晨光" });
const B = theme({ id: "b", name: "夜色" });
const C = theme({ id: "c", name: "深蓝" });
const SYS = theme({ id: "sys-1", name: "Windows 默认", is_built_in: true });

test("pickRotationTarget 按名称顺序循环推进", () => {
  const themes = [C, SYS, B, A];
  // 候选按名称（拼音）排序：晨光(chen) < 深蓝(shen) < 夜色(ye)，系统方案不参与
  assert.deepEqual(rotationCandidates(themes).map((t) => t.id), ["a", "c", "b"]);

  assert.equal(pickRotationTarget(themes, "a"), "c", "晨光的下一位是深蓝");
  assert.equal(pickRotationTarget(themes, "c"), "b", "深蓝的下一位是夜色");
  assert.equal(pickRotationTarget(themes, "b"), "a", "夜色转回队首");
});

test("pickRotationTarget 当前不在候选里时从头开始", () => {
  const themes = [B, A];
  assert.equal(pickRotationTarget(themes, null), "a", "还原默认后从队首开始");
  assert.equal(pickRotationTarget(themes, "sys-1"), "a", "用着系统方案也从队首开始");
  assert.equal(pickRotationTarget(themes, "gone"), "a", "刚被删的主题不挡队首");
});

test("pickRotationTarget 候选不足两套时没有轮换意义", () => {
  assert.equal(pickRotationTarget([], null), null);
  assert.equal(pickRotationTarget([A], null), null, "只有一套换无可换");
  assert.equal(pickRotationTarget([A, SYS], "a"), null, "系统方案不算候选");
});

test("pickRotationTarget 重名主题按 id 兜底保持稳定", () => {
  const dup1 = theme({ id: "dup-b", name: "昼色" });
  const dup2 = theme({ id: "dup-a", name: "昼色" });
  const themes = [dup1, dup2, A];
  // 晨光(chen) < 昼色(zhou)；重名之间按 id 排序，顺序不抖动
  assert.deepEqual(
    rotationCandidates(themes).map((t) => t.id),
    ["a", "dup-a", "dup-b"],
  );
  assert.equal(pickRotationTarget(themes, "a"), "dup-a");
  assert.equal(pickRotationTarget(themes, "dup-a"), "dup-b");
  assert.equal(pickRotationTarget(themes, "dup-b"), "a", "末位转回队首");
});

test("rotationYields 其它自动行为开启时轮换让位（决策 55）", () => {
  assert.equal(rotationYields({ auto_switch_enabled: false, schedule_switch_enabled: false }), false);
  assert.equal(
    rotationYields({ auto_switch_enabled: true, schedule_switch_enabled: false }),
    true,
    "跟随系统优先",
  );
  assert.equal(
    rotationYields({ auto_switch_enabled: false, schedule_switch_enabled: true }),
    true,
    "定时切换优先",
  );
});
