// 一次性诊断脚本（不进仓）：拆解「窗口出现 → 开屏遮罩上屏」之间的白屏去向。
// 用法：node scripts/real_machine/_measure_gap.mjs dev|release
//   dev     = 直接跑 target/debug exe（加载 1420 的 vite，前置：vite 已起）
//   release = 直接跑 target/release exe（内嵌 dist，无需 vite）
// 连跑两轮：第 1 轮隔离数据根全新（冷 HTTP 缓存），第 2 轮同一数据根（暖）。
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { prepareRoot, cleanup, connectCdp, killApp, assertNoRunningInstance, sleep, CDP_PORT } from "./lib.mjs";

const mode = process.argv[2] ?? "dev";
const { appdata } = prepareRoot();
const REPO = process.cwd();
const exePath = join(
  REPO,
  "src-tauri",
  "target",
  mode === "release" ? "release" : "debug",
  "mousetool-theme.exe",
);

// 单进程 PowerShell 轮询器：主窗口一可见立刻回传本机 epoch（毫秒），
// 避免每次起 powershell 的几百毫秒采样误差
const helperPs1 = join(process.env.TEMP ?? ".", "cs-measure-window.ps1");
writeFileSync(
  helperPs1,
  "\uFEFF" + `Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RMWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, [Out] StringBuilder sb, int max);
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
$start = [DateTime]::UtcNow
while ((([DateTime]::UtcNow) - $start).TotalSeconds -lt 90) {
  $procs = Get-Process -Name mousetool-theme -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $h = [RMWin]::FindMain([uint32]$p.Id)
    if ($h -ne [IntPtr]::Zero -and [RMWin]::IsWindowVisible($h)) {
      Write-Output ("VISIBLE " + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      exit
    }
  }
  Start-Sleep -Milliseconds 30
}
Write-Output "TIMEOUT"
`,
  "utf8",
);

function processRunning() {
  const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq mousetool-theme.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return out.includes("mousetool-theme.exe");
}

async function fetchPageTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === "page" && !/devtools/i.test(t.url)) ?? null;
}

const out = [];
function report(line) {
  out.push(line);
  console.log(line);
  // 边测边落盘：node 在 Windows 上若被 libuv 断言打断，缓冲的 stdout 会全丢
  writeFileSync(join(process.env.TEMP ?? ".", "cs-measure-gap.log"), out.join("\n") + "\n", "utf8");
}

function stopPs(ps) {
  if (ps.pid) {
    try { execFileSync("taskkill", ["/PID", String(ps.pid), "/F"], { stdio: "ignore" }); } catch {}
  }
}

async function measureOnce(label) {
  assertNoRunningInstance();
  const t0 = Date.now();
  const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPs1], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let tWin = null;
  ps.stdout.on("data", (d) => {
    const m = String(d).match(/VISIBLE (\d+)/);
    if (m && tWin === null) tWin = Number(m[1]);
  });

  spawn(exePath, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: appdata,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: "ignore",
  }).unref();

  let tProc = null;
  while (Date.now() - t0 < 30_000) {
    if (processRunning()) { tProc = Date.now(); break; }
    await sleep(25);
  }

  let page = null;
  while (Date.now() - t0 < 90_000) {
    page = await fetchPageTarget().catch(() => null);
    if (page) break;
    await sleep(40);
  }
  const tTarget = Date.now();
  if (!page) {
    killApp();
    await sleep(500);
    report(`[${label}] 等不到 CDP 目标（进程出现=${tProc ? Math.round(tProc - t0) + "ms" : "否"}，窗口可见=${tWin ? "是" : "否"}）`);
    return null;
  }

  const cdp = connectCdp(page);
  await cdp.opened;
  await cdp.send("Page.enable", {});

  let tSplash = null;
  let splashInfo = null;
  while (Date.now() - tTarget < 30_000) {
    const r = await cdp
      .evaluate(
        `(() => { const el = document.querySelector('[data-splash]'); if (!el) return null;
          const s = getComputedStyle(el);
          return JSON.stringify({ op: s.opacity, img: Boolean(el.querySelector('img')), name: el.textContent.includes('\\u9F20\\u6807\\u4E3B\\u9898\\u5DE5\\u5177') }); })()`,
      )
      .catch(() => null);
    if (r) { tSplash = Date.now(); splashInfo = r; break; }
    await sleep(40);
  }

  let tGone = null;
  while (Date.now() - tTarget < 60_000) {
    const r = await cdp.evaluate(`Boolean(document.querySelector('[data-splash]'))`).catch(() => false);
    if (r === false) { tGone = Date.now(); break; }
    await sleep(50);
  }

  const timing = await cdp
    .evaluate(
      `(() => {
        const n = performance.getEntriesByType('navigation')[0];
        const paints = performance.getEntriesByType('paint');
        const res = performance.getEntriesByType('resource');
        const top = [...res].sort((a, b) => b.duration - a.duration).slice(0, 5)
          .map((r) => r.name.split('/').pop().split('?')[0] + ' ' + Math.round(r.duration) + 'ms');
        const fcp = paints.find((p) => p.name === 'first-contentful-paint');
        return JSON.stringify({
          timeOrigin: Math.round(performance.timeOrigin),
          fcp: fcp ? Math.round(fcp.startTime) : null,
          dcl: n ? Math.round(n.domContentLoadedEventEnd) : null,
          nRes: res.length, top,
        });
      })()`,
    )
    .catch(() => null);

  killApp();
  await sleep(800);
  stopPs(ps);

  if (tSplash === null) {
    report(`[${label}] 未观测到开屏遮罩（tProc=${tProc - t0} tTarget=${tTarget - t0}）`);
    return null;
  }
  const T = timing ? JSON.parse(timing) : {};
  const gap = (a, b) => (a != null && b != null ? Math.round(b - a) : "?");
  report(`\n[${label}]`);
  report(`  进程出现 → 主窗口可见      ${gap(tProc, tWin)} ms`);
  report(`  主窗口可见 → WebView 导航开始 ${T.timeOrigin ? gap(tWin, T.timeOrigin) : "?"} ms`);
  report(`  导航开始 → 首次内容绘制(FCP)  ${T.fcp ?? "?"} ms`);
  report(`  主窗口可见 → 开屏遮罩可见     ${gap(tWin, tSplash)} ms  ← 用户感知的白屏`);
  report(`  开屏可见 → 遮罩卸载        ${gap(tSplash, tGone)} ms`);
  report(`  导航后请求数 ${T.nRes ?? "?"}；最慢资源：${(T.top ?? []).join(" | ") || "—"}`);
  report(`  splash=${splashInfo}`);
  return { tWin, tSplash };
}

const r1 = await measureOnce(mode === "release" ? "release 第1轮（全新数据根）" : "dev 第1轮（全新 WebView2 缓存 + 冷 vite 变换）");
const r2 = await measureOnce(mode === "release" ? "release 第2轮（同一数据根已暖）" : "dev 第2轮（同一数据根已暖）");
report(`\n两轮白屏（窗口可见→遮罩可见）：第1轮 ${r1 ? Math.round(r1.tSplash - r1.tWin) + "ms" : "失败"} / 第2轮 ${r2 ? Math.round(r2.tSplash - r2.tWin) + "ms" : "失败"}`);
cleanup();
process.exit(0);
