// 真机验证（决策 69）：分段控件选中滑块在真实 WebView2 窗口下生效。
//
// 浏览器 mock（motion_check 的分段区）已覆盖动效参数，本脚本在真机重放并补上
// mock 做不到的三件事：CDP Input.dispatchMouseEvent 真实鼠标点击触发滑动、
// 关闭行为切换经真实 IPC 落盘 settings.json、Page.reload 后滑块首帧即对齐
// 持久化值（不从 0 滑入、不落在旧位）。数据根隔离（LOCALAPPDATA），不导入
// 主题、不调 apply / restore（不碰真实注册表）。前置见同目录 README。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const { appdata } = prepareRoot();
const checker = createChecker();
const shotsDir = join(process.env.TEMP ?? ".", "cs-rm-shots");

// 页内采样工具：滑块几何（translate/width/过渡参数）+ rAF 逐帧
const SAMPLE = `
  const groupOf = (label) => document.querySelector('[aria-label="' + label + '"]');
  const thumbOf = (label) => groupOf(label)?.querySelector(':scope > span[aria-hidden]') ?? null;
  const geoOf = (thumb) => {
    const cs = getComputedStyle(thumb);
    return {
      x: cs.translate === 'none' ? 0 : parseFloat(cs.translate),
      w: parseFloat(cs.width),
      property: cs.transitionProperty,
      duration: cs.transitionDuration,
      easing: cs.transitionTimingFunction,
    };
  };
  const framesOf = (thumb, ms) => new Promise((done) => {
    const frames = [];
    const t0 = performance.now();
    const tick = () => {
      const g = geoOf(thumb);
      frames.push({ x: g.x, w: g.w });
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(frames);
    };
    requestAnimationFrame(tick);
  });
`;

