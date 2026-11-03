// 真机验证（决策 53/54/55）：应用次数统计、回收站恢复为副本、定时轮换设置。
//
// 与浏览器 mock 不同，这条链路验证真实 IPC 参数名、命令注册、真实文件系统上的
// 回收站 / theme.json / settings.json 落盘。数据根用隔离的 LOCALAPPDATA，
// 不碰用户真实主题 / 备份；**全程不调用 apply_theme / restore_default 等写
// 注册表的命令**（真机窗口的注册表不隔离，改了就是用户的真实光标）——
// 轮换的「到点自动应用」复用 apply_theme 既有链路，不在真机触发。
// 前置：应用未运行、vite 已在 1420（见同目录 README）。
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertNoRunningInstance,
  cleanup,
  connectCdp,
  createChecker,
  killApp,
  launchApp,
  prepareRoot,
  ROOT,
  sleep,
  waitAppReady,
  waitPageTarget,
} from "./lib.mjs";

const { appdata, pack } = prepareRoot();
const checker = createChecker();
const dataRoot = join(appdata, "CursorStudio");
const themesRoot = join(dataRoot, "themes");
const cursorSource = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Cursors",
  "aero_arrow.cur",
);

/** 截图落到临时目录（不入库；证据截图由人工筛选后复制进 docs/real-machine-verify/）。
 *  放在 cs-rm-verify 之外：脚本的 cleanup() 会整根清掉验证数据根，截图要留档 */
const SHOT_DIR = join(process.env.TEMP ?? ".", "cs-rm-shots");
let shotIndex = 0;
async function screenshot(cdp, name) {
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = join(SHOT_DIR, `${String(shotIndex + 1).padStart(2, "0")}-${name}.png`);
  writeFileSync(file, Buffer.from(res.result.data, "base64"));
  shotIndex += 1;
  console.log(`  screenshot: ${file}`);
  return file;
}

