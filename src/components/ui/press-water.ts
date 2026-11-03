// 按压水滴反馈（决策 60）：涟漪荡开 + 松开后水珠衰减晃动。
// 全局委托而非逐组件挂载：侧栏导航等处是 buttonVariants() 类串配原生 <button>，
// 逐组件挂会漏；凡命中 `button.motion-press` 的按下都出水滴，未来变体自动获得。
// 两者都是一次性 WAAPI 动画（与 Toast FLIP 同级的一次性补间，不是常驻逐帧 JS）；
// prefers-reduced-motion 下整体跳过——缩放反馈仍由 motion-press 的 CSS transition 提供。
// 宿主容器的 relative + overflow-hidden 由 motion-press 工具类自带。
// 晃动用独立 scale 属性，不覆盖按下位移的 translate。

const SETTLE_KEYFRAMES: Keyframe[] = [
  { scale: "0.97", offset: 0 },
  { scale: "1.02", offset: 0.35 },
  { scale: "0.993", offset: 0.65 },
  { scale: "1.004", offset: 0.85 },
  { scale: "1", offset: 1 },
];

const RIPPLE_MS = 500;
const SETTLE_MS = 480;

export function installPressWater(): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const onUp = (el: HTMLButtonElement) => {
    el.animate(SETTLE_KEYFRAMES, {
      duration: SETTLE_MS,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  };

  const onDown = (event: PointerEvent) => {
    if (reduced.matches) return;
    const el = (event.target as Element | null)?.closest?.(
      "button.motion-press",
    ) as HTMLButtonElement | null;
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;

    const rect = el.getBoundingClientRect();
    const size = Math.hypot(rect.width, rect.height) * 2;
    const ripple = document.createElement("span");
    ripple.setAttribute("data-ripple", "");
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.cssText = [
      "position:absolute",
      `left:${event.clientX - rect.left - size / 2}px`,
      `top:${event.clientY - rect.top - size / 2}px`,
      `width:${size}px`,
      `height:${size}px`,
      "border-radius:9999px",
      "background:currentColor",
      "pointer-events:none",
    ].join(";");
    el.appendChild(ripple);
    ripple
      .animate(
        [
          { transform: "scale(0)", opacity: 0.22 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: RIPPLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      )
      .finished.then(() => ripple.remove())
      .catch(() => ripple.remove());

    window.addEventListener("pointerup", () => onUp(el), { once: true });
    window.addEventListener("pointercancel", () => onUp(el), { once: true });
  };

  document.addEventListener("pointerdown", onDown, true);
  return () => document.removeEventListener("pointerdown", onDown, true);
}
