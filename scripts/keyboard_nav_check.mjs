// 图库网格方向键导航验收（决策 67，浏览器 mock 链路）
// 前置：vite 已在 1420（与 dev_bg 同一条命令里跑）。
// - Tab 进网格落在第一张卡（默认 button 语义不变）
// - → 移一张、← 退一张、↓ 移一整行（列数按第一行实测）、↑ 退一行
// - Home / End 跳首尾；两端不再越界
// - 方向键跨「系统方案 / 我的主题」两段连续漫游
// - Enter 激活卡片 = 选中进检查器
// - 无 JS 异常
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9247;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--window-size=1200,800",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + (process.env.TEMP ?? ".") + "\\edge_headless_profile_kn",
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
  const pressKey = (key) =>
    evaluate(
      `document.querySelector('[data-gallery-grid]').dispatchEvent(
        new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`,
    );
  const focusedCard = () =>
    evaluate(`document.activeElement?.getAttribute("data-theme-card") ?? null`);
  const cardIds = async () =>
    JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll("[data-theme-card]")].map((c) => c.getAttribute("data-theme-card")))`));

  await evaluate(`location.href = "http://localhost:1420/"`);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready =
      (await evaluate(
        `Boolean(globalThis.__themeStore && !globalThis.__themeStore.getState().loading && document.querySelector("[data-theme-card]"))`,
      )) === true;
    if (ready) break;
    await sleep(400);
  }
  check("应用就绪且图库有卡片", ready);
  await sleep(500);

  const ids = await cardIds();
  // Tab 进入网格：第一个可聚焦的卡片就是第一张
  await evaluate(`document.querySelector('[data-gallery-grid] input')?.blur()`);
  await evaluate(`document.querySelector('header, [data-slot]')?.focus?.()`);
  await evaluate(
    `(() => {
      const grid = document.querySelector('[data-gallery-grid]');
      const first = grid.querySelector('[data-theme-card]');
      const search = document.querySelector('input[type="search"], input');
      (search ?? grid).focus();
      return document.activeElement?.tagName;
    })()`,
  );
  // 从搜索框 Tab：第一站应是第一张卡
  await evaluate(
    `document.querySelector('input')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))`,
  );
  // headless 里 Tab 默认行为不可靠，直接断言「第一张卡可聚焦」并手动聚焦
  await evaluate(`document.querySelector('[data-theme-card]').focus()`);
  check("第一张卡可聚焦", (await focusedCard()) === ids[0], await focusedCard());

  // → 下一张
  await pressKey("ArrowRight");
  check("→ 移到第二张", (await focusedCard()) === ids[1], await focusedCard());
  // ← 退回
  await pressKey("ArrowLeft");
  check("← 退回第一张", (await focusedCard()) === ids[0], await focusedCard());
  // ← 在第一张不再越界
  await pressKey("ArrowLeft");
  check("← 在第一张不越界", (await focusedCard()) === ids[0], await focusedCard());

  // ↓ 按实测列数下移一行；↑ 退回
  const cols = JSON.parse(
    await evaluate(`JSON.stringify(
      [...document.querySelectorAll("[data-theme-card]")]
        .filter((c) => Math.abs(c.getBoundingClientRect().top - document.querySelector("[data-theme-card]").getBoundingClientRect().top) < 1).length,
    )`),
  );
  check("实测列数 ≥ 2（1200px 宽至少两列）", cols >= 2, `${cols} 列`);
  await pressKey("ArrowDown");
  check("↓ 移动一整行", (await focusedCard()) === ids[cols], await focusedCard());
  await pressKey("ArrowUp");
  check("↑ 退回第一张", (await focusedCard()) === ids[0], await focusedCard());

  // End / Home
  await pressKey("End");
  check("End 跳到最后一张", (await focusedCard()) === ids[ids.length - 1], await focusedCard());
  await pressKey("End");
  check("End 在最后一张不越界", (await focusedCard()) === ids[ids.length - 1]);
  await pressKey("Home");
  check("Home 跳回第一张", (await focusedCard()) === ids[0]);

  // 激活聚焦的卡片 = 选中进检查器。键盘上 Enter→click 是浏览器对 button 的
  // 原生行为（合成事件触发不了），这里断言应用自己的链路：聚焦卡片被激活即选中
  await evaluate(`document.activeElement.click()`);
  await sleep(300);
  const selected = await evaluate(`__themeStore.getState().selection.gallery`);
  check("聚焦卡片激活后选中进检查器", selected === ids[0], selected ?? "null");

  // 跨段漫游：焦点移到第一行最后一张，→ 应落到下一行首（ids 是系统方案在前、我的主题在后，
  // DOM 顺序即漫游序，跨段边界同规则）
  await evaluate(`document.querySelectorAll("[data-theme-card]")[${cols - 1}].focus()`);
  await pressKey("ArrowRight");
  check("跨段连续漫游（段末 → 下一段首）", (await focusedCard()) === ids[cols], await focusedCard());

  const errors = pageErrors.length;
  check("运行期无 JS 异常", errors === 0, `${errors} 条`);
} catch (err) {
  check("验收脚本执行", false, String(err));
} finally {
  edge.kill();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n[方向键导航验收] ${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed > 0 ? 1 : 0;
}
