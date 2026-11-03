import { useEffect, useRef } from "react";

interface AniPlayerProps {
  /** 各帧 PNG 的 base64 列表 */
  frames: string[];
  /** 帧间隔（毫秒） */
  rateMs: number;
  /** 画布尺寸上限，由外层按场景传入（默认槽位卡的 48px） */
  className?: string;
}

/**
 * 用 canvas 逐帧播放动态光标
 *
 * 只在**看得见**的时候跑：一个 15 槽位主题在检查器里会同时挂十几块画布，
 * 每块都是一条 setTimeout 链；滚出视野之后还照跑，纯属白烧 CPU。
 * 窗口失焦（用户切去别的应用）同理：动画在后台窗口里没人看，
 * `visibilitychange` 只管最小化，管不到「可见但没焦点」。
 * 停表时保留最后一帧，所以视觉上没有任何变化。
 *
 * 系统开启「减少动态效果」时只画第一帧：帧间切换本身就是动画，
 * 在这个偏好下不该继续播放；偏好中途改变也会跟着停/续。
 */
export function AniPlayer({ frames, rateMs, className = "max-h-12 max-w-12" }: AniPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // frames 数组每次渲染都是新引用，用内容长度 + 首帧做稳定标识避免重复播放
  const key = `${frames.length}:${frames[0]?.slice(0, 32) ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let index = 0;
    let images: HTMLImageElement[] = [];
    /** 画布是否在视口内 */
    let intersecting = true;
    /** 宿主窗口是否有焦点；blur / focus 事件驱动（初值恒真，见下方监听处的说明） */
    let windowFocused = true;
    /** 当前是否停表（离屏 / 窗口不可见 / 失焦） */
    let blocked = false;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    /** 是否至少画过一帧：减少动态效果下只在首次显示时画一次 */
    let drawn = false;

    const canvas = canvasRef.current;

    const decode = (b64: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `data:image/png;base64,${b64}`;
      });

    const draw = () => {
      if (!canvas || images.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(images[index % images.length], 0, 0);
      index += 1;
      drawn = true;
    };

    const step = () => {
      if (cancelled || blocked) return;
      draw();
      if (reduced) return;
      timer = window.setTimeout(step, Math.max(rateMs, 16));
    };

    const stop = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    /** 三个停表条件（离屏 / 窗口不可见 / 失焦）合成一个状态，任一条成立就停 */
    const sync = () => {
      const next = document.hidden || !intersecting || !windowFocused;
      if (next === blocked) return;
      blocked = next;
      if (blocked) stop();
      else if (!reduced || !drawn) step();
    };

    Promise.all(frames.map(decode))
      .then((loaded) => {
        if (cancelled) return;
        images = loaded.filter((img): img is HTMLImageElement => img !== null);
        if (images.length === 0 || !canvas) return;

        canvas.width = Math.max(...images.map((i) => i.naturalWidth));
        canvas.height = Math.max(...images.map((i) => i.naturalHeight));
        step();
      })
      .catch(() => {
        /* 解码失败时保持空白，外层会显示占位 */
      });

    // 观察挂上就会先回调一次，拿到初始的可见性
    const observer = canvas ? new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      sync();
    }) : null;
    if (canvas && observer) observer.observe(canvas);

    const onVisibilityChange = () => sync();
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 失焦判定走事件而不是 document.hasFocus()：后者在无头 / 自动化环境里
    // 恒为 false，初值一错所有验收脚本里的动画就集体停摆。事件只在真的
    // 发生焦点迁移时到达，初值放「有焦点」对真实窗口也成立（亮窗即聚焦）。
    const onWindowFocusChange = (event: Event) => {
      windowFocused = event.type === "focus";
      sync();
    };
    window.addEventListener("blur", onWindowFocusChange);
    window.addEventListener("focus", onWindowFocusChange);

    const onMotionChange = () => {
      reduced = motionQuery.matches;
      if (reduced) stop();
      else if (!blocked) step();
    };
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      cancelled = true;
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowFocusChange);
      window.removeEventListener("focus", onWindowFocusChange);
      motionQuery.removeEventListener("change", onMotionChange);
      images = [];
    };
  }, [key, frames, rateMs]);

  return <canvas ref={canvasRef} className={`${className} object-contain`} aria-hidden />;
}
