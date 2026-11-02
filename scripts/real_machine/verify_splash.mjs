// 真机验证：开屏遮罩（方案 A，单窗口 CSS 遮罩）。
//
// 浏览器 mock 里开屏不渲染（SplashOverlay 以 !inTauri 直接退），所以这条链路
// 只能在真实窗口验证：真实 WebView2 下遮罩出现、最短停留 ≥800ms、数据就绪后
// 淡出（240ms、有中间态）、淡出完卸载、减少动态下不凑停留就绪即走。
// 判定不靠截图轮询猜：用 CDP addScriptToEvaluateOnNewDocument 给每个新文档
// 注入 rAF 记录器，Page.reload 让开屏确定性重放（冷启动与重放在同一条
// React 挂载路径上），逐帧量出「出现 → 开始退场 → 卸载」的时间线。
// 数据根用隔离的 LOCALAPPDATA，不碰用户真实数据；全程不调 apply_theme。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  waitPageTarget,
} from "./lib.mjs";

const { appdata } = prepareRoot();
const checker = createChecker();

const SHOT_DIR = join(process.env.TEMP ?? ".", "cs-rm-shots");

/** 逐帧记录开屏生命周期的探针：每个新文档都会装一份，量完自己停 */
const PROBE = `
window.__splash = { appearedAt: null, leftAt: null, midExit: null, removedAt: null };
(function loop() {
  const el = document.querySelector('[data-splash]');
  const t = performance.now();
  if (el) {
    if (window.__splash.appearedAt === null) window.__splash.appearedAt = t;
    const op = parseFloat(getComputedStyle(el).opacity);
    if (op < 1 && window.__splash.leftAt === null) window.__splash.leftAt = t;
    else if (op < 1 && op > 0 && window.__splash.midExit === null) window.__splash.midExit = op;
  } else if (window.__splash.appearedAt !== null && window.__splash.removedAt === null) {
    window.__splash.removedAt = t;
    return;
  }
  requestAnimationFrame(loop);
})();
`;

async function screenshot(cdp, name) {
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = join(SHOT_DIR, name);
  writeFileSync(file, Buffer.from(res.result.data, "base64"));
  console.log(`  screenshot: ${file}`);
  return file;
}

/** 重放一次开屏并等待记录器报「已卸载」；返回 __splash 时间线 */
async function replaySplash(cdp, timeoutMs = 12_000) {
  await cdp.send("Page.reload", {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = await cdp.evaluate("window.__splash ?? null").catch(() => null);
    if (log && log.appearedAt !== null && log.removedAt !== null) return log;
    await sleep(120);
  }
  return null;
}

async function readSplashLog(cdp) {
  return cdp.evaluate("window.__splash ?? null").catch(() => null);
}

let app = null;
let cdp = null;

try {
  mkdirSync(SHOT_DIR, { recursive: true });
  assertNoRunningInstance();
  const exePath = join(process.cwd(), "src-tauri", "target", "debug", "mousetool-theme.exe");
  if (!existsSync(exePath)) throw new Error(`找不到已构建的 exe：${exePath}（先 cargo build / cargo run 一次）`);

  app = launchApp(appdata);
  const page = await waitPageTarget();
  cdp = connectCdp(page);
  await cdp.opened;
  await cdp.send("Page.enable", {});
  // 等首份文档跑起来再挂探针：冷启动的开屏可能已经放完（CDP 接入有延迟），
  // 用 reload 在受控状态下重放，重放走的是同一条挂载路径
  await sleep(1_500);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });

  // --- 1. 正常路径：出现、停留、淡出、卸载 ---
  const log = await replaySplash(cdp);
  checker.check(
    "开屏遮罩在真实窗口出现并完成退场（reload 重放）",
    log !== null,
    log ? JSON.stringify(log) : "12s 内未观测到完整生命周期",
  );
  if (log) {
    const holdMs = log.leftAt - log.appearedAt;
    const lifeMs = log.removedAt - log.appearedAt;
    checker.check("最短停留生效（≥800ms 档，容忍采样误差）", holdMs >= 600, `停留 ${Math.round(holdMs)}ms`);
    checker.check("淡出有中间态（渐隐不是瞬间消失）", log.midExit !== null, `中途 opacity=${log.midExit}`);
    checker.check("整个开屏生命周期有界（< 5s 兜底 + 退场）", lifeMs < 5_000, `全程 ${Math.round(lifeMs)}ms`);
    const snapshot = await readSplashLog(cdp);
    const readyNow = await cdp.evaluate(
      `Boolean(globalThis.__themeStore && globalThis.__settingsStore
        && !globalThis.__themeStore.getState().loading
        && globalThis.__settingsStore.getState().settings !== null)`,
    );
    checker.check("开屏卸载时数据已就绪（settings 非空、主题列表不在加载中）", readyNow, `splash=${JSON.stringify(snapshot)}`);
  }

  // 遮罩内容与底色：再来一轮，抓停留期内的现场
  await cdp.send("Page.reload", {});
  let seen = false;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const present = await cdp
      .evaluate(
        `(() => {
          const el = document.querySelector('[data-splash]');
          if (!el) return null;
          const img = el.querySelector('img');
          const bodyBg = getComputedStyle(document.body).backgroundColor;
          const style = getComputedStyle(el);
          return JSON.stringify({
            img: img ? img.getAttribute('src') : null,
            name: el.textContent.includes('鼠标主题工具'),
            bg: style.backgroundColor,
            bodyBg,
            pe: style.pointerEvents,
            viewport: el.getBoundingClientRect().width >= window.innerWidth - 1 && el.getBoundingClientRect().height >= window.innerHeight - 1,
          });
        })()`,
      )
      .catch(() => null);
    if (present !== null) {
      seen = true;
      const info = JSON.parse(present);
      checker.check("遮罩盖满窗口且不截胡指针事件", info.viewport && info.pe === "none", present);
      checker.check("遮罩底色与页面底色一致（深浅色都对齐 token）", info.bg === info.bodyBg, `bg=${info.bg} body=${info.bodyBg}`);
      checker.check("遮罩含品牌 logo（favicon.svg）与应用名", info.img === "/favicon.svg" && info.name, `img=${info.img} name=${info.name}`);
      await screenshot(cdp, "splash-hold-real.png");
      break;
    }
    await sleep(80);
  }
  checker.check("reload 后能观测到停留期内的遮罩现场", seen);
  // 等这一轮放完再进入下一阶段
  await sleep(2_000);

  // --- 2. 减少动态：不凑最短停留，就绪即走 ---
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const emulated = await cdp
    .evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`)
    .catch(() => false);
  if (emulated) {
    const rmLog = await replaySplash(cdp);
    const rmHold = rmLog ? rmLog.leftAt - rmLog.appearedAt : -1;
    checker.check(
      "减少动态下开屏不凑停留（就绪即走，远短于 800ms）",
      rmLog !== null && rmHold < 400,
      rmLog ? `停留 ${Math.round(rmHold)}ms` : "未观测到生命周期",
    );
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "" }] });
  } else {
    console.log("  [SKIP] 此 WebView2 不支持 prefers-reduced-motion 仿真，跳过该项");
  }

  const errors = cdp.pageErrors.length;
  checker.check("运行期无 JS 异常", errors === 0, `${errors} 条`);
  checker.finish("开屏遮罩真机验证");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("开屏遮罩真机验证");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