let app = null;
try {
  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);
  // 开屏遮罩在最短停留 800ms 后退场，留足余量再交互
  await sleep(1200);

  // 导航到设置页（通用分组含「界面外观」与「关闭行为」两处分段控件）
  await cdp.evaluate(`(() => {
    [...document.querySelectorAll('nav[aria-label="主导航"] button')]
      .find((b) => b.textContent.includes('设置'))?.click();
  })()`);
  let settingsShown = false;
  for (let i = 0; i < 20; i++) {
    settingsShown = await cdp
      .evaluate(
        `Boolean(document.querySelector('[aria-label="界面外观"]') && document.querySelector('[aria-label="关闭行为"]'))`,
      )
      .catch(() => false);
    if (settingsShown) break;
    await sleep(200);
  }
  checker.check("设置页渲染出两处分段控件", settingsShown);

  // ── 界面外观：滑块存在、初始对齐、过渡参数 ──
  const appearance = JSON.parse(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      const group = groupOf('界面外观');
      const thumb = thumbOf('界面外观');
      if (!thumb) return JSON.stringify({ error: 'no-thumb' });
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0];
      const g = geoOf(thumb);
      const tr = thumb.getBoundingClientRect();
      const cr = checked.getBoundingClientRect();
      return JSON.stringify({
        geo: g,
        aligned: Math.abs(tr.left - cr.left) < 1 && Math.abs(tr.width - cr.width) < 1,
        checkedLabel: checked.textContent.trim(),
        options: radios.map((b) => ({ label: b.textContent.trim(), x: b.offsetLeft, w: b.offsetWidth })),
      });
    })()`),
  );
  if (appearance.error) {
    checker.check("界面外观有选中滑块（用于验证）", false, appearance.error);
  } else {
    checker.check("真实窗口里滑块已挂载", true, `选中「${appearance.checkedLabel}」`);
    checker.check(
      "滑块初始即对齐选中项（不从 0 滑入）",
      appearance.aligned,
      `x=${appearance.geo.x} w=${appearance.geo.w}`,
    );
    checker.check(
      "滑块 translate+width 同走 320ms spring",
      appearance.geo.property.includes("translate") &&
        appearance.geo.property.includes("width") &&
        appearance.geo.duration === "0.32s" &&
        appearance.geo.easing.includes("cubic-bezier(0.34, 1.56, 0.64, 1)"),
      `${appearance.geo.property} / ${appearance.geo.duration} ${appearance.geo.easing}`,
    );
  }

  // ── 真实鼠标点击（Input.dispatchMouseEvent）触发滑动，逐帧采样 ──
  // 目标挑宽度差最大的选项：宽度拉伸（水滴形态）才采得到
  const mouseSlide = JSON.parse(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      const group = groupOf('界面外观');
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0];
      let target = null;
      for (const b of radios) {
        if (b !== checked && (!target || Math.abs(b.offsetWidth - checked.offsetWidth) > Math.abs(target.offsetWidth - checked.offsetWidth))) target = b;
      }
      // 滚进视口再取坐标：CDP 鼠标事件按视口坐标派发，点在屏外会落空
      target.scrollIntoView({ block: "center" });
      const r = target.getBoundingClientRect();
      return JSON.stringify({
        point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
        targetLabel: target.textContent.trim(),
        targetX: target.offsetLeft,
        targetW: target.offsetWidth,
        startX: checked.offsetLeft,
        startW: checked.offsetWidth,
      });
    })()`),
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...mouseSlide.point, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouseSlide.point, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouseSlide.point, button: "left", clickCount: 1 });
  const slideFrames = JSON.parse(
    await cdp.evaluate(`(async () => {
      ${SAMPLE}
      const thumb = thumbOf('界面外观');
      const frames = await framesOf(thumb, 420);
      const g = geoOf(thumb);
      const group = groupOf('界面外观');
      const checked = [...group.querySelectorAll(':scope > [role="radio"]')].find((b) => b.getAttribute('aria-checked') === 'true');
      return JSON.stringify({ frames, end: { x: g.x, w: g.w }, checkedLabel: checked.textContent.trim() });
    })()`),
  );
  const xs = slideFrames.frames.map((f) => f.x);
  const lo = Math.min(mouseSlide.startX, mouseSlide.targetX);
  const hi = Math.max(mouseSlide.startX, mouseSlide.targetX);
  checker.check(
    "真实鼠标点击后选项选中",
    slideFrames.checkedLabel === mouseSlide.targetLabel,
    `${slideFrames.checkedLabel}`,
  );
  checker.check(
    "滑块有中间态（流过去不是跳变）",
    xs.some((x) => x > lo + 0.5 && x < hi - 0.5),
    `x ${mouseSlide.startX} → ${mouseSlide.targetX}，采样 ${xs.length} 帧`,
  );
  const peak = mouseSlide.targetX > mouseSlide.startX ? Math.max(...xs) : Math.min(...xs);
  const overshot = mouseSlide.targetX > mouseSlide.startX ? peak > mouseSlide.targetX + 1 : peak < mouseSlide.targetX - 1;
  checker.check(
    "滑块越过终点后回位（水滴回弹）",
    overshot && Math.abs(slideFrames.end.x - mouseSlide.targetX) < 1,
    `peak=${peak.toFixed(1)} target=${mouseSlide.targetX} end=${slideFrames.end.x.toFixed(1)}`,
  );
  const wLo = Math.min(mouseSlide.startW, mouseSlide.targetW);
  const wHi = Math.max(mouseSlide.startW, mouseSlide.targetW);
  checker.check(
    "滑块移动中被拉伸（宽度随行程形变）",
    slideFrames.frames.some((f) => f.w > wHi + 0.5 || f.w < wLo - 0.5),
    `w ${mouseSlide.startW} → ${mouseSlide.targetW}`,
  );
  checker.check(
    "落位与选中项对齐（状态同步）",
    Math.abs(slideFrames.end.x - mouseSlide.targetX) < 1 && Math.abs(slideFrames.end.w - mouseSlide.targetW) < 1,
    `end x=${slideFrames.end.x.toFixed(1)} w=${slideFrames.end.w.toFixed(1)}`,
  );

  // ── 关闭行为：真实 IPC 落盘 settings.json（mock 链做不到的验证点）──
  const exitClick = JSON.parse(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      const group = groupOf('关闭行为');
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const target = radios.find((b) => b.textContent.includes('直接退出'));
      if (!target) return JSON.stringify({ error: 'no-exit-option' });
      // 卡片在首屏之外：先滚进视口再取坐标，否则 CDP 鼠标事件点在视口外落空
      target.scrollIntoView({ block: "center" });
      const r = target.getBoundingClientRect();
      return JSON.stringify({
        point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      });
    })()`),
  );
  if (exitClick.error) {
    checker.check("关闭行为分段有「直接退出」选项（用于验证）", false, exitClick.error);
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...exitClick.point, button: "none" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...exitClick.point, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...exitClick.point, button: "left", clickCount: 1 });
    // update_settings 走真实 IPC + spawn_blocking，轮询等它落盘
    const settingsPath = join(appdata, "CursorStudio", "settings.json");
    let persisted = "";
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      try {
        persisted = JSON.parse(readFileSync(settingsPath, "utf8")).close_behavior ?? "";
      } catch {}
      if (persisted === "exit") break;
    }
    checker.check("关闭行为切换经真实 IPC 落盘 settings.json", persisted === "exit", `close_behavior=${persisted || "未落盘"}`);
  }

  // ── 键盘漫游：真实 ArrowRight（方向键立即选中，焦点跟随）──
  // 两步走：真实按键经 Input.dispatchKeyEvent 进窗口，随后再起采样窗
  const keyResult = JSON.parse(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      const group = groupOf('关闭行为');
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0];
      checked.focus();
      const next = radios[(radios.indexOf(checked) + 1) % radios.length];
      return JSON.stringify({ focusedLabel: document.activeElement.textContent.trim(), checkedLabel: checked.textContent.trim(), expectedLabel: next.textContent.trim() });
    })()`),
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39,
  });
  const keySlide = JSON.parse(
    await cdp.evaluate(`(async () => {
      ${SAMPLE}
      const group = groupOf('关闭行为');
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true');
      const thumb = thumbOf('关闭行为');
      const frames = await framesOf(thumb, 300);
      const g = geoOf(thumb);
      const tr = thumb.getBoundingClientRect();
      const cr = checked.getBoundingClientRect();
      return JSON.stringify({
        checkedLabel: checked.textContent.trim(),
        focusedLabel: document.activeElement.textContent.trim(),
        frames,
        end: { x: g.x, w: g.w },
        aligned: Math.abs(tr.left - cr.left) < 1 && Math.abs(tr.width - cr.width) < 1,
      });
    })()`),
  );
  checker.check(
    "真实方向键立即选中下一项（焦点项 + → 环回下一项）",
    keyResult.checkedLabel !== keySlide.checkedLabel && keySlide.checkedLabel === keyResult.expectedLabel,
    `${keyResult.checkedLabel} → ${keySlide.checkedLabel}（预期 ${keyResult.expectedLabel}）`,
  );
  checker.check("键盘切换后焦点跟随选中项", keySlide.focusedLabel === keySlide.checkedLabel, keySlide.focusedLabel);
  checker.check(
    "键盘触发的滑动有中间态",
    keySlide.frames.some((f) => f.x !== keySlide.end.x),
    `采样 ${keySlide.frames.length} 帧`,
  );
  checker.check("键盘切换后滑块落位对齐", keySlide.aligned, `end x=${keySlide.end.x.toFixed(1)}`);

  // ── reload：滑块首帧即对齐持久化值（首挂载测量，无动画路径）──
  await cdp.send("Page.reload");
  const reloaded = await waitAppReady(cdp.evaluate);
  await sleep(1200);
  checker.check("reload 后应用就绪", reloaded);
  await cdp.evaluate(`(() => {
    [...document.querySelectorAll('nav[aria-label="主导航"] button')]
      .find((b) => b.textContent.includes('设置'))?.click();
  })()`);
  let realign = false;
  let realignDetail = "";
  for (let i = 0; i < 20; i++) {
    const ok = await cdp.evaluate(`(() => {
      ${SAMPLE}
      const thumb = thumbOf('关闭行为');
      if (!thumb) return false;
      const group = groupOf('关闭行为');
      const checked = [...group.querySelectorAll(':scope > [role="radio"]')].find((b) => b.getAttribute('aria-checked') === 'true');
      if (!checked) return false;
      const tr = thumb.getBoundingClientRect();
      const cr = checked.getBoundingClientRect();
      return Math.abs(tr.left - cr.left) < 1 && Math.abs(tr.width - cr.width) < 1;
    })()`).catch(() => false);
    if (ok) {
      realign = true;
      break;
    }
    await sleep(200);
  }
  realignDetail = await cdp
    .evaluate(`(() => {
    ${SAMPLE}
    const thumb = thumbOf('关闭行为');
    const group = groupOf('关闭行为');
    const checked = [...group.querySelectorAll(':scope > [role="radio"]')].find((b) => b.getAttribute('aria-checked') === 'true');
    return checked ? checked.textContent.trim() + " x=" + geoOf(thumb).x.toFixed(1) : "无选中项";
  })()`)
    .catch(() => "");
  checker.check("reload 后滑块首帧即对齐持久化的选中项", realign, realignDetail);

  // ── 主题切换时序编排（决策 70）：配色翻转晚于滑块 ──
  // 真机症状正是「切深色看不见轨迹、还卡一下」：旧实现点击后 11ms 就翻
  // html.dark，轨迹全程泡在深色低对比配色里，整页重排还与滑块抢同一帧。
  // 现在选中态立即生效，配色等滑块 320ms 行程走完（330ms）一次翻过去
  const choreo = JSON.parse(
    await cdp.evaluate(`(async () => {
      const group = document.querySelector('[aria-label="界面外观"]');
      if (!group) return JSON.stringify({ error: 'no-group' });
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0];
      const light = radios.find((b) => b.textContent.includes('浅色'));
      const dark = radios.find((b) => b.textContent.includes('深色'));
      const thumb = group.querySelector(':scope > span[aria-hidden]');
      light.click();
      await new Promise((r) => setTimeout(r, 700));
      const frames = [];
      const t0 = performance.now();
      dark.click();
      while (performance.now() - t0 < 800) {
        await new Promise((r) => requestAnimationFrame(r));
        frames.push({
          t: Math.round(performance.now() - t0),
          dark: document.documentElement.classList.contains('dark'),
          x: (() => { const tr = getComputedStyle(thumb).translate; return tr === 'none' ? 0 : parseFloat(tr); })(),
        });
      }
      const firstDark = frames.find((f) => f.dark)?.t ?? -1;
      const firstMove = frames.find((f) => f.x > 93)?.t ?? -1; // 浅色位 x=92
      checked.click();
      await new Promise((r) => setTimeout(r, 700));
      return JSON.stringify({ startDark: frames[0].dark, firstDark, firstMove, endDark: frames[frames.length - 1].dark });
    })()`),
  );
  if (choreo.error) {
    checker.check("界面外观分段控件在设置页（用于验证）", false, choreo.error);
  } else {
    checker.check(
      "配色翻转晚于滑块起步（点击瞬间不闪变，决策 70）",
      choreo.startDark === false && choreo.firstMove > 0 && choreo.firstMove < 150,
      `起步 ${choreo.firstMove}ms / 翻转 ${choreo.firstDark}ms`,
    );
    checker.check(
      "配色在滑块到位后一次翻转（真机）",
      choreo.firstDark >= 300 && choreo.firstDark < 800 && choreo.endDark === true,
      `firstDark=${choreo.firstDark}ms`,
    );
  }

  // ── 证据截图（决策 70 的真机故事）：真实速度下「滑块先走、配色后翻」──
  // captureScreenshot 有 ~200ms 合成延迟拍不到 320ms 动画；慢动作（改
  // --motion-spring token）又会把 CSS 行程拉长而 JS 的 330ms 延迟不变，时序失真。
  // 改用 Page.screencastFrame 流：真实速度逐帧落盘，按点击后的毫秒数挑帧。
  // 截图是证据不是断言：拿不到帧时降级为 SKIP，不影响验证结论
  mkdirSync(shotsDir, { recursive: true });
  const castFrames = [];
  const offCast = cdp.onEvent((method, params) => {
    if (method === "Page.screencastFrame" && params?.data) {
      castFrames.push({ at: Date.now(), data: params.data });
      // 不回应帧确认浏览器会停止推流
      void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
    }
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(400); // 预热：等第一批判帧进来
  // 归一到「跟随系统」（系统浅色 → 浅色主题），再点深色：126px 的右向长行程，
  // 中间帧才骑在两钮交界上看得清；翻转（330ms）落在这条轨迹播完之后
  await cdp.evaluate(`(() => {
    const group = document.querySelector('[aria-label="界面外观"]');
    [...group.querySelectorAll(':scope > [role="radio"]')].find((b) => b.textContent.includes('跟随系统'))?.click();
  })()`);
  await sleep(700);
  await sleep(700); // 归一后的滑动与配色翻转落定；screencast 在静止画面不推帧，
  // 点击前的最后一帧天然是"浅色主题、滑块停在跟随系统"的 before
  const clickAt = Date.now();
  await cdp.evaluate(`(() => {
    const group = document.querySelector('[aria-label="界面外观"]');
    const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
    const target = radios.find((b) => b.textContent.includes('深色'));
    group.scrollIntoView({ block: "center" });
    target.click();
  })()`);
  await sleep(900);
  await cdp.send("Page.stopScreencast");
  offCast();
  const rel = castFrames.map((f) => ({ ...f, dt: f.at - clickAt }));
  const beforeShot = rel.filter((f) => f.dt < -80).at(-1);
  const midShot = rel
    .filter((f) => f.dt >= 20 && f.dt <= 260)
    .sort((a, b) => Math.abs(a.dt - 60) - Math.abs(b.dt - 60))[0];
  const flippedShot = rel.find((f) => f.dt > 450);
  const saveShot = (frame, name) => {
    if (!frame) {
      console.log(`[SKIP] 截图 ${name}：screencast 未捕到对应帧`);
      return;
    }
    writeFileSync(join(shotsDir, name), Buffer.from(frame.data, "base64"));
  };
  saveShot(beforeShot, "29-segmented-slide-before.png");
  saveShot(midShot, "30-segmented-slide-mid.png");
  saveShot(flippedShot, "31-segmented-slide-dark-flipped.png");
  console.log(`[shot] 帧数 ${castFrames.length}，选中帧 dt: before=${beforeShot?.dt ?? "无"} mid=${midShot?.dt ?? "无"} flipped=${flippedShot?.dt ?? "无"}`);

  // ── 减少动态：真机 WebView2 里全局兜底把滑块时长压到 0.01ms、即时到位 ──
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedDuration = parseFloat(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      return geoOf(thumbOf('界面外观')).duration;
    })()`),
  );
  const reducedClick = JSON.parse(
    await cdp.evaluate(`(() => {
      ${SAMPLE}
      const group = groupOf('界面外观');
      const radios = [...group.querySelectorAll(':scope > [role="radio"]')];
      const checked = radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0];
      const target = radios.find((b) => b !== checked);
      target.scrollIntoView({ block: "center" });
      const r = target.getBoundingClientRect();
      return JSON.stringify({ point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }, targetX: target.offsetLeft, targetW: target.offsetWidth });
    })()`),
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...reducedClick.point, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...reducedClick.point, button: "left", clickCount: 1 });
  const reducedSettled = JSON.parse(
    await cdp.evaluate(`(async () => {
      ${SAMPLE}
      const thumb = thumbOf('界面外观');
      const t0 = performance.now();
      while (performance.now() - t0 < 150) {
        await new Promise((r) => requestAnimationFrame(r));
        const g = geoOf(thumb);
        if (Math.abs(g.x - ${reducedClick.targetX}) < 1 && Math.abs(g.w - ${reducedClick.targetW}) < 1) {
          return JSON.stringify({ settledMs: performance.now() - t0 });
        }
      }
      return JSON.stringify({ settledMs: null, x: geoOf(thumb).x, w: geoOf(thumb).w });
    })()`),
  );
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });
  checker.check("减少动态下滑块时长压到 0.01ms", reducedDuration > 0 && reducedDuration < 0.001, `${reducedDuration}s`);
  checker.check(
    "减少动态下点击即时到位（无半截动画）",
    reducedSettled.settledMs !== null,
    reducedSettled.settledMs === null ? `x=${reducedSettled.x} w=${reducedSettled.w}` : `${reducedSettled.settledMs.toFixed(0)}ms 内对齐`,
  );

  checker.check("运行期无 JS 异常", cdp.pageErrors.length === 0, cdp.pageErrors.join(" | "));

  checker.finish("分段滑块真机验证");
} finally {
  killApp();
  cleanup();
}
