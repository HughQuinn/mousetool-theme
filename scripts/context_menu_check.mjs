// 主题卡右键菜单验收（决策 65，浏览器 mock 链路）
// 前置：vite 已在 1420（与 dev_bg 同一条命令里跑）。
// - 图库卡右键 → 菜单出现（role=menu），项目：应用 / 导出 / 重命名 / 删除
// - 点「应用」→ 菜单关、activeThemeId 变、「使用中」徽标出现
// - 使用中主题的菜单：没有「应用」项、删除项禁用并说明原因
// - 系统方案菜单：只有应用 / 导出，无重命名与删除
// - 「重命名」→ 检查器名称进入编辑态；「删除」→ 检查器确认框打开
// - Esc 关闭菜单；「我的主题」表格行右键同样出菜单
// - 无 JS 异常
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9245;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--window-size=1200,800",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + (process.env.TEMP ?? ".") + "\\edge_headless_profile_cm",
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
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      if (
        await evaluate(
          `Boolean(globalThis.__themeStore && !globalThis.__themeStore.getState().loading)`,
        )
      )
        return true;
      await sleep(400);
    }
    return false;
  };

  const openMenuOn = async (selector) =>
    evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true,
          clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
        }));
        return true;
      })()`,
    );
  const menuOpen = () =>
    evaluate(`Boolean(document.querySelector('[data-slot="context-menu-content"]'))`);
  const closeMenu = async () => {
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(400);
  };

  await evaluate(`location.href = "http://localhost:1420/"`);
  check("应用就绪", await waitReady());
  await sleep(800);

  const userThemeId = await evaluate(
    `__themeStore.getState().themes.find((t) => !t.is_built_in)?.id`,
  );
  const sysThemeId = await evaluate(
    `__themeStore.getState().themes.find((t) => t.is_built_in)?.id`,
  );

  // ── 图库卡：右键出菜单，四项齐全 ──
  check("右键用户主题卡打开菜单", await openMenuOn(`[data-theme-card="${userThemeId}"]`) && (await sleep(300), await menuOpen()));
  const items = JSON.parse(
    await evaluate(`JSON.stringify({
      role: document.querySelector('[data-slot="context-menu-content"]')?.getAttribute("role"),
      apply: Boolean(document.querySelector("[data-context-menu-apply]")),
      export: Boolean(document.querySelector("[data-context-menu-export]")),
      rename: Boolean(document.querySelector("[data-context-menu-rename]")),
      del: Boolean(document.querySelector("[data-context-menu-delete]")),
      label: document.querySelector('[data-slot="context-menu-content"]')?.getAttribute("aria-label") ?? "",
    })`),
  );
  check(
    "菜单四项齐全且带可读名",
    items.role === "menu" && items.apply && items.export && items.rename && items.del && items.label.includes("操作"),
    JSON.stringify(items),
  );

  // 点「应用」：菜单关闭、状态翻转、徽标出现（mock 不碰真实系统）
  await evaluate(`document.querySelector("[data-context-menu-apply]").click()`);
  await sleep(500);
  const applied = JSON.parse(
    await evaluate(`JSON.stringify({
      active: __themeStore.getState().activeThemeId,
      menuClosed: !document.querySelector('[data-slot="context-menu-content"]'),
      badge: Boolean(document.querySelector('[data-theme-card="' + __themeStore.getState().activeThemeId + '"] .enter-fade')),
    })`),
  );
  check(
    "点「应用」生效：菜单关、状态徽标出现",
    applied.active === userThemeId && applied.menuClosed && applied.badge,
    JSON.stringify(applied),
  );

  // ── 使用中的主题：无「应用」项，删除禁用 ──
  await openMenuOn(`[data-theme-card="${userThemeId}"]`);
  await sleep(300);
  const activeState = JSON.parse(
    await evaluate(`JSON.stringify({
      apply: Boolean(document.querySelector("[data-context-menu-apply]")),
      delDisabled: document.querySelector("[data-context-menu-delete]")?.getAttribute("aria-disabled"),
      title: document.querySelector("[data-context-menu-delete]")?.getAttribute("title") ?? "",
    })`),
  );
  check(
    "使用中主题：无应用项、删除禁用并说明",
    activeState.apply === false && activeState.delDisabled === "true" && activeState.title.includes("使用中"),
    JSON.stringify(activeState),
  );
  await closeMenu();

  // ── 系统方案：只有应用 / 导出 ──
  await openMenuOn(`[data-theme-card="${sysThemeId}"]`);
  await sleep(300);
  const sysItems = JSON.parse(
    await evaluate(`JSON.stringify({
      apply: Boolean(document.querySelector("[data-context-menu-apply]")),
      export: Boolean(document.querySelector("[data-context-menu-export]")),
      rename: Boolean(document.querySelector("[data-context-menu-rename]")),
      del: Boolean(document.querySelector("[data-context-menu-delete]")),
    })`),
  );
  check(
    "系统方案菜单只有应用 / 导出",
    sysItems.apply && sysItems.export && !sysItems.rename && !sysItems.del,
    JSON.stringify(sysItems),
  );

  // ── Esc 关闭 ──
  await evaluate(
    `document.querySelector('[data-slot="context-menu-content"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );
  await sleep(400);
  check("Esc 关闭菜单", (await menuOpen()) === false);

  // ── 重命名 → 检查器进入编辑态 ──
  await openMenuOn(`[data-theme-card="${userThemeId}"]`);
  await sleep(300);
  await evaluate(`document.querySelector("[data-context-menu-rename]").click()`);
  await sleep(400);
  const renameEdit = await evaluate(
    `Boolean(document.querySelector('[aria-label="主题详情"] input[aria-label="主题名称"]'))`,
  );
  check("「重命名」让检查器名称进入编辑态", renameEdit === true);
  await evaluate(
    `document.querySelector('[aria-label="主题详情"] input[aria-label="主题名称"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );
  await sleep(200);

  // ── 删除 → 检查器确认框打开 ──
  await openMenuOn(`[data-theme-card="${sysThemeId === userThemeId ? "" : sysThemeId}"]`);
  await sleep(200);
  await openMenuOn(`[data-theme-card="${userThemeId}"]`);
  await sleep(300);
  const delDisabledNow = await evaluate(
    `document.querySelector("[data-context-menu-delete]")?.getAttribute("aria-disabled")`,
  );
  if (delDisabledNow === "true") {
    // 刚才把这套设成了使用中：先还原默认再验删除路径
    await closeMenu();
    await evaluate(`__themeStore.getState().restoreDefault()`);
    await sleep(400);
    await openMenuOn(`[data-theme-card="${userThemeId}"]`);
    await sleep(300);
  }
  await evaluate(`document.querySelector("[data-context-menu-delete]").click()`);
  await sleep(500);
  const deleteDialog = await evaluate(
    `Boolean(document.querySelector("[role='alertdialog'], [data-slot='alert-dialog-popup']")) || document.body.textContent.includes("移入回收站")`,
  );
  check("「删除」打开检查器确认框", deleteDialog === true);
  // 取消确认框
  await evaluate(
    `(() => {
      const cancel = [...document.querySelectorAll("button")].find((b) => ["取消", "先不删"].includes(b.textContent.trim()));
      cancel?.click();
      return Boolean(cancel);
    })()`,
  );
  await sleep(400);

  // ── 「我的主题」行右键 ──
  await evaluate(`__themeStore.getState().setCurrentPage("mine")`);
  await sleep(400);
  check("表格行右键打开菜单", await openMenuOn(`[data-theme-row="${userThemeId}"]`) && (await sleep(300), await menuOpen()));
  await closeMenu();

  const errors = pageErrors.length;
  check("运行期无 JS 异常", errors === 0, `${errors} 条`);
} catch (err) {
  check("验收脚本执行", false, String(err));
} finally {
  edge.kill();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n[右键菜单验收] ${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed > 0 ? 1 : 0;
}
