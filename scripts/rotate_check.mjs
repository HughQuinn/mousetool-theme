// 定时轮换主题验收（决策 55，浏览器 mock 链路）
// 前置：vite 已在 1420（与 dev_bg 同一条命令里跑）。
// - 设置卡片出现：开关 + 间隔下拉 + 状态行；「我的主题」足够时给出候选说明
// - 打开开关 / 改间隔走 mock 设置（localStorage 同款持久化）
// - 让位规则：定时切换或跟随系统开启时状态行点名让位，强制触发也不切
// - 强制触发一轮（dev 调试钩子）应用下一套「我的主题」，连触两次循环推进
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
  "--user-data-dir=" + (process.env.TEMP ?? ".") + "\\edge_rotate_profile",
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
      msgId += 1;
      pending.set(msgId, ok);
      ws.send(JSON.stringify({ id: msgId, method, params }));
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
  const clickNav = async (label) => {
    const ok = await evaluate(`(() => {
      const btn = [...document.querySelectorAll("nav button")].find(b => b.textContent.trim().startsWith("${label}"));
      btn?.click();
      return Boolean(btn);
    })()`);
    await sleep(500);
    return ok;
  };
  const patch = async (fields) => {
    await evaluate(
      `globalThis.__settingsStore.getState().patchSettings(${JSON.stringify(fields)})`,
    );
    await sleep(300);
  };
  const statusText = () =>
    evaluate(`document.querySelector("[data-rotate-status]")?.textContent ?? ""`);

  await send("Page.enable");
  await send("Page.navigate", { url: "http://localhost:1420" });
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    if (
      await evaluate(
        `Boolean(window.__themeStore && window.__settingsStore && document.querySelector("[data-rotate-select]"))`,
      ).catch(() => false)
    )
      break;
  }

  check("进入设置", await clickNav("设置"));
  await sleep(300);

  // ---- 卡片结构与缺省态 ----
  const ui = JSON.parse(
    await evaluate(
      `JSON.stringify({
        select: Boolean(document.querySelector("[data-rotate-select]")),
        status: document.querySelector("[data-rotate-status]")?.textContent ?? "",
        disabled: document.querySelector("[data-rotate-select]")?.disabled ?? null,
        value: document.querySelector("[data-rotate-select]")?.value ?? null,
      })`,
    ),
  );
  check("轮换卡片出现（开关 + 间隔下拉 + 状态行）", ui.select, JSON.stringify(ui));
  check("缺省关闭时间隔下拉禁用、档位默认 60 分钟", ui.disabled === true && ui.value === "60", JSON.stringify(ui));
  check(
    "「我的主题」足够时说明候选口径",
    (await statusText()).includes("按名称顺序循环应用"),
    await statusText(),
  );

  // ---- 打开开关 / 改间隔 ----
  await patch({ rotate_enabled: true, rotate_interval_minutes: 240 });
  const afterOn = JSON.parse(
    await evaluate(
      `JSON.stringify({
        enabled: globalThis.__settingsStore.getState().settings.rotate_enabled,
        minutes: globalThis.__settingsStore.getState().settings.rotate_interval_minutes,
        disabled: document.querySelector("[data-rotate-select]").disabled,
        value: document.querySelector("[data-rotate-select]").value,
      })`,
    ),
  );
  check("开关打开且间隔改到 240 分钟", afterOn.enabled && afterOn.minutes === 240 && !afterOn.disabled && afterOn.value === "240", JSON.stringify(afterOn));

  // ---- 让位规则（决策 55）----
  await patch({ schedule_switch_enabled: true });
  check(
    "定时切换开启时状态行点名让位",
    (await statusText()).includes("让位"),
    await statusText(),
  );
  const activeBefore = await evaluate(`globalThis.__themeStore.getState().activeThemeId`);
  await evaluate(`globalThis.__themeRotateTick && globalThis.__themeRotateTick()`);
  await sleep(500);
  check(
    "让位期间强制触发也不切主题",
    (await evaluate(`globalThis.__themeStore.getState().activeThemeId`)) === activeBefore,
    `before=${activeBefore}`,
  );
  await patch({ schedule_switch_enabled: false });

  // ---- 强制触发一轮：应用下一套「我的主题」并循环推进 ----
  await evaluate(`globalThis.__themeRotateTick && globalThis.__themeRotateTick()`);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (
      await evaluate(
        `globalThis.__themeStore.getState().activeThemeId !== ${JSON.stringify(activeBefore)}`,
      )
    )
      break;
  }
  const firstTick = JSON.parse(
    await evaluate(
      `(() => {
        const s = globalThis.__themeStore.getState();
        const active = s.themes.find(t => t.id === s.activeThemeId);
        return JSON.stringify({ id: s.activeThemeId, mine: active ? !active.is_built_in : false, name: active?.name ?? null });
      })()`,
    ),
  );
  check("轮换触发后应用了一我的主题", firstTick.mine && firstTick.id !== activeBefore, JSON.stringify(firstTick));

  const secondActive = await evaluate(`globalThis.__themeStore.getState().activeThemeId`);
  await evaluate(`globalThis.__themeRotateTick && globalThis.__themeRotateTick()`);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (
      await evaluate(
        `globalThis.__themeStore.getState().activeThemeId !== ${JSON.stringify(secondActive)}`,
      )
    )
      break;
  }
  const third = await evaluate(`globalThis.__themeStore.getState().activeThemeId`);
  check("再触发一轮循环推进到下一套", third !== secondActive, `${secondActive} -> ${third}`);

  // 收尾：关掉开关，别让 mock 的 localStorage 状态泄漏到其它断言
  await patch({ rotate_enabled: false });

  const errors = pageErrors.length;
  check("运行期无 JS 异常", errors === 0, `${errors} 条`);
} catch (err) {
  check("验收脚本执行", false, String(err));
} finally {
  edge.kill();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n[定时轮换主题] ${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed > 0 ? 1 : 0;
}
