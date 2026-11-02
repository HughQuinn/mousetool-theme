import { cn } from "@/lib/utils";

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 无障碍名称：开关没有可见标签时必须传 */
  label: string;
  disabled?: boolean;
}

/**
 * 开关（role="switch"）
 *
 * 桌面端开关对应 Windows 设置里的「开 / 关」两态，不做半开；
 * 滑块走 spring 曲线：到位后过冲一次再收回（决策 59），轨道颜色仍走 fast 档。
 */
export function Toggle({ checked, onCheckedChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-ring relative h-6 w-11 shrink-0 rounded-4xl transition-[background-color] duration-(--motion-fast) ease-standard",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-raised transition-[translate] duration-(--motion-spring) ease-spring",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
