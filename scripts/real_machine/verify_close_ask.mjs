// 真机验证（决策 57）：关闭行为三态与关窗询问。
//
// 与浏览器 mock 不同，这条链路验证**真实 WM_CLOSE**（user32 SendMessage，等价
// 用户点 X）下的关窗拦截：ask 发 close-ask 事件由真实窗口弹询问框、不勾选的
// 一次性藏窗 + settings.json 不落盘、勾选后 tray / exit 真实落盘、exit_app 让
// 进程自行结束、exit 模式关窗不弹框直接退。二次启动（单实例转交 + SW_RESTORE
// 激活）用来把藏起的窗口叫回。数据根用隔离的 LOCALAPPDATA，不碰用户真实数据；
// 全程不调 apply_theme / restore_default（真机注册表不隔离）。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertNoRunningInstance,
  cleanup,
  connectCdp,
  createChecker,
  killApp,
  launchApp,
  prepareRoot,
  ROOT,
  sleep,
  waitAppReady,
  waitPageTarget,
} from "./lib.mjs";

const { appdata } = prepareRoot();
const checker = createChecker();
const dataRoot = join(appdata, "CursorStudio");
const settingsFile = join(dataRoot, "settings.json");
const logFile = join(dataRoot, "logs", "mousetool.log");
const exePath = join(process.cwd(), "src-tauri", "target", "debug", "mousetool-theme.exe");

/** 截图落到临时目录（不入库；证据截图复制进 docs/real-machine-verify/） */
const SHOT_DIR = join(process.env.TEMP ?? ".", "cs-rm-shots");
let shotIndex = 0;
async function screenshot(cdp, name) {
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = join(SHOT_DIR, `${String(shotIndex + 1).padStart(2, "0")}-${name}.png`);
  writeFileSync(file, Buffer.from(res.result.data, "base64"));
  shotIndex += 1;
  console.log(`  screenshot: ${file}`);
  return file;
}

// 关窗与可见性都以「标题 = 主窗口」的那只顶层窗口为准：
// - 进程里还有 WebView2 宿主等**无标题可见窗口**，.NET 的 MainWindowHandle 会
//   抓到它们，判可见性全程误报（实测）——必须 EnumWindows 按标题定位主窗口；
// - 标题用字符码点数组在 C# 里拼，源文件纯 ASCII，绕开 PowerShell 读盘编码；
// - 关窗对主窗口句柄直投 WM_CLOSE（0x0010），与点 X 同一条消息路径。
const helperPs1 = join(ROOT, "rm_window.ps1");
writeFileSync(
  helperPs1,
  "\uFEFF" + `param([string]$Action, [string]$Out)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RMWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, [Out] StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
    // 「鼠标主题工具」的码点（UTF-16）：9F20 6807 4E3B 9898 5DE5 5177
    static string Title() { return new string(new[] { (char)0x9F20, (char)0x6807, (char)0x4E3B, (char)0x9898, (char)0x5DE5, (char)0x5177 }); }
    public static IntPtr FindMain(uint pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint wpid; GetWindowThreadProcessId(h, out wpid);
            if (wpid == pid) {
                var sb = new StringBuilder(256);
                GetWindowTextW(h, sb, 256);
                if (sb.ToString() == Title()) { found = h; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@
$procs = Get-Process -Name mousetool-theme -ErrorAction SilentlyContinue
$hwnd = [IntPtr]::Zero
foreach ($p in $procs) { $hwnd = [RMWin]::FindMain([uint32]$p.Id); if ($hwnd -ne [IntPtr]::Zero) { break } }
switch ($Action) {
  "visible" {
    if ($hwnd -eq [IntPtr]::Zero) { "notfound" } elseif ([RMWin]::IsWindowVisible($hwnd)) { "visible" } else { "hidden" }
  }
  "close" {
    if ($hwnd -eq [IntPtr]::Zero) { "notfound" } else { [void][RMWin]::SendMessageW($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); "sent" }
  }
  "shot" {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $w = [Math]::Min(560, $b.Width); $hh = 100
    $bmp = New-Object System.Drawing.Bitmap($w, $hh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Width - $w, $b.Height - $hh, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    "saved"
  }
}
`,
  "utf8",
);

function psRun(action, out = "") {
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPs1, "-Action", action, "-Out", out],
    { encoding: "utf8", timeout: 20_000 },
  );
  if (res.status !== 0 || res.error) {
    console.log(`  [ps:${action}] status=${res.status} err=${res.error ?? ""} stderr=${String(res.stderr ?? "").slice(0, 200)}`);
  }
  return (res.stdout ?? "").trim();
}