let app = null;
try {
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const name of ["count-a", "count-b"]) {
    const dir = join(pack, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(cursorSource, join(dir, "arrow.cur"));
  }

  assertNoRunningInstance();
  app = launchApp(appdata);
  const page = await waitPageTarget();
  const cdp = connectCdp(page);
  await cdp.opened;
  await cdp.send("Page.enable", {});
  const ready = await waitAppReady(cdp.evaluate);
  checker.check("应用启动且主题列表就绪（隔离数据根）", ready);

  const invoke = async (command, args) => {
    // 本脚本要断言「命令拒绝的原因文案」：Tauri 的 Err(String) 到 CDP 是
    // **字符串拒绝**，exceptionDetails 里只有 exception.value 没有 description
    // （lib.mjs 的通用封装拿不到原文），这里本地提取完整原因。
    const res = await cdp.send("Runtime.evaluate", {
      expression: `__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      const detail = res.result.exceptionDetails;
      const text =
        detail.exception?.description ?? detail.exception?.value ?? detail.text ?? "命令执行失败";
      throw new Error(typeof text === "string" ? text : JSON.stringify(text));
    }
    return res.result?.result?.value;
  };
  const store = (expr) => cdp.evaluate(`globalThis.__themeStore.getState().${expr}`);

  // ---------------------------------------------------------------- 导入两套
  const first = await invoke("import_theme", { sourcePath: join(pack, "count-a") });
  const second = await invoke("import_theme", { sourcePath: join(pack, "count-b") });
  const aId = first?.theme?.id;
  const bId = second?.theme?.id;
  checker.check(
    "两套主题真实导入（文件夹入口）",
    Boolean(aId && bId && aId !== bId),
    `${aId} / ${bId}`,
  );
  checker.check("导入的主题名取自目录名", first?.theme?.name === "count-a", first?.theme?.name);

  // ---------------------------------------------------------------- 决策 53：应用次数
  // 直接在隔离数据根写 v2 事件流（不调 apply_theme——它会写真实注册表光标），
  // 验证后端派生 + IPC 序列化 + 前端展示整条只读链路。
  const events = [
    { theme_id: aId, name: "count-a", is_built_in: false, applied_at: "2026-11-01 09:12" },
    { theme_id: bId, name: "count-b", is_built_in: false, applied_at: "2026-11-01 08:30" },
    { theme_id: aId, name: "count-a", is_built_in: false, applied_at: "2026-10-31 22:00" },
    { theme_id: "00000000-0000-4000-8000-000000000000", name: "已删除的旧主题", is_built_in: false, applied_at: "2026-10-30 21:10" },
    { theme_id: aId, name: "count-a", is_built_in: false, applied_at: "2026-10-29 07:45" },
  ];
  writeFileSync(
    join(dataRoot, "history.json"),
    JSON.stringify({ version: 2, events }),
    "utf8",
  );
  const withCounts = await invoke("get_all_themes", {});
  const countOf = (id) =>
    withCounts?.apply_counts?.find((item) => item.theme_id === id)?.count ?? null;
  checker.check(
    "apply_counts 按事件流派生（A 3 次 / B 1 次）",
    countOf(aId) === 3 && countOf(bId) === 1,
    JSON.stringify(withCounts?.apply_counts),
  );
  checker.check(
    "已删除主题的事件也计入次数（后端不裁剪，前端按列表过滤）",
    countOf("00000000-0000-4000-8000-000000000000") === 1,
  );

  await store("loadThemes()");
  await sleep(800);
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll("nav button")].find(b => b.textContent.includes("我的主题"));
    btn?.click();
    return Boolean(btn);
  })()`);
  await sleep(800);
  const countCells = JSON.parse(
    await cdp.evaluate(
      `JSON.stringify({
        header: [...document.querySelectorAll("th")].some(th => th.textContent.includes("应用次数")),
        a: document.querySelector("[data-apply-count='${aId}']")?.textContent.trim() ?? null,
        b: document.querySelector("[data-apply-count='${bId}']")?.textContent.trim() ?? null,
      })`,
    ),
  );
  checker.check(
    "真实窗口「应用次数」列与事件流一致",
    countCells.header && countCells.a === "3 次" && countCells.b === "1 次",
    JSON.stringify(countCells),
  );
  await screenshot(cdp, "my-themes-apply-counts");

  // ---------------------------------------------------------------- 决策 54：恢复为副本
  // 1) 普通删除 → 普通恢复（新增 theme_id 字段真机回归）
  const del1 = await invoke("delete_theme", { themeId: aId });
  checker.check("删除真实移入回收站", del1?.auto_purged === 0 && !del1?.warning, JSON.stringify(del1));
  const trash1 = await invoke("list_trash", {});
  const entry1 = trash1?.entries?.find((entry) => entry.theme_id === aId);
  checker.check("回收站条目可查（theme_id 对应 A）", Boolean(entry1?.id), JSON.stringify(trash1?.entries?.map(e => e.theme_id)));
  const restored1 = await invoke("restore_from_trash", { entryId: entry1.id });
  checker.check(
    "普通恢复返回原主题 ID（RestoreOutcome.theme_id 新字段）",
    restored1?.theme_id === aId && !restored1?.warning,
    JSON.stringify(restored1),
  );
  checker.check("恢复后 A 目录真实回来", existsSync(join(themesRoot, aId, "theme.json")));

  // 2) 同 ID 冲突：删 A → 把 A 目录复制回来制造「已被同 ID 占用」
  const del2 = await invoke("delete_theme", { themeId: aId });
  const trash2 = await invoke("list_trash", {});
  const entry2 = trash2?.entries?.find((entry) => entry.theme_id === aId);
  checker.check(
    "第二次删除进入回收站",
    del2?.auto_purged === 0 && Boolean(entry2?.id),
    JSON.stringify({ deleted_at: entry2?.deleted_at }),
  );
  // 制造「同 ID 已被占用」：软删除后原目录已进回收站，按原 id 手工重建一套
  // 同 ID 主题（theme.json 与槽位文件齐全，等价于「从备份恢复过同 ID」的场景）
  const conflictDir = join(themesRoot, aId);
  mkdirSync(join(conflictDir, "cursors"), { recursive: true });
  copyFileSync(cursorSource, join(conflictDir, "cursors", "arrow.cur"));
  writeFileSync(
    join(conflictDir, "theme.json"),
    JSON.stringify(
      {
        id: aId,
        name: "count-a",
        description: "",
        created_at: "2026-11-01 12:00",
        updated_at: "2026-11-01 12:00",
        is_built_in: false,
        cursors: [
          {
            registry_key: "Arrow",
            display_name: "正常选择",
            english_name: "Normal Select",
            file_path: "cursors/arrow.cur",
            file_type: "cur",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  const refused = await invoke("restore_from_trash", { entryId: entry2.id }).catch((err) => String(err?.message ?? err));
  checker.check(
    "同 ID 被占时普通恢复仍被拒绝（原语义不变）",
    typeof refused === "string" && refused.includes("同 ID"),
    refused,
  );
  // 3) 恢复为副本：新 UUID 落盘、theme.json 改写、名称加「（副本）」、条目消费
  const copyOutcome = await invoke("restore_from_trash", { entryId: entry2.id, asCopy: true });
  const copyId = copyOutcome?.theme_id;
  checker.check(
    "asCopy 恢复成功并返回新主题 ID",
    typeof copyId === "string" && copyId !== aId && /^[0-9a-f-]{36}$/.test(copyId) && !copyOutcome?.warning,
    JSON.stringify(copyOutcome),
  );
  const copyJson = JSON.parse(readFileSync(join(themesRoot, copyId ?? "x", "theme.json"), "utf8"));
  checker.check(
    "副本 theme.json 的 id 与目录名一致、名称带「（副本）」、槽位仍是相对路径",
    copyJson.id === copyId && copyJson.name === "count-a（副本）" && copyJson.cursors[0].file_path === "cursors/arrow.cur",
    JSON.stringify({ id: copyJson.id, name: copyJson.name, slot: copyJson.cursors[0].file_path }),
  );
  checker.check(
    "副本光标文件真实复制",
    existsSync(join(themesRoot, copyId, "cursors", "arrow.cur")),
  );
  const trash3 = await invoke("list_trash", {});
  checker.check(
    "副本恢复后原条目被消费",
    !(trash3?.entries ?? []).some((entry) => entry.id === entry2.id),
    `${trash3?.entries?.length ?? 0} 条剩余`,
  );
  const afterCopy = await invoke("get_all_themes", {});
  const copyTheme = (afterCopy?.themes ?? []).find((theme) => theme.id === copyId);
  checker.check(
    "副本出现在主题列表且是独立一套",
    copyTheme?.name === "count-a（副本）" && (afterCopy?.themes ?? []).some((theme) => theme.id === aId),
  );
  await store("loadThemes()");
  await sleep(800);
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll("nav button")].find(b => b.textContent.includes("我的主题"));
    btn?.click();
    return Boolean(btn);
  })()`);
  await sleep(800);
  const copyRow = await cdp.evaluate(
    `[...document.querySelectorAll("[data-theme-row]")].some(row => row.textContent.includes("（副本）"))`,
  );
  checker.check("真实窗口列表出现「（副本）」行", copyRow === true);
  await screenshot(cdp, "my-themes-trash-copy");

  // ---------------------------------------------------------------- 决策 55：轮换设置
  const defaults = await invoke("get_settings", {});
  checker.check(
    "轮换设置缺省关闭、间隔默认 60 分钟",
    defaults?.rotate_enabled === false && defaults?.rotate_interval_minutes === 60,
    `enabled=${defaults?.rotate_enabled} minutes=${defaults?.rotate_interval_minutes}`,
  );
  const patched = await invoke("update_settings", {
    rotateEnabled: true,
    rotateIntervalMinutes: 240,
  });
  checker.check(
    "update_settings 真机写入轮换开关与间隔",
    patched?.rotate_enabled === true && patched?.rotate_interval_minutes === 240,
    `enabled=${patched?.rotate_enabled} minutes=${patched?.rotate_interval_minutes}`,
  );
  const settingsRaw = readFileSync(join(dataRoot, "settings.json"), "utf8");
  checker.check(
    "settings.json 真实落盘含新键",
    settingsRaw.includes('"rotate_enabled": true') && settingsRaw.includes('"rotate_interval_minutes": 240'),
  );
  const tooSmall = await invoke("update_settings", { rotateIntervalMinutes: 5 }).catch((err) => String(err?.message ?? err));
  const tooBig = await invoke("update_settings", { rotateIntervalMinutes: 1441 }).catch((err) => String(err?.message ?? err));
  checker.check(
    "间隔越界（5 / 1441）被后端拒绝并点名收到值",
    typeof tooSmall === "string" && tooSmall.includes("定时轮换间隔") && tooSmall.includes("收到 5") &&
      typeof tooBig === "string" && tooBig.includes("定时轮换间隔") && tooBig.includes("收到 1441"),
    `${tooSmall} / ${tooBig}`,
  );
  // 设置页轮换卡真实渲染（间隔下拉应反映 240）
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll("nav button")].find(b => b.textContent.trim() === "设置");
    btn?.click();
    return Boolean(btn);
  })()`);
  await sleep(800);
  const rotateUi = JSON.parse(
    await cdp.evaluate(
      `JSON.stringify({
        select: document.querySelector("[data-rotate-select]")?.value ?? null,
        status: document.querySelector("[data-rotate-status]")?.textContent ?? "",
      })`,
    ),
  );
  checker.check(
    "真实窗口轮换卡片渲染（开关生效、间隔 240）",
    rotateUi.select === "240" && rotateUi.status.length > 0,
    JSON.stringify(rotateUi),
  );
  await screenshot(cdp, "settings-rotate-card");

  const errors = cdp.pageErrors.length;
  checker.check("运行期无 JS 异常", errors === 0, `${errors} 条`);
  checker.finish("迭代三功能真机验证（决策 53/54/55）");
} catch (err) {
  console.error(err);
  checker.check("真机验证执行", false, String(err));
  checker.finish("迭代三功能真机验证（决策 53/54/55）");
} finally {
  if (app) {
    killApp();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanup();
}
