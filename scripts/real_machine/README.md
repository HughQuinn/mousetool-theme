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
| `verify_close_ask.mjs` | 决策 57：真实 WM_CLOSE（user32 直投主窗口句柄）下的关窗拦截——ask 弹询问框、取消不动设置、不勾选一次性藏窗且 settings.json 不落盘、勾选后 tray / exit 真实落盘、`exit_app` 进程自行结束、exit 模式跨重启直接退；二次启动唤回隐藏窗。可见性判据必须 EnumWindows 按标题 + `IsWindowVisible`（`.NET` 的 `MainWindowHandle` 会抓到 WebView2 宿主的无标题可见窗口，全程误报） | 无需造输入（WM_CLOSE 由脚本注入） |
| `verify_splash.mjs` | 决策 58：真实窗口下的开屏生命周期——遮罩出现、最短停留 ≥800ms、淡出有中间态（渐隐不是瞬消）、卸载时数据已就绪、减少动态下就绪即走（<400ms）、遮罩底色与页面底色一致、盖满窗口且不截胡指针事件。判定靠 CDP `addScriptToEvaluateOnNewDocument` 注入 rAF 逐帧探针 + `Page.reload` 确定性重放（冷启动与重放同一条 React 挂载路径） | 无需造输入 |
| `verify_spring_motion.mjs` | 决策 59：真实 WebView2 下的弹性按压反馈——CDP `Input.dispatchMouseEvent` 真实鼠标按下/释放采样按钮 scale（0.97→过冲回 1）、开关滑块位移过冲回位、对勾 `check-pop` 入场过冲、减少动态压到 0.01ms。复选框用例所需主题经 `import_theme` 文件夹导入造出（只落盘不应用）；CDP 直调绕过前端 store，导入后 `Page.reload` 重扫 | 复制 `C:\Windows\Cursors\aero_arrow.cur` |
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
node scripts/real_machine/verify_close_ask.mjs
node scripts/real_machine/verify_splash.mjs
node scripts/real_machine/verify_spring_motion.mjs
npm run dev:bg stop
```

退出码 0 = 全过。截图落在 `%TEMP%\cs-rm-shots\`（不入库；留档的证据截图由人工
筛选后复制进 `docs/real-machine-verify/`）。

## 诊断工具（无断言，不进验证链）

- `_measure_gap.mjs`：拆解启动时间线「进程 → 主窗口 → WebView 导航 → 首帧
  (FCP) → 开屏遮罩」，连跑冷 / 暖两轮，打印分段耗时与最慢资源。用法
  `node scripts/real_machine/_measure_gap.mjs dev|release`：dev 模式跑
  target/debug exe（需 vite 在 1420），release 模式跑 target/release exe
  （`cargo build --release --features tauri/custom-protocol` 构建的内嵌
  dist，无需 vite）。决策 58 的白屏前后对比就是用它量的；改启动 / 开屏
  链路后重跑可复核。
