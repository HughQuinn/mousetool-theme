// 真机验证（决策 59）：弹性按压反馈在真实 WebView2 窗口下生效。
//
// 浏览器 mock（motion_check）与真机同为 Chromium，但真机链路多 Tauri 注入、
// 真实窗口合成器与真实 IPC；本脚本把弹性断言在真机重放：按钮用 CDP
// Input.dispatchMouseEvent 真实鼠标按下/释放，滑块与对勾逐帧采样过冲回位。
// 数据根隔离（LOCALAPPDATA），导入一套主题仅供复选框用例，全程不调
// apply_theme / restore_default（不碰真实注册表）。前置见同目录 README。
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
const cursorSource = join(process.env.SystemRoot ?? "C:\\Windows", "Cursors", "aero_arrow.cur");

let app = null;
try {
  mkdirSync(join(pack, "spring-a"), { recursive: true });
  copyFileSync(cursorSource, join(pack, "spring-a", "arrow.cur"));

  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);
  // 开屏遮罩在最短停留 800ms 后退场，留足余量再交互
  await sleep(1200);

  const invoke = (command, args) =>
    cdp.evaluate(
      `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
    );

  // ── 造一套主题：复选框用例的前提（隔离数据根默认无主题）──
  // CDP 直接 invoke 绕过前端 store，UI 列表不会刷新——reload 让 store 重扫主题目录
  const imported = await invoke("import_theme", { sourcePath: join(pack, "spring-a") });
  checker.check("导入一套主题（隔离数据根）", Boolean(imported?.theme?.id), imported?.theme?.id ?? JSON.stringify(imported));
  await cdp.send("Page.reload");
  const reloaded = await waitAppReady(cdp.evaluate);
  checker.check("reload 后主题列表就绪", reloaded);
  await sleep(1200);

  // ── 按钮：computed 过渡含 320ms spring 段 ──
  const navTransition = JSON.parse(
    await cdp.evaluate(`(() => {
      const btn = document.querySelector('nav[aria-label="主导航"] button');
      const cs = getComputedStyle(btn);
      return JSON.stringify({ duration: cs.transitionDuration, easing: cs.transitionTimingFunction });
    })()`),
  );
  checker.check(
    "按钮过渡含 320ms spring 段",
    navTransition.duration.includes("0.32") && navTransition.easing.includes("cubic-bezier(0.34, 1.56, 0.64, 1)"),
    `${navTransition.duration} / ${navTransition.easing}`,
  );

  // 真实鼠标按下 / 释放，逐帧采样 scale
  const navPoint = JSON.parse(
    await cdp.evaluate(`(() => {
      const r = document.querySelector('nav[aria-label="主导航"] button').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()`),
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...navPoint, button: "left", clickCount: 1 });
  const pressDown = JSON.parse(
    await cdp.evaluate(`(async () => {
      const el = document.querySelector('nav[aria-label="主导航"] button');
      let minScale = 1;
      let ripple = false;
      const t0 = performance.now();
      while (performance.now() - t0 < 240) {
        await new Promise((r) => requestAnimationFrame(r));
        minScale = Math.min(minScale, Number(getComputedStyle(el).scale) || 1);
        ripple = ripple || Boolean(el.querySelector('[data-ripple]'));
      }
      return JSON.stringify({ minScale, ripple });
    })()`),
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...navPoint, button: "left", clickCount: 1 });
  const pressUp = JSON.parse(
    await cdp.evaluate(`(async () => {
      const el = document.querySelector('nav[aria-label="主导航"] button');
      let maxScale = 0;
      let endScale = 0;
      let afterPeakDips = false;
      const t0 = performance.now();
      while (performance.now() - t0 < 600) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = Number(getComputedStyle(el).scale) || 1;
        if (maxScale > 1.01 && s < 0.999) afterPeakDips = true;
        maxScale = Math.max(maxScale, s);
        endScale = s;
      }
      return JSON.stringify({ maxScale, endScale, afterPeakDips, rippleGone: !el.querySelector('[data-ripple]') });
    })()`),
  );
  checker.check("真实鼠标按下按钮缩到 0.97", pressDown.minScale < 0.985, `minScale=${pressDown.minScale.toFixed(3)}`);
  checker.check("按下荡开水波（涟漪出现）", pressDown.ripple, String(pressDown.ripple));
  checker.check("涟漪在动画结束后移除", pressUp.rippleGone, String(pressUp.rippleGone));
  checker.check("松开晃动过冲超过原尺寸", pressUp.maxScale > 1.01, `maxScale=${pressUp.maxScale.toFixed(4)}`);
  checker.check("水珠感：晃动越过原尺寸再下穿（衰减振荡）", pressUp.afterPeakDips, `afterPeakDips=${pressUp.afterPeakDips}`);
  checker.check("晃动停在原尺寸", Math.abs(pressUp.endScale - 1) < 0.002, `endScale=${pressUp.endScale.toFixed(4)}`);

  // ── 开关滑块：设置页，真实点击 + 过冲采样 ──
  // 侧栏双 nav 按页切换（设置页下主导航不在 DOM）；导航按钮带数量徽章只能 includes
  const toggle = JSON.parse(
    await cdp.evaluate(`(async () => {
      const navBtn = (text) => [...document.querySelectorAll('nav[aria-label="主导航"] button')].find((b) => b.textContent.includes(text));
      navBtn('设置')?.click();
      await new Promise((r) => setTimeout(r, 400));
      const all = [...document.querySelectorAll('[role="switch"]')].filter((b) => !b.disabled);
      const sw = all.find((b) => b.getAttribute('aria-checked') === 'false') ?? all[0];
      if (!sw) return JSON.stringify({ error: 'no-switch' });
      const knob = sw.querySelector('span');
      const label = sw.getAttribute('aria-label');
      const startChecked = sw.getAttribute('aria-checked') === 'true';
      const target = startChecked ? 0 : 20;
      const frames = [];
      sw.click();
      const t0 = performance.now();
      while (performance.now() - t0 < 420) {
        await new Promise((r) => requestAnimationFrame(r));
        frames.push(parseFloat(getComputedStyle(knob).translate) || 0);
      }
      const cs = getComputedStyle(knob);
      return JSON.stringify({ label, startChecked, target, frames, end: parseFloat(cs.translate) || 0, duration: cs.transitionDuration, easing: cs.transitionTimingFunction });
    })()`),
  );
  if (toggle.error) {
    checker.check("设置页有可用开关（用于验证）", false, toggle.error);
  } else {
    checker.check("开关滑块走 320ms spring 曲线", toggle.duration === "0.32s" && toggle.easing.includes("cubic-bezier(0.34, 1.56, 0.64, 1)"), `${toggle.duration} ${toggle.easing}（${toggle.label}）`);
    const overshoot = toggle.startChecked ? Math.min(...toggle.frames) : Math.max(...toggle.frames);
    const overshot = toggle.startChecked ? overshoot < -1 : overshoot > toggle.target + 1;
    checker.check("滑块越过终点后回位（回弹）", overshot && Math.abs(toggle.end - toggle.target) < 1, `overshoot=${overshoot.toFixed(1)} end=${toggle.end.toFixed(1)}`);
  }

  // ── 复选框对勾：我的主题页（先点设置导航「返回」回内容页）──
  const checkbox = JSON.parse(
    await cdp.evaluate(`(async () => {
      const navBtn = (text) => [...document.querySelectorAll('nav[aria-label="主导航"] button')].find((b) => b.textContent.includes(text));
      if (!navBtn('我的主题')) {
        [...document.querySelectorAll('nav[aria-label="设置导航"] button')].find((b) => b.textContent.includes('返回'))?.click();
        await new Promise((r) => setTimeout(r, 400));
      }
      navBtn('我的主题')?.click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelector('[data-batch-mode]')?.click();
      await new Promise((r) => setTimeout(r, 300));
      let cb = null;
      for (const b of document.querySelectorAll('[role="checkbox"]')) {
        if (!b.disabled && b.getAttribute('aria-checked') !== 'true') { cb = b; break; }
      }
      if (!cb) return JSON.stringify({ error: 'no-unchecked-checkbox' });
      const frames = [];
      cb.click();
      const t0 = performance.now();
      while (performance.now() - t0 < 420) {
        await new Promise((r) => requestAnimationFrame(r));
        const svg = cb.querySelector('svg');
        if (!svg) continue;
        const a = svg.getAnimations().find((x) => x.playState === 'running' || x.playState === 'finished');
        frames.push({ scale: Number(getComputedStyle(svg).scale) || 0, name: a?.animationName ?? '' });
      }
      const svg = cb.querySelector('svg');
      return JSON.stringify({ frames, finalScale: svg ? Number(getComputedStyle(svg).scale) : null });
    })()`),
  );
  if (checkbox.error) {
    checker.check("我的主题页有未选中的复选框（用于验证）", false, checkbox.error);
  } else {
    checker.check("对勾入场播 check-pop", checkbox.frames.some((f) => f.name === "check-pop"), [...new Set(checkbox.frames.map((f) => f.name))].join(",") || "无");
    checker.check("对勾入场过冲（scale > 1.05）", checkbox.frames.some((f) => f.scale > 1.05), `max=${Math.max(...checkbox.frames.map((f) => f.scale)).toFixed(3)}`);
    checker.check("对勾回位到 1", Math.abs((checkbox.finalScale ?? 0) - 1) < 0.01, `finalScale=${checkbox.finalScale}`);
  }

  // ── 减少动态：真机 WebView2 里全局兜底同样把时长压到 0.01ms（computed 返回 1e-05s）──
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedDuration = parseFloat(
    await cdp.evaluate(
      `getComputedStyle(document.querySelector('nav[aria-label="主导航"] button') ?? document.body).transitionDuration`,
    ),
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...navPoint, button: "left", clickCount: 1 });
  const rippleReduced = await cdp.evaluate(`Boolean(document.querySelector('nav[aria-label="主导航"] button [data-ripple]'))`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...navPoint, button: "left", clickCount: 1 });
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });
  checker.check("减少动态下时长压到 0.01ms", reducedDuration > 0 && reducedDuration < 0.001, `${reducedDuration}s`);
  checker.check("减少动态下按下不产生涟漪", rippleReduced === false, String(rippleReduced));

  checker.check("运行期无 JS 异常", cdp.pageErrors.length === 0, cdp.pageErrors.join(" | "));

  checker.finish("弹性动效真机验证");
} finally {
  killApp();
  cleanup();
}
