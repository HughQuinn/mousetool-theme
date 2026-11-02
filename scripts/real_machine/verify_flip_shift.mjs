// 真机验证（决策 64）：「我的主题」删除行后的 FLIP 让位在真实 WebView2 窗口里生效。
//
// 隔离数据根导入两套主题 → 切到「我的主题」→ 记录保留行位置 → store.deleteThemes
// （走真实 IPC 删隔离根里的主题，不碰注册表）→ 轮询捕获 WAAPI 补间 → 断言时长与
// 曲线 → 等动画结束后断言保留行确实上移到目标位置。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  assertNoRunningInstance,
  cleanup,
  connectCdp,
  createChecker,
  killApp,
  launchApp,
  prepareRoot,
  sleep,
  waitAppReady,
  waitPageTarget,
} from "./lib.mjs";

const { appdata, pack } = prepareRoot();
const checker = createChecker();
const cursorSource = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Cursors",
  "aero_arrow.cur",
);

let app = null;
try {
  for (const name of ["flip-a", "flip-b"]) {
    const dir = join(pack, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(cursorSource, join(dir, "arrow.cur"));
  }

  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);

  const invoke = (command, args) =>
    cdp.evaluate(
      `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
    );

  const first = await invoke("import_theme", { sourcePath: join(pack, "flip-a") });
  const second = await invoke("import_theme", { sourcePath: join(pack, "flip-b") });
  const firstId = first?.theme?.id;
  checker.check("两套主题导入隔离数据根", Boolean(firstId && second?.theme?.id));

  // 直接 invoke 不经过 store，React 还不知道有新主题：重读列表让表格渲染出来
  await cdp.evaluate(`globalThis.__themeStore.getState().loadThemes()`);
  // 切到「我的主题」，等表格渲染出两行
  await cdp.evaluate(`globalThis.__themeStore.getState().setCurrentPage("mine")`);
  await sleep(600);

  const result = JSON.parse(
    await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const tbody = document.querySelector("tbody");
      const rows = [...tbody.querySelectorAll("[data-theme-row]")];
      if (rows.length !== 2) return JSON.stringify({ error: "rows=" + rows.length });
      const victim = rows[0].getAttribute("data-theme-row");
      const keeper = rows[1].getAttribute("data-theme-row");
      const before = rows[1].getBoundingClientRect().top;
      // store action 走真实 IPC；删除发生在隔离数据根，注册表不受影响
      await globalThis.__themeStore.getState().deleteThemes([victim]);
      let anim = null;
      for (let i = 0; i < 15; i++) {
        const row = document.querySelector('[data-theme-row="' + keeper + '"]');
        anim = row?.getAnimations().find((a) => a.constructor.name === "Animation") ?? null;
        if (anim) break;
        await sleep(20);
      }
      const duration = anim?.effect?.getTiming?.().duration ?? 0;
      const easing = anim?.effect?.getTiming?.().easing ?? "";
      await sleep(300);
      const after = document
        .querySelector('[data-theme-row="' + keeper + '"]')
        ?.getBoundingClientRect().top ?? -1;
      const remaining = document.querySelectorAll("[data-theme-row]").length;
      return JSON.stringify({
        hasAnim: anim !== null, duration, easing, delta: before - after, remaining,
      });
    })()`),
  );
  checker.check("删除后保留行有 FLIP 补间", result.hasAnim === true, JSON.stringify(result));
  checker.check(
    "补间 180ms 标准曲线",
    result.duration === 180 && String(result.easing).includes("cubic-bezier(0.2, 0, 0, 1)"),
    `${result.duration}ms ${result.easing}`,
  );
  checker.check(
    "保留行确实上移补位且只剩一行",
    result.delta > 0 && result.remaining === 1,
    `上移 ${Number(result.delta).toFixed(1)}px，剩 ${result.remaining} 行`,
  );

  checker.finish("FLIP 让位真机验证");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("FLIP 让位真机验证");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
