// 真机验证（决策 61）：rename_theme 的名称 + 描述补丁语义在真实 IPC / 真实落盘下可用。
//
// 浏览器 mock 证明不了 IPC 参数名（newDescription）与 theme.json 磁盘写入；
// 这里导入一套主题后：改描述 → 磁盘核验；只改描述时名称不动；超长描述拒绝。
// 隔离 LOCALAPPDATA 数据根，不碰注册表与用户主题。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const { appdata, pack } = prepareRoot();
const checker = createChecker();
const cursorSource = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Cursors",
  "aero_arrow.cur",
);

let app = null;
try {
  const dir = join(pack, "meta-a");
  mkdirSync(dir, { recursive: true });
  copyFileSync(cursorSource, join(dir, "arrow.cur"));

  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪", ready);

  const invoke = (command, args) =>
    cdp.evaluate(
      `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
    );

  const imported = await invoke("import_theme", { sourcePath: dir });
  const themeId = imported?.theme?.id;
  checker.check("主题导入成功", Boolean(themeId), themeId ?? "?");

  // 改名 + 改描述一起提交
  const renamed = await invoke("rename_theme", {
    themeId,
    newName: "描述验证主题",
    newDescription: "真机验证用的描述",
  });
  checker.check(
    "改名 + 描述一起生效并返回",
    renamed?.name === "描述验证主题" && renamed?.description === "真机验证用的描述",
    JSON.stringify({ name: renamed?.name, description: renamed?.description }),
  );

  // 磁盘核验：theme.json 里两个值都已落盘
  const onDisk = JSON.parse(
    readFileSync(join(appdata, "CursorStudio", "themes", themeId, "theme.json"), "utf8"),
  );
  checker.check(
    "描述已写入磁盘 theme.json",
    onDisk.description === "真机验证用的描述" && onDisk.name === "描述验证主题",
    JSON.stringify({ name: onDisk.name, description: onDisk.description }),
  );

  // 只改描述：名称原样回传不动；updated_at 保持导入时间不变
  const before = (await invoke("get_all_themes", {})).themes.find((t) => t.id === themeId);
  const descOnly = await invoke("rename_theme", {
    themeId,
    newName: "描述验证主题",
    newDescription: "第二次改的描述",
  });
  checker.check(
    "只改描述时名称与导入时间不动",
    descOnly?.name === "描述验证主题" &&
      descOnly?.description === "第二次改的描述" &&
      descOnly?.updated_at === before?.updated_at,
    JSON.stringify({ name: descOnly?.name, description: descOnly?.description }),
  );

  // 命令内抛错要在页面里接住，才能拿到中文错误文案
  const invokeExpectError = async (command, args) =>
    cdp.evaluate(
      `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
        .then(() => "", (err) => String(err))`,
    );

  // 空串清除描述
  const cleared = await invoke("rename_theme", {
    themeId,
    newName: "描述验证主题",
    newDescription: "",
  });
  checker.check("空串清除描述", cleared?.description === "", JSON.stringify(cleared?.description));

  // 补丁语义：不传 newDescription 时描述保持原值
  await invoke("rename_theme", { themeId, newName: "描述验证主题", newDescription: "回来了" });
  const untouched = await invoke("rename_theme", { themeId, newName: "最终名字" });
  checker.check(
    "省略描述参数时描述不动",
    untouched?.name === "最终名字" && untouched?.description === "回来了",
    JSON.stringify({ name: untouched?.name, description: untouched?.description }),
  );

  // 超长描述拒绝（201 字）
  const rejected = await invokeExpectError("rename_theme", {
    themeId,
    newName: "最终名字",
    newDescription: "字".repeat(201),
  });
  checker.check("超长描述被拒绝", rejected.includes("200"), rejected || "未拒绝");

  // 列表重读后描述仍在
  const themes = await invoke("get_all_themes", {});
  const found = (themes?.themes ?? []).find((t) => t.id === themeId);
  checker.check(
    "列表重读后名称与描述一致",
    found?.name === "最终名字" && found?.description === "回来了",
    JSON.stringify({ name: found?.name, description: found?.description }),
  );

  checker.finish("主题描述编辑真机验证");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("主题描述编辑真机验证");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
