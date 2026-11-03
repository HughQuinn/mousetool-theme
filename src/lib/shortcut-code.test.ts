import assert from "node:assert/strict";
import { test } from "node:test";

import { shortcutCodeOf } from "./shortcut-code.ts";

test("有物理键位码时原样返回", () => {
  assert.equal(shortcutCodeOf({ code: "KeyK", key: "k" }), "KeyK");
  assert.equal(shortcutCodeOf({ code: "Digit2", key: "2" }), "Digit2");
  assert.equal(shortcutCodeOf({ code: "F5", key: "F5" }), "F5");
});

test("注入式键盘 code 为空时按 key 回退", () => {
  assert.equal(shortcutCodeOf({ code: "", key: "k" }), "KeyK");
  assert.equal(shortcutCodeOf({ code: "", key: "K" }), "KeyK");
  assert.equal(shortcutCodeOf({ code: "", key: "o" }), "KeyO");
  assert.equal(shortcutCodeOf({ code: "", key: "f" }), "KeyF");
  assert.equal(shortcutCodeOf({ code: "", key: "4" }), "Digit4");
});

test("code 为空且 key 不在快捷键清单内时返回空串", () => {
  assert.equal(shortcutCodeOf({ code: "", key: "Enter" }), "");
  assert.equal(shortcutCodeOf({ code: "", key: "!" }), "");
});
