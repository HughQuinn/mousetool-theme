// 真机验证：AniPlayer 在窗口失焦后停表、重新聚焦后续播。
//
// 浏览器 mock 只能合成 blur 事件（只证明监听挂上了），这里用真实 OS 焦点
// 迁移（激活桌面 Progman 把焦点从应用窗口夺走）验证事件链真正生效：
// drawImage 计数 → 失焦冻结 → 聚焦恢复。
// 隔离 LOCALAPPDATA 数据根，只读系统方案预览，不碰注册表与用户主题。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { execFileSync } from "node:child_process";

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

const { appdata } = prepareRoot();
const checker = createChecker();

/** 用 PowerShell 的 Shell.Application 把前台焦点切到指定窗口（标题前缀匹配） */
function activateWindow(title) {
  const script = `
    $shell = New-Object -ComObject Shell.Application
    $shell.Windows() | Out-Null
    (New-Object -ComObject WScript.Shell).AppActivate(${JSON.stringify(title)}) | Out-Null
  `;
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "ignore",
  });
}

/** 激活桌面（Progman），夺走应用窗口的 OS 焦点 */
function focusDesktop() {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(New-Object -ComObject WScript.Shell).AppActivate('Program Manager') | Out-Null",
    ],
    { stdio: "ignore" },
  );
}

let app = null;
try {
  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);

  // 选中一个带动态光标的系统方案，让检查器挂上 AniPlayer 画布
  const picked = await cdp.evaluate(`
    (() => {
      const store = globalThis.__themeStore.getState();
      const target = store.themes.find((t) =>
        t.cursors.some((slot) => slot.file_path?.toLowerCase().endsWith(".ani")),
      );
      if (!target) return null;
      store.selectTheme(target.id);
      return { id: target.id, name: target.name };
    })()
  `);
  checker.check("找到带动态光标的方案并选中", Boolean(picked), JSON.stringify(picked));

  // 等检查器渲染出动态光标画布
  let canvasCount = 0;
  for (let i = 0; i < 20; i++) {
    canvasCount =
      (await cdp.evaluate(
        `document.querySelectorAll('[aria-label="主题详情"] canvas').length`,
      )) ?? 0;
    if (canvasCount > 0) break;
    await sleep(500);
  }
  checker.check("检查器出现动态光标画布", canvasCount > 0, `${canvasCount} 块`);

  // 挂 drawImage 计数器：只有 AniPlayer 在空闲期画 canvas
  await cdp.evaluate(`
    (() => {
      const proto = CanvasRenderingContext2D.prototype;
      const orig = proto.drawImage;
      window.__origDrawImage = orig;
      window.__draws = 0;
      proto.drawImage = function (...args) {
        window.__draws += 1;
        return orig.apply(this, args);
      };
    })()
  `);

  await sleep(800);
  const drawsBefore = await cdp.evaluate(`window.__draws`);
  checker.check("聚焦状态下动画在播放", drawsBefore > 0, `800ms 内绘制 ${drawsBefore} 帧`);

  // 真实 OS 焦点迁移：激活桌面夺走焦点
  focusDesktop();
  await sleep(300); // 等 blur 事件到达
  await cdp.evaluate(`window.__draws = 0`);
  await sleep(800);
  const drawsBlurred = await cdp.evaluate(`window.__draws`);
  checker.check("失焦后动画停表（不再绘制）", drawsBlurred === 0, `800ms 内绘制 ${drawsBlurred} 帧`);

  // 把焦点还给应用窗口，动画应续播
  activateWindow("鼠标主题工具");
  await sleep(300);
  await cdp.evaluate(`window.__draws = 0`);
  await sleep(800);
  const drawsRefocused = await cdp.evaluate(`window.__draws`);
  checker.check(
    "重新聚焦后动画续播",
    drawsRefocused > 0,
    `800ms 内绘制 ${drawsRefocused} 帧`,
  );

  checker.finish("AniPlayer 失焦停表真机验证");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("AniPlayer 失焦停表真机验证");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
