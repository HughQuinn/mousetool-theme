import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { initCloseAsk, noteDevCloseAskAction } from "@/lib/close-ask";
import { readableError, toast } from "@/lib/toast";import { exitApp, hideWindowToTray } from "@/services/system";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * 关窗询问（决策 57）：关闭行为是「每次询问」时，Rust 拦下关窗并发
 * `close-ask` 事件，这里让用户当场选——缩到托盘（自动行为继续跑）或退出
 * （全部停止）。勾「不再询问」把这次的选择经 `update_settings` 落成新的
 * 关闭行为，之后不再弹；改回「每次询问」在 设置 → 通用。
 */
export function CloseAskDialog() {
  const patchSettings = useSettingsStore((s) => s.patchSettings);
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => initCloseAsk(() => setOpen(true)), []);

  const dismiss = () => {
    setOpen(false);
    setRemember(false);
    setBusy(false);
  };

  const choose = async (action: "tray" | "exit") => {
    if (busy) return;
    setBusy(true);
    try {
      // 落盘失败不拦动作：这次的选择仍然执行，patchSettings 失败会自行提示
      if (remember) await patchSettings({ close_behavior: action });
      // 动作日志由 services 的浏览器 mock 记（hide-to-tray / exit），这里不重复记
      if (action === "tray") await hideWindowToTray();
      else await exitApp();
      dismiss();
    } catch (err) {
      // 藏窗 / 退出命令失败：留在弹窗里可以重试或取消
      toast.error("操作失败", readableError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || busy) return;
        noteDevCloseAskAction("cancel");
        dismiss();
      }}
    >
      <DialogContent data-close-ask-dialog className="w-[26rem]">
        <DialogTitle>关闭窗口？</DialogTitle>
        <DialogDescription>
          最小化到托盘后，定时切换、定时轮换、光标守护等自动行为会继续运行；
          退出应用会全部停止。
        </DialogDescription>

        <label
          data-close-ask-remember
          className="mt-4 flex w-fit cursor-pointer items-center gap-2"
          onClick={() => setRemember((value) => !value)}
        >
          <Checkbox checked={remember} onCheckedChange={setRemember} label="不再询问" />
          <span className="text-sm">不再询问</span>
        </label>
        <p className="mt-1 text-2xs text-muted-foreground">
          勾选后记住这次的选择；可在 设置 → 通用 改回
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            data-close-ask="cancel"
            disabled={busy}
            onClick={() => {
              noteDevCloseAskAction("cancel");
              dismiss();
            }}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            data-close-ask="exit"
            disabled={busy}
            onClick={() => void choose("exit")}
          >
            退出应用
          </Button>
          <Button data-close-ask="tray" disabled={busy} onClick={() => void choose("tray")}>
            最小化到托盘
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
