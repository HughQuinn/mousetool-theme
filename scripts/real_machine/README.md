# 真机验证脚本（手动跑，不进 CI）

对**真实 Tauri 窗口**验证浏览器 mock 覆盖不到的路径（真实文件系统、真实编码、
真实系统光标）。与 `docs/real-machine-verify/` 的说明文档一一对应。

## 共同前置

1. **应用未在运行**（单实例互斥会让脚本启动的实例直接退出转交）：
   `tasklist | findstr mousetool-theme` 应为空。
2. **vite 已在 1420**：`npm run dev:bg start`（与应用同源加载前端）。
3. Rust 工具链可用（脚本会 `cargo run` 编译并启动应用，用**隔离的
   LOCALAPPDATA 数据根**，不碰用户真实主题 / 备份）。

## 脚本做什么

> `verify_cursor_size.mjs` 是唯一的例外：不启动应用（光标大小还没有命令），直接验证注册表假设；碰真实注册表前整键 `reg export` 备份、收工逐值还原。

| 脚本 | 验证 | 输入 |
|---|---|---|
| `verify_theme_scheme.mjs` | 决策 36：UTF-16LE `.theme` 解析、`%SystemRoot%` 展开到真实系统光标、同目录相对路径收编、真机查重成组 | 脚本自造（复制 `C:\Windows\Cursors\aero_*.cur/ani`） |
| `verify_themepack.mjs` | 决策 39：`makecab.exe`（微软自家 MSZIP 压缩器）打包的真实 CAB 解档 + 包内 `.theme` 映射 + DisplayName 优先 | 脚本自造（makecab DDF） |
| `verify_batch_delete.mjs` | 决策 43：真实 Tauri IPC 与真实回收站下导入两套主题 → `delete_themes`（重复 ID + 非法 ID）→ 主题库清空、回收站两条正常 | 脚本自造（复制 `C:\Windows\Cursors\aero_arrow.cur`） |
| `verify_import_duplicate.mjs` | 决策 47：同内容包二次导入 `duplicate_of` 点名 + warnings 人话版、不拦截；内容不同不误报 | 脚本自造（复制 `C:WindowsCursorsaero_arrow.cur`） |
| `verify_iterate_features.mjs` | 决策 53/54/55：`apply_counts` 按事件流真机派生并上窗口（手写隔离事件流，不碰注册表）；`restore_from_trash` 的 `asCopy` 新 UUID 落盘 + `theme.json` 改写 +「（副本）」、同 ID 冲突时普通恢复仍拒绝；轮换设置真机落盘、越界拒绝、设置卡渲染。**全程不调 `apply_theme`**（真机注册表不隔离，改了就是用户的真实光标） | 脚本自造（复制 `C:\Windows\Cursors\aero_arrow.cur` + 手写 v2 `history.json`、按原 ID 重建同 ID 主题） |
| `verify_ani_blur.mjs` | 决策 60：真实 OS 焦点迁移（激活桌面夺走焦点）下 AniPlayer 失焦停表（drawImage 计数冻结为 0）、重新聚焦续播；只读系统方案预览，不碰注册表与用户主题 | 无需造输入（PowerShell AppActivate 切焦点） |
| `verify_theme_meta.mjs` | 决策 61：`rename_theme` 的名称 + 描述补丁语义在真实 IPC 下可用——改名+描述一起生效、磁盘 `theme.json` 落盘、只改描述时名称与导入时间不动、空串清除、省略参数补丁语义、超长拒绝、列表重读一致 | 脚本自造（复制 `C:\Windows\Cursors\aero_arrow.cur`） |
| `verify_export_selected.mjs` | 决策 62：`export_all_themes` 传 ID 清单只导那套（真实 zip 落盘核验）、未知 ID 落空不报错、省略清单全量导出（重名加序号兜底顺带覆盖） | 脚本自造（复制 `C:\Windows\Cursors\aero_arrow.cur` × 2） |
| `verify_ui_smoke.mjs` | 纯前端改动的真机冒烟：真实 WebView2 窗口里三栏骨架 / 图库卡片 / 侧栏三态卡正常渲染、无 JS 异常。**全程不碰注册表**（不调 apply / restore）——动效与交互断言的主战场在浏览器 mock 链，这里只证明真实窗口里也成立 | 无需造输入 |
| `verify_cursor_size.mjs` | 决策 51：光标大小注册表路线的真机验证——`CursorBaseSize` / `AccessibilityCursorSize` 写入 + SPI 后实测光标位图不缩放，**假设被证伪**（退出码 1 = 假设未证实，本身是有效结论） | 无需造输入（reg.exe + PowerShell 直测，整键备份 + 逐值还原） |

三个脚本都会：启动隔离应用 → CDP 直连 `__TAURI_INTERNALS__.invoke` 断言 →
**按 PID 结束应用**（先取 `tasklist /FO CSV /NH` 的 PID，绝不通配杀）→
清理 `%TEMP%` 下的临时数据根。每条 CDP 消息带 15 秒超时，单点挂起不会卡死。

## 运行

```powershell
npm run dev:bg start
node scripts/real_machine/verify_theme_scheme.mjs
node scripts/real_machine/verify_themepack.mjs
node scripts/real_machine/verify_batch_delete.mjs
node scripts/real_machine/verify_import_duplicate.mjs
node scripts/real_machine/verify_iterate_features.mjs
node scripts/real_machine/verify_ani_blur.mjs
node scripts/real_machine/verify_theme_meta.mjs
node scripts/real_machine/verify_export_selected.mjs
node scripts/real_machine/verify_ui_smoke.mjs
npm run dev:bg stop
```

退出码 0 = 全过。截图落在 `%TEMP%\rm_verify*.png`（不入库）。
