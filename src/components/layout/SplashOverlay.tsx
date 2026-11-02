import { useEffect, useRef, useState } from "react";

import { emit } from "@tauri-apps/api/event";

import { inTauri } from "@/services/theme";
import { cn } from "@/lib/utils";

/**
 * 开屏遮罩：窗口出现 → WebView 首帧 → 数据就绪之间没有内容可看，
 * 盖一层品牌底把这段空白变成 logo，就绪后淡出让位。
 *
 * 退出条件是「就绪」不是计时：settings 读到且主题列表结束首次加载
 * （成功与 loadError 都算——错误态有 LoadErrorState 接管，开屏不能变成转圈）。
 * 两道保底：最短停留 800ms，数据太快就退会「闪一下」，比没有更难看；
 * 最长停留 5s，设置读取失败（ready 恒为 false）时也得放行。
 *
 * 只在 Tauri 里渲染：检查脚本跑在浏览器 mock 上，首屏断言不能被遮罩挡住。
 * 减少动态：不凑最短停留，就绪即走（入场/退场动画由全局兜底压到 0.01ms）。
 */
const MIN_HOLD_MS = 800;
const MAX_HOLD_MS = 5000;

export function SplashOverlay({ ready }: { ready: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(!inTauri);
  const enteredAt = useRef(0);

  useEffect(() => {
    enteredAt.current = performance.now();
  }, []);

  useEffect(() => {
    // 主窗此刻还藏着（tauri.conf.json visible:false）：遮罩已挂载，让 Rust
    // 把窗口亮出来，用户看到的第一帧就是完整的开屏。浏览器 mock 没有事件
    // 通道也不需要——检查脚本里遮罩压根不渲染
    if (inTauri) void emit("splash-ready").catch(() => {});
  }, []);

  useEffect(() => {
    if (gone) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minHold = reduceMotion ? 0 : MIN_HOLD_MS;
    const elapsed = () => performance.now() - enteredAt.current;
    const leave = () => setLeaving(true);
    const hold = ready
      ? window.setTimeout(leave, Math.max(0, minHold - elapsed()))
      : undefined;
    const cap = window.setTimeout(leave, Math.max(0, MAX_HOLD_MS - elapsed()));
    return () => {
      if (hold !== undefined) window.clearTimeout(hold);
      window.clearTimeout(cap);
    };
  }, [ready, gone]);

  if (gone) return null;

  return (
    <div
      data-splash
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-background",
        "transition-opacity duration-(--motion-slow) ease-exit",
        leaving ? "opacity-0" : "opacity-100",
      )}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && leaving) setGone(true);
      }}
    >
      <div className="splash-in flex flex-col items-center gap-4">
        <img src="/favicon.svg" alt="" className="size-20" />
        <p className="text-lg font-medium text-foreground">鼠标主题工具</p>
      </div>
    </div>
  );
}