function processRunning() {
  const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq mousetool-theme.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return (out.stdout ?? "").includes("mousetool-theme.exe");
}

async function waitProcessGone(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processRunning()) return true;
    await sleep(300);
  }
  return false;
}

async function waitVisible(state, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (psRun("visible") === state) return true;
    await sleep(400);
  }
  return false;
}

/** 二次启动真实 exe：单实例转交 + activate_existing() 的 SW_RESTORE 把藏窗叫回 */
function secondInstanceRestore() {
  spawn(exePath, [], {
    env: { ...process.env, LOCALAPPDATA: appdata },
    stdio: "ignore",
  }).unref();
}

let app = null;
let cdp = null;
const allErrors = () => (cdp ? cdp.pageErrors.length : 0);
const dialogSel = `document.querySelector('[data-close-ask-dialog]')`;

async function connect() {
  const page = await waitPageTarget();
  cdp = connectCdp(page);
  await cdp.opened;
  await cdp.send("Page.enable", {});
  await waitAppReady(cdp.evaluate);
}

async function waitDialog(open, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const present = await cdp.evaluate(`Boolean(${dialogSel})`).catch(() => false);
    if (present === open) return true;
    await sleep(200);
  }
  return false;
}

/** 负向断言专用：固定窗口期内反复确认弹窗「始终没出现」；exit 模式下进程
 *  会很快退出、webview 随之销毁，CDP 求值失败 = 已退出 = 不可能被弹窗拦住 */
async function waitNoDialog(windowMs = 2_000) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const res = await cdp
      .send("Runtime.evaluate", { expression: `Boolean(${dialogSel})`, returnByValue: true })
      .catch(() => null);
    if (res === null) return true;
    if (res.result?.result?.value === true) return false;
    await sleep(200);
  }
  return true;
}

async function waitSettings(expected, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settingsOnDisk() === expected) return true;
    await sleep(300);
  }
  return settingsOnDisk() === expected;
}

