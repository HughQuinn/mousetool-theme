// 关窗询问验收（决策 57）：新装默认「每次询问」/ 设置页三选项 / simulate 弹窗
// 三按钮与「不再询问」/ 取消不改设置 / 不勾选只执行本次（设置仍 ask）/
// 勾选后最小化落盘为 tray / 勾选后退出落盘为 exit。前置：vite 已在 1420
// （与 dev_bg 同一条命令里跑）。浏览器里 hide / exit 走 mock 动作日志。
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL_TO_OPEN = process.argv[2] ?? "http://localhost:1420";
const OUT_DIR = process.env.TEMP ?? ".";
const PORT = 9248;

let PROFILE = join(OUT_DIR, "edge_close_ask_profile");
try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  PROFILE = join(OUT_DIR, `edge_close_ask_profile_${process.pid}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--window-size=1200,800",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + PROFILE,
  "about:blank",
]);

try {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {
      /* 端口未就绪 */
    }
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("找不到页面调试目标");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = err;
  });

  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.method === "Runtime.exceptionThrown") {
      pageErrors.push(data.params?.exceptionDetails?.text ?? "unknown");
    }
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok) => {
      const id = ++msgId;
      pending.set(id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const results = [];
  const assert = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? `  ${detail}` : ""}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  const evaluate = async (expression, awaitPromise = false) => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(`页面执行失败：${JSON.stringify(res.result.exceptionDetails.exception)}`);
    }
    return res.result?.result?.value;
  };

  const waitFor = async (expression, timeoutMs = 4000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true;
      await sleep(100);
    }
    return false;
  };

  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(
        `Boolean(globalThis.__settingsStore?.getState()?.settings && globalThis.__themeStore)`,
      );
      if (ready) return true;
      await sleep(250);
    }
    return false;
  };

  const patch = (expression) => evaluate(expression, true);

  await send("Page.navigate", { url: URL_TO_OPEN });
  await sleep(800);
  await waitReady();

  const dialogOpen = `Boolean(document.querySelector('[data-close-ask-dialog]'))`;
  const dialogGone = `!document.querySelector('[data-close-ask-dialog]')`;
  const behavior = `__settingsStore.getState().settings?.close_behavior`;
  const actions = `JSON.stringify(globalThis.__closeAsk?.actions ?? [])`;
  const rememberChecked = `document.querySelector('[data-close-ask-remember] [role="checkbox"]')?.getAttribute('aria-checked')`;
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);

  // --- 1. 新装默认「每次询问」，设置页分段控件三选项且选中一致 ---
  const defaultBehavior = await evaluate(behavior);
  assert("新装默认关闭行为是每次询问", defaultBehavior === "ask", String(defaultBehavior));
  await evaluate(`__themeStore.getState().setCurrentPage("settings")`);
  await evaluate(`__themeStore.getState().setSettingsSection("general")`);
  await sleep(300);
  const segmented = await evaluate(
    `(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="关闭行为"]');
      if (!group) return null;
      const radios = [...group.querySelectorAll('[role="radio"]')];
      return JSON.stringify({
        count: radios.length,
        labels: radios.map((r) => r.textContent.trim()),
        checked: radios.find((r) => r.getAttribute("aria-checked") === "true")?.textContent.trim(),
      });
    })()`,
  );
  const seg = JSON.parse(segmented ?? "null");
  assert(
    "关闭行为分段控件三选项且默认选中每次询问",
    seg?.count === 3 &&
      seg.labels.join("/") === "每次询问/最小化到托盘/直接退出" &&
      seg.checked === "每次询问",
    segmented,
  );

  // --- 2. 模拟 Rust 的 close-ask 事件：弹窗出现，标题 / 勾选 / 三按钮齐全 ---
  await evaluate(`__closeAsk.simulate()`);
  await waitFor(dialogOpen);
  const dialogText = await evaluate(
    `document.querySelector('[data-close-ask-dialog]')?.textContent ?? ""`,
  );
  assert(
    "询问弹窗出现且说明两种去留的后果",
    dialogText.includes("关闭窗口") &&
      dialogText.includes("定时切换") &&
      dialogText.includes("退出应用会全部停止"),
    dialogText.slice(0, 60),
  );
  const buttons = await evaluate(
    `["cancel","exit","tray"].map((k) => Boolean(document.querySelector('[data-close-ask="' + k + '"]')))`,
  );
  assert("取消 / 退出应用 / 最小化到托盘三按钮存在", buttons.every(Boolean), JSON.stringify(buttons));
  assert("「不再询问」默认不勾", (await evaluate(rememberChecked)) === "false");

  // --- 3. 取消：窗口保持，设置不动 ---
  await click('[data-close-ask="cancel"]');
  assert("取消后弹窗收起", await waitFor(dialogGone));
  assert("取消不改关闭行为", (await evaluate(behavior)) === "ask", String(await evaluate(behavior)));
  assert("动作日志记了 cancel", (await evaluate(actions)).includes("cancel"), await evaluate(actions));

  // --- 4. 不勾「不再询问」选最小化：只执行本次，设置仍 ask ---
  await evaluate(`__closeAsk.simulate()`);
  await waitFor(dialogOpen);
  await click('[data-close-ask="tray"]');
  assert("一次性最小化后弹窗收起", await waitFor(dialogGone));
  assert(
    "未勾选时设置仍是每次询问",
    (await evaluate(behavior)) === "ask",
    String(await evaluate(behavior)),
  );
  assert(
    "动作日志记了 hide-to-tray",
    (await evaluate(actions)).includes("hide-to-tray"),
    await evaluate(actions),
  );

  // --- 5. 勾「不再询问」选最小化：设置落盘为 tray ---
  await evaluate(`__closeAsk.simulate()`);
  await waitFor(dialogOpen);
  await click("[data-close-ask-remember]");
  assert("点勾选行后「不再询问」选中", (await evaluate(rememberChecked)) === "true");
  await click('[data-close-ask="tray"]');
  assert("勾选后最小化落盘为最小化到托盘", await waitFor(`${behavior} === "tray"`));
  assert("勾选后弹窗收起", await waitFor(dialogGone));

  // --- 6. 勾「不再询问」选退出：设置落盘为 exit ---
  await patch(`__settingsStore.getState().patchSettings({ close_behavior: "ask" })`);
  await evaluate(`__closeAsk.simulate()`);
  await waitFor(dialogOpen);
  await click("[data-close-ask-remember]");
  await click('[data-close-ask="exit"]');
  assert("勾选后退出落盘为直接退出", await waitFor(`${behavior} === "exit"`));
  assert("勾选后弹窗收起", await waitFor(dialogGone));
  await patch(`__settingsStore.getState().patchSettings({ close_behavior: "ask" })`);

  // --- 7. 运行期无 JS 异常 ---
  assert("运行期无 JS 异常", pageErrors.length === 0, `errors=${pageErrors.length}`);

  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT_DIR, "close_ask_page.png"), Buffer.from(png.result.data, "base64"));

  const failedCount = results.filter((ok) => !ok).length;
  console.log(`\n[关窗询问] ${results.length - failedCount}/${results.length} 通过`);
  process.exitCode = failedCount > 0 ? 1 : 0;
} finally {
  edge.kill();
}
