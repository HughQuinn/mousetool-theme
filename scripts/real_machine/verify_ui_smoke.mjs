// 真机冒烟：真实 Tauri 窗口里 UI 正常渲染、无运行期异常。
//
// 纯前端改动（动效 / 右键菜单 / 键盘导航等）的验收主战场是浏览器 mock 链
//（motion_check / design_check / 各 feature check），真机这一层只确认
// 「真实窗口里也成立」：真实 WebView2 下渲染、布局、事件监听都活着。
// **全程不调 apply_theme / restore_default**——真机注册表不隔离，
// 改了就是用户的真实光标（决策 53/54/55 真机验证同一边界）。
// 隔离 LOCALAPPDATA 数据根。前置：应用未运行、vite 已在 1420。
import {
  assertNoRunningInstance,
  cleanup,
  connectCdp,
  createChecker,
  killApp,
  launchApp,
  prepareRoot,
  waitAppReady,
  waitPageTarget,
} from "./lib.mjs";

const { appdata } = prepareRoot();
const checker = createChecker();

let app = null;
try {
  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);

  // 给渲染与预览解码一点时间，再查布局与状态
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const layout = JSON.parse(
    await cdp.evaluate(`JSON.stringify({
      navItems: document.querySelectorAll('nav [aria-label="主导航"] button, nav button').length,
      cards: document.querySelectorAll("[data-theme-card]").length,
      stateLine: [...document.querySelectorAll("span")].some((s) =>
        ["当前使用中", "系统默认", "光标已被系统设置修改"].includes(s.textContent),
      ),
      inspector: Boolean(document.querySelector('aside[aria-label="主题详情"]')),
      windowSize: [window.innerWidth, window.innerHeight],
    })`),
  );
  checker.check(
    "三栏骨架与图库卡片正常渲染",
    layout.navItems >= 4 && layout.cards > 0 && layout.inspector,
    JSON.stringify({ nav: layout.navItems, cards: layout.cards, win: layout.windowSize }),
  );
  checker.check(
    "侧栏「当前使用」卡三态文案就位",
    layout.stateLine === true,
    "使用中 / 系统默认 / 被系统设置修改 三选一",
  );

  const errors = cdp.pageErrors;
  checker.check("真机窗口无 JS 异常", errors.length === 0, errors.join(" | "));

  checker.finish("UI 真机冒烟");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("UI 真机冒烟");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
