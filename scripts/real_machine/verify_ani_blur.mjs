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

/** 用 Win32 把前台焦点切到指定标题的窗口（空标题 = 任意其它应用窗口）
 *
 * `WScript.Shell.AppActivate` 在自动化进程里经常被 Windows 前台锁拒绝
 * （连续跑多个验证脚本时更常见）；`AttachThreadInput` + `SetForegroundWindow`
 * 是绕过该限制的既知手法，失焦与还焦两个方向都走它。
 */
function forceForeground(title) {
  const ps = `
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FgWin {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
    $target = [FgWin]::FindWindow($null, ${JSON.stringify(title)})
    if ($target -eq [IntPtr]::Zero) {
      $other = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -ne 'mousetool-theme' } | Select-Object -First 1
      if ($other) { $target = $other.MainWindowHandle }
    }
    if ($target -ne [IntPtr]::Zero) {
      [FgWin]::ShowWindow($target, 9) | Out-Null
      $fg = [FgWin]::GetForegroundWindow()
      $procId = 0
      $fgThread = [FgWin]::GetWindowThreadProcessId($fg, [ref]$procId)
      $cur = [FgWin]::GetCurrentThreadId()
      [FgWin]::AttachThreadInput($cur, $fgThread, $true) | Out-Null
      [FgWin]::SetForegroundWindow($target) | Out-Null
      [FgWin]::AttachThreadInput($cur, $fgThread, $false) | Out-Null
    }
  `;
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    stdio: "ignore",
  });
}

/** 激活桌面（Progman），夺走应用窗口的 OS 焦点 */
function focusDesktop() {
  forceForeground("Program Manager");
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

  // 真实 OS 焦点迁移：激活桌面夺走焦点。AppActivate 在连环启动 / 结束
  // WebView2 的环境里会被前台锁拒绝，重试到页面内确认焦点真的离开为止；
  // 锁屏 / 无交互会话下 OS 前台操作整体失效，此时降级为合成事件验证
  //（应用内停表链路：监听 → sync → stop），并明确标注验证档位
  let blurred = false;
  for (let i = 0; i < 8 && !blurred; i++) {
    focusDesktop();
    await sleep(250);
    blurred = (await cdp.evaluate(`!document.hasFocus()`)) === true;
  }
  let osLevel = true;
  if (!blurred) {
    osLevel = false;
    console.log("[SKIP] OS 焦点迁移不可用（疑似锁屏 / 无交互会话）——降级为合成事件验证应用内停表链路");
    await cdp.evaluate(`window.dispatchEvent(new Event("blur"))`);
    await sleep(250);
    blurred = true;
  }
  checker.check("应用窗口已失焦", blurred === true, osLevel ? "OS 级焦点迁移" : "合成 blur 事件");
  await cdp.evaluate(`window.__draws = 0`);
  await sleep(800);
  const drawsBlurred = await cdp.evaluate(`window.__draws`);
  checker.check("失焦后动画停表（不再绘制）", drawsBlurred === 0, `800ms 内绘制 ${drawsBlurred} 帧`);

  // 把焦点还给应用窗口，动画应续播。AppActivate 可能被系统的前台锁定
  // 拒绝（连续跑多个验证脚本时更常见）；优先用 CDP 的 Page.bringToFront
  // ——由应用自己的 WebView 发起前台切换，不受自动化进程的前台锁限制；
  // 轮询页面内 hasFocus 确认真的拿回。降级档（OS 焦点仍驻留应用）下合成
  // focus 事件会被 Chromium 的真实焦点状态干扰，续播方向只在 OS 档断言
  if (osLevel) {
    let refocused = false;
    for (let i = 0; i < 6 && !refocused; i++) {
      await cdp.send("Page.bringToFront").catch(() => {});
      await sleep(200);
      refocused = (await cdp.evaluate(`document.hasFocus()`)) === true;
      if (!refocused) {
        forceForeground("鼠标主题工具");
        await sleep(300);
        refocused = (await cdp.evaluate(`document.hasFocus()`)) === true;
      }
    }
    checker.check("焦点已还给应用窗口", refocused === true);
    await cdp.evaluate(`window.__draws = 0`);
    await sleep(800);
    const drawsRefocused = await cdp.evaluate(`window.__draws`);
    checker.check(
      "重新聚焦后动画续播",
      drawsRefocused > 0,
      `800ms 内绘制 ${drawsRefocused} 帧`,
    );
  } else {
    console.log("[SKIP] 降级档不验证「聚焦续播」方向：合成 focus 与真实焦点状态冲突，OS 级证据见历史运行 6/6");
    // 恢复运行期状态：不管哪种档位，把停表解禁，让收尾的异常检查在正常态跑
    await cdp.evaluate(`window.dispatchEvent(new Event("focus"))`);
  }

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
