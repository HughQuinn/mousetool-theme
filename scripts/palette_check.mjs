// Ctrl+K 快速切换面板验收（决策 67，浏览器 mock 链路）
// 前置：vite 已在 1420（与 dev_bg 同一条命令里跑）。
// - Ctrl+K 拉起面板；再按一次关闭（toggle）；Esc 也能关
// - 候选 = 我的主题在前、系统方案在后，使用中置顶带徽标
// - 输入即过滤；↑↓ 移动高亮（aria-activedescendant）；Enter 应用并关面板
// - 底部「还原系统默认光标」动作行可用
// - 设置关掉快捷键开关后 Ctrl+K 失效
// - 无 JS 异常
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9249;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 独立且每轮新建的 profile：脚本末段会把「快捷键开关」关掉并持久化，
// 共用固定 profile 会让下一轮从「已禁用」起步、Ctrl+K 集体失灵
const PROFILE = join(process.env.TEMP ?? ".", `edge_qs_profile_${Date.now()}`);

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--window-size=1200,800",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + PROFILE,
  "about:blank",
]);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? `  ${detail}` : ""}`);
};

try {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = err;
  });
  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.method === "Runtime.exceptionThrown") {
      pageErrors.push(data.params?.exceptionDetails?.exception?.description ?? "?");
    }
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok) => {
      const id = ++msgId;
      pending.set(id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? "页面内执行失败");
    }
    return res.result?.result?.value;
  };
  const pressCtrlK = () =>
    evaluate(
      `window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", ctrlKey: true, bubbles: true }))`,
    );
  const paletteOpen = () =>
    evaluate(`Boolean(document.querySelector('[data-slot="quick-switcher"]'))`);
  const type = (text) =>
    evaluate(
      `(() => {
        const input = document.querySelector("[data-quick-switch-input]");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );

  await evaluate(`location.href = "http://localhost:1420/"`);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready =
      (await evaluate(
        `Boolean(globalThis.__themeStore && !globalThis.__themeStore.getState().loading)`,
      )) === true;
    if (ready) break;
    await sleep(400);
  }
  check("应用就绪", ready);
  await sleep(500);

  // Ctrl+K 打开
  await pressCtrlK();
  await sleep(400);
  check("Ctrl+K 拉起面板", (await paletteOpen()) === true);

  const rows = JSON.parse(
    await evaluate(`JSON.stringify({
      input: document.querySelector("[data-quick-switch-input]")?.getAttribute("aria-label"),
      listbox: Boolean(document.querySelector('[role="listbox"]')),
      options: [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()),
      active: document.querySelector('[role="option"][aria-selected="true"]')?.textContent.trim() ?? "",
      footer: document.querySelector('[data-slot="quick-switcher"]')?.textContent.includes("Enter 应用") ?? false,
    })`),
  );
  check(
    "面板结构就位（输入框 / 候选 / 动作行 / 操作提示）",
    rows.input === "搜索主题" && rows.listbox && rows.options.length >= 4 && rows.footer,
    JSON.stringify(rows),
  );
  check(
    "候选排序：我的主题在前、系统方案在后、还原动作为末行",
    rows.options.at(-1)?.includes("还原系统默认光标") &&
      rows.options.slice(0, -1).join("|").includes("我的主题") &&
      rows.options.slice(0, -1).join("|").includes("系统方案"),
    JSON.stringify(rows.options),
  );

  // 输入过滤
  await type("Neon");
  await sleep(300);
  const filtered = JSON.parse(
    await evaluate(`JSON.stringify({
      options: [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()),
      firstActive: document.querySelector('[role="option"][aria-selected="true"]')?.textContent.trim() ?? "",
    })`),
  );
  check(
    "输入即过滤且高亮回到第一项",
    filtered.options.length === 2 && filtered.options[0].includes("Neon Night") && filtered.firstActive.includes("Neon Night") && filtered.options[1].includes("还原系统默认光标"),
    JSON.stringify(filtered),
  );

  // ↑↓ 高亮移动
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))`,
  );
  await sleep(150);
  const secondActive = await evaluate(
    `document.getElementById("qs-item-1")?.getAttribute("aria-selected")`,
  );
  check("↓ 高亮移到第二项", secondActive === "true");
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }))`,
  );
  await sleep(150);

  // Enter 应用：面板关闭、状态翻转（mock 安全）
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`,
  );
  await sleep(500);
  const applied = JSON.parse(
    await evaluate(`JSON.stringify({
      active: __themeStore.getState().activeThemeId,
      closed: !document.querySelector('[data-slot="quick-switcher"]'),
    })`),
  );
  check(
    "Enter 应用并关面板",
    applied.active !== null && applied.closed,
    JSON.stringify(applied),
  );

  // 再开：搜索词被重置；使用中的主题排最前
  await pressCtrlK();
  await sleep(400);
  const reopened = JSON.parse(
    await evaluate(`JSON.stringify({
      queryCleared: document.querySelector("[data-quick-switch-input]").value === "",
      firstOption: document.querySelector('[role="option"]')?.textContent.trim() ?? "",
    })`),
  );
  check(
    "重开重置且使用中置顶",
    reopened.queryCleared && reopened.firstOption.includes("使用中"),
    JSON.stringify(reopened),
  );

  // 还原动作行：↓ 到底 → Enter
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }))`,
  );
  // End 不是面板键，手动把高亮推到动作行（候选数 + 1）
  await evaluate(
    `(() => {
      const input = document.querySelector("[data-quick-switch-input]");
      const count = document.querySelectorAll('[role="option"]').length;
      for (let i = 0; i < count; i++) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      }
      return document.getElementById("qs-item-" + (count - 1))?.getAttribute("aria-selected");
    })()`,
  );
  await sleep(150);
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`,
  );
  await sleep(500);
  const restored = JSON.parse(
    await evaluate(`JSON.stringify({
      active: __themeStore.getState().activeThemeId,
      closed: !document.querySelector('[data-slot="quick-switcher"]'),
    })`),
  );
  check(
    "动作行「还原系统默认光标」生效",
    restored.active === null && restored.closed,
    JSON.stringify(restored),
  );

  // Esc 关闭
  await pressCtrlK();
  await sleep(300);
  await evaluate(
    `document.querySelector("[data-quick-switch-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`,
  );
  await sleep(400);
  check("Esc 关闭面板", (await paletteOpen()) === false);

  // 关闭快捷键开关后 Ctrl+K 失效（设置 → 快捷键 → 「启用应用内快捷键」）
  await evaluate(`__themeStore.getState().setCurrentPage("settings")`);
  await sleep(400);
  await evaluate(`__themeStore.getState().setSettingsSection("shortcuts")`);
  await sleep(400);
  const toggled = await evaluate(
    `(() => {
      const sw = [...document.querySelectorAll("[role='switch']")].find((el) =>
        el.getAttribute("aria-label")?.includes("快捷键") || el.closest("div")?.textContent.includes("启用应用内快捷键"),
      );
      sw?.click();
      return Boolean(sw);
    })()`,
  );
  await sleep(400);
  await evaluate(`__themeStore.getState().setCurrentPage("gallery")`);
  await sleep(300);
  await pressCtrlK();
  await sleep(400);
  const closedAfterDisable = await evaluate(
    `!document.querySelector('[data-slot="quick-switcher"]')`,
  );
  check(
    "快捷键开关关闭后 Ctrl+K 失效",
    toggled && closedAfterDisable,
    `toggled=${toggled}`,
  );

  const errors = pageErrors.length;
  check("运行期无 JS 异常", errors === 0, `${errors} 条`);
} catch (err) {
  check("验收脚本执行", false, String(err));
} finally {
  edge.kill();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n[快速切换面板验收] ${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed > 0 ? 1 : 0;
}
