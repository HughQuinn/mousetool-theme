// 真机验证（决策 62）：export_all_themes 的 ID 清单在真实 IPC / 真实落盘下可用。
//
// 导入两套主题后：传清单只导那一套（目录里只有它的 zip）；省略清单导出全部；
// 清单外的 ID 落空不报错。隔离 LOCALAPPDATA 数据根，不碰注册表与用户主题。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
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
  for (const name of ["export-a", "export-b"]) {
    const dir = join(pack, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(cursorSource, join(dir, "arrow.cur"));
  }

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

  const first = await invoke("import_theme", { sourcePath: join(pack, "export-a") });
  const second = await invoke("import_theme", { sourcePath: join(pack, "export-b") });
  const firstId = first?.theme?.id;
  const secondId = second?.theme?.id;
  checker.check(
    "两套主题都能导入",
    Boolean(firstId && secondId && firstId !== secondId),
    `${firstId} / ${secondId}`,
  );

  const dest = join(pack, "out");
  mkdirSync(dest, { recursive: true });

  // 传清单：只导第一套
  const partial = await invoke("export_all_themes", {
    destDir: dest,
    themeIds: [firstId],
  });
  const partialFiles = readdirSync(dest);
  checker.check(
    "传 ID 清单时只导选中的那套",
    partial?.exported?.length === 1 &&
      partial.exported[0].theme_id === firstId &&
      partialFiles.length === 1,
    JSON.stringify(partialFiles),
  );

  // 清单外的 ID 落空：导出 0 套不报错
  const missing = await invoke("export_all_themes", {
    destDir: dest,
    themeIds: ["00000000-0000-4000-8000-000000000000"],
  });
  checker.check(
    "未知 ID 落空不报错",
    Array.isArray(missing?.exported) && missing.exported.length === 0,
    JSON.stringify(missing?.exported),
  );

  // 省略清单：全部导出（目录里两套各一个 zip，落盘名不冲突）
  const all = await invoke("export_all_themes", { destDir: dest });
  const allFiles = readdirSync(dest);
  checker.check(
    "省略清单时导出全部（清单内外共 3 个 zip）",
    all?.exported?.length === 2 &&
      allFiles.length === 3 &&
      allFiles.every((name) => name.toLowerCase().endsWith(".zip")),
    JSON.stringify(allFiles),
  );

  checker.finish("导出所选真机验证");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("导出所选真机验证");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
