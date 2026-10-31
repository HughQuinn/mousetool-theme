import { actionBusyKey, useThemeStore } from "@/stores/themeStore";
import { readableError, toast } from "@/lib/toast";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  pickRotationTarget,
  rotationYields,
} from "@/lib/theme-rotate-core";

/**
 * 定时轮换主题（决策 55，设置 → 通用）
 *
 * 按固定间隔在「我的主题」里轮着应用：每次到点应用「当前主题的下一套」，
 * 循环推进。与其它自动行为的优先级刻意排成——**轮换是最低的那个**：
 * 跟随系统切换（决策 25）或定时切换（决策 33）任一开启时轮换让位，
 * 否则三套自动行为会在同一次注册表写入上打架。
 *
 * 触发只有一条：间隔定时器（`setTimeout` 链，与决策 33 的边界定时器同款）。
 * 不轮询注册表、不做后台服务；应用复用 `applyTheme`，历史与「正在使用」
 * 口径完全同源。电脑睡眠跨过多个周期后只会补应用一次（定时器晚触发），
 * 不追账——轮换是「每隔一段时间换一个」，不是「把错过的都补上」。
 *
 * 挂起语义与决策 33 相同：手动「还原默认」后挂起，到下一个周期或用户
 * 改轮换设置时恢复。纯函数（候选 / 下一套 / 让位判断）在
 * `lib/theme-rotate-core.ts`，node --test 直接覆盖。
 */

const state = {
  /** init 之前不动作，避免 App 挂载早期抢跑 */
  armed: false,
  /** 同一时刻只允许一次轮换应用在途 */
  applying: false,
  /** 手动还原默认后挂起，直到下一个周期或用户改轮换设置 */
  suspended: false,
  /** 下一次轮换的定时器；设置变化时重排 */
  timer: null as ReturnType<typeof setTimeout> | null,
};

function armTimer(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const settings = useSettingsStore.getState().settings;
  if (!settings?.rotate_enabled || rotationYields(settings)) return;
  // 最大档 1440 分钟 = 86_400_000ms，远在 setTimeout 的 2^31 上限之内
  const delay = settings.rotate_interval_minutes * 60_000;
  state.timer = setTimeout(() => {
    state.timer = null;
    // 新周期开始：挂起解除（与决策 33「边界解除挂起」同一语义）
    state.suspended = false;
    void rotateOnce();
    armTimer();
  }, delay);
}

async function rotateOnce(): Promise<void> {
  if (!state.armed || state.applying || state.suspended) return;

  const settings = useSettingsStore.getState().settings;
  if (!settings?.rotate_enabled || rotationYields(settings)) return;

  const themeState = useThemeStore.getState();
  if (themeState.loading || themeState.loadError) return;
  if (themeState.themes.length === 0) return; // 列表没就绪：本轮跳过，等下一轮
  const target = pickRotationTarget(themeState.themes, themeState.activeThemeId);
  if (!target) return;
  // 用户恰好在手动应用同一套：让位，别挤在同一个 busy 键上
  if (themeState.busy[actionBusyKey("apply", target)]) return;

  state.applying = true;
  try {
    await themeState.applyTheme(target, { silent: true });
    // 应用失败时 activeThemeId 不会变（失败提示由 applyTheme 给过）；
    // 成功才报来路，让人知道这次切换是轮换干的
    if (useThemeStore.getState().activeThemeId === target) {
      const name = useThemeStore.getState().themes.find((t) => t.id === target)?.name ?? target;
      toast.info(`定时轮换：已应用「${name}」`, "按设定的间隔自动轮换我的主题");
    }
  } catch (err) {
    // applyTheme 内部已兜住错误；这里只收口不留未处理 Promise
    console.error("[theme-rotate]", readableError(err));
  } finally {
    state.applying = false;
  }
}

export function initThemeRotate(): () => void {
  state.armed = true;
  armTimer();

  // 还原默认（非 null → null）即挂起；轮换自己的应用不会触发这条
  const unsubThemes = useThemeStore.subscribe((now, prev) => {
    if (now.activeThemeId === null && prev.activeThemeId !== null) {
      state.suspended = true;
    }
  });

  // 设置补丁只认自己的字段：开关 / 间隔变化要解除挂起并重排定时器，
  // 别的设置变更不该把挂起顶掉
  const unsubSettings = useSettingsStore.subscribe((now, prev) => {
    const a = now.settings;
    const b = prev.settings;
    if (
      a?.rotate_enabled !== b?.rotate_enabled ||
      a?.rotate_interval_minutes !== b?.rotate_interval_minutes
    ) {
      state.suspended = false;
      armTimer();
    }
  });

  return () => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    unsubThemes();
    unsubSettings();
    state.armed = false;
  };
}

// 开发期暴露一轮「立即轮换」：真实定时器间隔太长，验收脚本用钩子驱动同一
// 条 rotateOnce 链路。生产构建里 `import.meta.env.DEV` 为 false，整块会被摇掉。
if (import.meta.env.DEV) {
  (globalThis as unknown as { __themeRotateTick?: () => void }).__themeRotateTick = () => {
    void rotateOnce();
  };
}
