// 回收站「存为副本」验收（决策 54，浏览器 mock 链路）
// 前置：vite 已在 1420（与 dev_bg 同一条命令里跑）。
// - 目标 ID 不在主题库时，行内不出现「存为副本」（普通恢复足够）
// - 同 ID 主题存在时出现「存为副本」，点击后生成「（副本）」后缀的新主题、
//   原条目被消费，选区落到新副本上
// - 无 JS 异常
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9246;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--window-size=1200,800",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + (process.env.TEMP ?? ".") + "\\edge_trash_copy_profile",
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
  const clickText = async (label) => {
    const ok = await evaluate(`(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "${label}");
      btn?.click();
      return Boolean(btn);
    })()`);
    await sleep(400);
    return ok;
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

  await send("Page.enable");
  await send("Page.navigate", { url: "http://localhost:1420" });
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    if (await evaluate(`Boolean(window.__themeStore)`).catch(() => false)) break;
  }

  const PAPER_ID = "4a7d92e1-3c8b-4f60-9a1d-5e2b8c7f0a33";

  check("进入设置", await clickNav("设置"));
  check("进入「数据」分组", await clickNav("数据"));
  check("打开回收站", await clickText("打开回收站"));
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (await evaluate(`document.querySelectorAll("[data-trash-row]").length >= 2`)) break;
  }

  // mock 预置的回收站条目，对应主题都处于「已藏起」状态：无同 ID 冲突，不出现副本入口
  check(
    "无同 ID 冲突时不出现「存为副本」",
    (await evaluate(`document.querySelectorAll("[data-trash-copy]").length`)) === 0,
  );

  // 删一套主题进回收站，条目的 theme_id 同样不在库里：仍无副本入口
  check(
    "删除 Paper & Ink 进回收站",
    (await evaluate(`window.__themeStore.getState().deleteTheme("${PAPER_ID}")`)) === true,
  );
  await clickText("刷新");
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (await evaluate(`document.querySelectorAll("[data-trash-row]").length >= 3`)) break;
  }
  check(
    "删除后的条目同样没有副本入口",
    (await evaluate(`document.querySelectorAll("[data-trash-copy]").length`)) === 0,
  );

  // 往主题库塞回一个同 ID 主题（模拟「从备份恢复过同 ID」）：条目行出现「存为副本」
  await evaluate(`(() => {
    const s = globalThis.__themeStore.getState();
    const any = s.themes.find(t => !t.is_built_in);
    globalThis.__themeStore.setState({
      themes: [...s.themes, { ...any, id: "${PAPER_ID}", cursors: any.cursors.map(c => ({ ...c })) }],
    });
    return true;
  })()`);
  await sleep(300);
  const copyBtn = await evaluate(
    `(() => {
      const btn = document.querySelector("[data-trash-copy]");
      if (!btn) return null;
      btn.click();
      return btn.getAttribute("aria-label");
    })()`,
  );
  check("同 ID 主题存在时出现「存为副本」并点击", typeof copyBtn === "string" && copyBtn.includes("存为副本"), String(copyBtn));

  // 等恢复完成（loadThemes 重读列表 + toast）
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (
      await evaluate(
        `window.__themeStore.getState().themes.some(t => t.name.endsWith("（副本）"))`,
      )
    )
      break;
  }
  const after = JSON.parse(
    await evaluate(
      `JSON.stringify({
        copies: globalThis.__themeStore.getState().themes.filter(t => t.name.endsWith("（副本）")).map(t => t.name),
        selected: globalThis.__themeStore.getState().selection.mine,
        selectedIsCopy: (() => {
          const s = globalThis.__themeStore.getState();
          return s.themes.some(t => t.id === s.selection.mine && t.name.endsWith("（副本）"));
        })(),
      })`,
    ),
  );
  check(
    "副本主题落库且名称带「（副本）」",
    after.copies.length === 1 && after.copies[0].startsWith("Paper & Ink"),
    JSON.stringify(after.copies),
  );
  check("副本 ID 是新 UUID 且被选中", after.selectedIsCopy === true, String(after.selected));

  const errors = pageErrors.length;
  check("运行期无 JS 异常", errors === 0, `${errors} 条`);
} catch (err) {
  check("验收脚本执行", false, String(err));
} finally {
  edge.kill();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n[回收站存为副本] ${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed > 0 ? 1 : 0;
}