async function clickDialog(selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

const invoke = async (command, args) => {
  const res = await cdp.send("Runtime.evaluate", {
    expression: `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    const detail = res.result.exceptionDetails;
    const text =
      detail.exception?.description ?? detail.exception?.value ?? detail.text ?? "命令执行失败";
    throw new Error(typeof text === "string" ? text : JSON.stringify(text));
  }
  return res.result?.result?.value;
};

function settingsOnDisk() {
  if (!existsSync(settingsFile)) return null;
  return JSON.parse(readFileSync(settingsFile, "utf8")).close_behavior ?? null;
}

try {
  mkdirSync(SHOT_DIR, { recursive: true });
  assertNoRunningInstance();
  if (!existsSync(exePath)) throw new Error(`找不到已构建的 exe：${exePath}（先 cargo build / cargo run 一次）`);

  app = launchApp(appdata);
  await connect();
  checker.check("应用启动且就绪（真实窗口 + 隔离数据根）", true);

  // --- 1. 真机 Rust 默认：新装（无 settings.json）= ask ---
  const initial = await invoke("get_settings", {});
  checker.check(
    "真机默认关闭行为是每次询问 ask（Rust 默认，非 mock）",
    initial?.close_behavior === "ask",
    `close_behavior=${initial?.close_behavior}`,
  );

  // --- 2. 设置页分段控件三选项 ---
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll("nav button")].find(b => b.textContent.trim() === "设置");
    btn?.click();
    return Boolean(btn);
  })()`);
  await cdp.evaluate(`globalThis.__themeStore?.getState().setSettingsSection?.("general")`);
  await sleep(800);
  const segmented = await cdp.evaluate(
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
  checker.check(
    "真实窗口关闭行为分段控件三选项且默认选中每次询问",
    seg?.count === 3 && seg.labels.join("/") === "每次询问/最小化到托盘/直接退出" && seg.checked === "每次询问",
    segmented,
  );
  await screenshot(cdp, "settings-close-behavior-real");

  // --- 3. 真实 WM_CLOSE → 拦截 → 询问框 ---
  psRun("close");
  checker.check("真实 WM_CLOSE 被拦截并弹出关窗询问框", await waitDialog(true));
  const dialogText = await cdp.evaluate(`${dialogSel}?.textContent ?? ""`);
  checker.check(
    "询问框说明两种去留的后果并含「不再询问」与三按钮",
    dialogText.includes("定时切换") &&
      dialogText.includes("退出应用会全部停止") &&
      dialogText.includes("不再询问") &&
      ["cancel", "exit", "tray"].every((k) => dialogText.includes(k === "cancel" ? "取消" : k === "exit" ? "退出应用" : "最小化到托盘")),
    dialogText.slice(0, 80),
  );
  await screenshot(cdp, "close-ask-dialog-real");

  // --- 4. 取消：窗口保持，设置不动 ---
  await clickDialog('[data-close-ask="cancel"]');
  checker.check("取消后弹窗收起", await waitDialog(false));
  checker.check("取消后设置仍为 ask", (await invoke("get_settings", {}))?.close_behavior === "ask");

  // --- 5. 不勾「不再询问」选最小化：藏窗执行本次，settings.json 不落盘 ---
  psRun("close");
  await waitDialog(true);
  await clickDialog('[data-close-ask="tray"]');
  checker.check("一次性最小化后弹窗收起且窗口真实隐藏", (await waitDialog(false)) && (await waitVisible("hidden")));
  const onDiskAfterOnce = settingsOnDisk();
  checker.check(
    "未勾选时 settings.json 未落盘成 tray（缺失或仍为 ask）",
    onDiskAfterOnce === null || onDiskAfterOnce === "ask",
    `settings.json close_behavior=${onDiskAfterOnce}`,
  );
  const logText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  checker.check("应用日志无托盘创建失败记录", !logText.includes("创建托盘图标失败"));
  psRun("shot", join(SHOT_DIR, "03-tray-corner-ask-minimized.png"));
  console.log("  screenshot: 托盘角截图（03-tray-corner-ask-minimized.png，证据参考）");

  // --- 6. 二次启动把藏起的窗口叫回（单实例转交 + SW_RESTORE 激活） ---
  secondInstanceRestore();
  checker.check("二次启动把藏起的窗口叫回（真实激活路径）", await waitVisible("visible"));

  // --- 7. 勾「不再询问」选最小化：settings.json 落盘为 tray ---
  psRun("close");
  await waitDialog(true);
  await clickDialog("[data-close-ask-remember]");
  await sleep(400); // 等勾选状态真正进 React 渲染，避免闭包读到旧的 remember=false
  await clickDialog('[data-close-ask="tray"]');
  checker.check("勾选后最小化：弹窗收起、窗口隐藏", (await waitDialog(false)) && (await waitVisible("hidden")));
  checker.check("勾选后 settings.json 真实落盘为 tray", await waitSettings("tray"), `close_behavior=${settingsOnDisk()}`);

  // --- 8. 切回 ask（真实 IPC），验证勾选退出的落盘 ---
  secondInstanceRestore();
  checker.check("二次启动再次叫回窗口", await waitVisible("visible"));
  const backToAsk = await invoke("update_settings", { closeBehavior: "ask" });
  checker.check("update_settings 真实 IPC 切回 ask", backToAsk?.close_behavior === "ask");

  psRun("close");
  await waitDialog(true);
  await clickDialog("[data-close-ask-remember]");
  await sleep(400); // 同上：等勾选状态进渲染
  await clickDialog('[data-close-ask="exit"]');
  checker.check(
    "勾选后退出应用：进程自行结束（无 taskkill）",
    await waitProcessGone(),
    `settings.json close_behavior=${settingsOnDisk()}`,
  );
  checker.check("退出前 settings.json 落盘为 exit", await waitSettings("exit"));
  app = null; // 进程已自行退出，finally 里的 killApp 不再有用武之地

  // --- 9. 重启：exit 落盘跨重启生效；真实关窗不再弹框、进程自行结束 ---
  app = launchApp(appdata);
  await connect();
  const afterRestart = await invoke("get_settings", {});
  checker.check(
    "重启后关闭行为仍为 exit（真实落盘跨重启）",
    afterRestart?.close_behavior === "exit",
    `close_behavior=${afterRestart?.close_behavior}`,
  );
  psRun("close");
  checker.check("exit 模式真实关窗不弹询问框", await waitNoDialog(2_000));
  checker.check("exit 模式关窗后进程自行结束", await waitProcessGone());
  app = null;

  const errors = allErrors();
  checker.check("运行期无 JS 异常", errors === 0, `${errors} 条`);
  checker.finish("关窗询问真机验证（决策 57）");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("关窗询问真机验证（决策 57）");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
