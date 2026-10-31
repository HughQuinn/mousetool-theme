# Agents — 鼠标光标主题管理工具

> 给 AI 的**速查卡**，不是需求文档。模块职责明细、命令逐条契约、视图规则、安装器坑位、
> 检查脚本说明都展开在[开发手册](docs/mouse-theme开发手册.md)——改速查卡与改手册是一件事的两半，动了哪边记得同步另一边。
> 原则：**事实以代码为准**。本文件与代码不一致时改本文件，不要改代码迁就文档；更不要把没实现的东西写成已支持。

**技术栈**：Tauri 2 + React 19 + TypeScript + Vite 7 + Tailwind 4 + shadcn/ui（base-nova / `@base-ui/react`）+ zustand 5 + Rust。
**现状**：功能已跑通，41 个 Tauri 命令全部实现并注册；除纯路径计算的 `get_data_dir` 外，I/O 命令都是 `async` + `spawn_blocking`。不是脚手架（没有 `greet` 示例）。

## 先读哪份（冲突时从上往下取）

| 顺序 | 文件 | 管什么 |
|---|---|---|
| 1 | `docs/mouse-theme决策记录.md` | 已拍板的决定，最高权威 |
| 2 | `docs/mouse-theme需求描述.md` | 范围与边界；§8 作废项、§9 未实现 |
| 3 | `docs/mouse-theme架构设计.md` | 目录、命令契约 §5、类型契约 §6、硬约束 §8 |
| 4 | `docs/design-system.md` / `docs/motion.md` | 视觉 token、动效 |
| 5 | `docs/mouse-theme开发手册.md` | 本卡的展开：模块明细 / 命令逐条 / 安装器坑位 / 脚本说明 |

---

## 职责边界（同一仓库，不是独立进程；明细见手册）

- **Frontend**（`src/`）：骨架（侧栏 + 页头）+ 四视图（含设置）+ 检查器；组件不直接 `invoke`，走 store action，`services/` 是唯一 invoke 出口，mock 全住 `mock*.ts`（决策 50）。
- **Backend**（`src-tauri/src/commands/`）：命令编排；错误一律 `Result<T, String>` 且是**用户能照着行动**的中文；I/O 全走 `spawn_blocking`，重操作取 `utils/ops.rs` 锁并发 `*-progress` 事件；入参先过 `utils/validation.rs`，归档读取只走 `utils/limits.rs`。
- **Theme**（`utils/importer.rs` 等）：zip / `.themepack` / `.theme` / 文件夹四入口一条导入链路；`.inf` 说明书映射优先于文件名推断；导出 zip 附带通用 `.inf`；`theme.json` 磁盘存相对路径、运行时 `resolve_theme` 拼绝对；存储目录迁移与文件完整性体检见手册。
- **Trash**（`utils/trash.rs`）：删除即软删除进 `trash\<条目 UUID>\`（条目 ID 与主题 ID 分开）；上限 20 套 / 512 MB，超限自动清最早；恢复遇同 ID 被占可改「存为副本」（新 UUID、名称加「（副本）」，决策 54）。
- **Capture**（`utils/capture.rs`）：把外部改写态的当前光标**复制**为我的主题；没抄全绝不自动应用。
- **Cursor**（`utils/cursor.rs`）：`.cur`/`.ico`/`.ani` 解码，不转 GIF。
- **Registry**（`utils/registry.rs`）：HKCU 读写 + `SPI_SETCURSORS`。
- **日志**（`utils/log.rs`）：数据根 `logs\mousetool.log`，512KB 轮转连当前共 3 份，写失败一律静默；非测试代码禁止 `eprintln!`。
- **行为设置**（`utils/settings.rs` / `tray.rs` / `autostart.rs`）：`settings.json` Rust 与前端共用；托盘最近主题快速切换（决策 30）；自动切换 / 光标守护 / 自动备份 / 定时切换 / 定时轮换的逻辑都在前端 `lib/*.ts`，事件驱动不轮询（决策 25/29/32/33/55；轮换是优先级最低的自动行为，前两者开启时让位）。
- **系统集成**（`utils/integration.rs`）：单实例互斥、`--import` 转交、右键菜单注册（决策 12/41）；**窗口激活按标题查找**——改窗口标题必须同步 `WINDOW_TITLE` 常量。
- **Integration**（`models/` ↔ `types/`）：前后端字段逐个同名 `snake_case`，不做驼峰转换。
- **安装器**（`src-tauri/installer/` + `tauri.conf.json` 的 `bundle` 段）：NSIS 整窗自绘模板；坑位密集（`SetCtlColors` 字面量、`;` 逐行写、BOM、makensis 工作目录等），**动它之前先读手册「安装器」一节**。

---

## 三个内容视图 + 设置（别合并回一张列表）

| 导航 | 视图 | 回答的问题 | 检查器 |
|---|---|---|---|
| 主题图库 | 分组网格（系统方案 / 我的主题 两段） | 挑哪个？ | 有 |
| 我的主题 | 数据表（排序 / 筛选 / 批量整理，会话内不落盘，决策 48；应用次数列派生自事件流，决策 53） | 我导入了什么、要清理哪个？ | 有 |
| 最近使用 | 按自然日分组的时间轴 | 上次用的是哪个？ | **没有** |
| 设置 | 五个分组（通用/快捷键/数据/系统集成/关于） | 行为怎么配、数据在哪、怎么自查？ | **没有** |

- 前三页是**内容三视图**互不重叠；设置页是**管理面板**，不是第四个列表页。
- 三页选中项**各记一份**：`selection: Partial<Record<Page, string | null>>`；切页只清搜索词不清选中；设置页没有选中概念。
- 加页面只改两处（漏了编译不过）：`lib/pages.ts` 的 `PAGE_META` + `App.tsx` 的 `VIEWS`；加设置分组同规：`lib/settings-sections.ts` + `SettingsView.tsx` 的 `SECTIONS`。
- 诊断 / 批量导入 / 备份内容是任务层弹窗，备份历史与回收站是「数据」子页——都不进 `PAGE_META` / `VIEWS`（决策 23/26/34）。
- 设置页 `dependsOnThemes: false`：整体读取失败照常渲染，「打开数据目录」正是排查入口，不能被 LoadErrorState 顶掉。
- 图库与我的主题重复是**任务不同**（逛 vs 管），别为去重把两页合成一张列表加过滤条件。
- 文件缺口（决策 31）**只展示不拦截**，只在三处提示（我的主题槽位列 / 检查器警示条 / 诊断中心），别给它加确认弹窗或自动修复；提示位置明细在手册。

---

## 三个高频记错点

**① 槽位 15 个，顺序固定**
唯一来源 `utils/registry.rs::SLOT_DEFS`，完整表见决策记录「决策 3」。键名别照系统设置里的显示名猜：是 `Crosshair`（不是 Cross），另有 `NWPen`、`UpArrow`。短名（`no` / `ns` / `we` / `up`）只能做**精确匹配**，放进包含匹配会撞 `normal`、`upload`。

**② 41 个 Tauri 命令**
完整清单与契约见架构设计 §5 表格，逐条易错点见手册；最容易记错的：
- 没有 `list_themes`（是 `get_all_themes`）；没有 `create_custom_theme`（未实现）。
- `apply_theme` / `export_theme` 收**整个 `CursorTheme`**，不是 ID——系统方案只存在于注册表，只给 ID 拿不到它的文件。
- `get_active_state` 是聚焦用的轻量重查（决策 24）：不取 `ops` 锁；失败直接 `Err`，前端静默保留旧状态。
- `delete_theme` 是**软删除**（决策 26）；`delete_from_trash` / `empty_trash` 才真正删文件。
- `update_settings` 是**补丁语义**；`import_backup` 是合并恢复不覆盖已有；`restore_theme_from_backup` 只追加一套主题。
- 除纯路径计算的 `get_data_dir` 外，所有命令 `async` + `spawn_blocking`；重操作取 `ops::try_begin` 锁（第二个重操作**立刻失败**，不要改成排队），只读命令不取锁。

**③ 注册表写入范围**
只写 `Cursors` 下 15 个槽位值 + `SchemeName`（+ 键默认值），未提供的槽位写**空字符串**；「还原默认」顺带清空 Win11 `Pin` / `Person` 残留（值已存在才清，不凭空创建，决策 24）。**不写** `Cursors\Schemes`（那是系统"已保存方案"列表；经典面板对本应用主题恒显「(无)」就是这个原因，别当 bug 修）。光标文件留在 `%LOCALAPPDATA%` 原地，**不复制进 `C:\Windows\Cursors`**。

---

## 硬约束（违反会出事故）

1. 数据目录只认 `utils/paths.rs::data_root()`，禁止别处硬编码。
2. `SPI_SETCURSORS` **只传 `SPIF_SENDCHANGE`**；带 `SPIF_UPDATEINIFILE` 本机返回 `0x80070006`，刷新直接失败。
3. `--no-sandbox` 不能从 `tauri.conf.json` 删：本机 WebView2 沙箱初始化失败会整窗纯白；Tauri 会覆盖同名环境变量，只能改 JSON。
4. 「正在使用」只从注册表反推（`active_theme_id`），不存内存 / localStorage。
5. 导出 zip 的文件名**按槽位命名**（导入端先看 `.inf` 映射、没有再靠文件名反推槽位；两种来源结果一致，否则"导出→再导入"必丢槽位）。
6. 重命名只改 `theme.json`，目录名保持 UUID；`updated_at` 不动（界面当"导入于"用）。
7. 删改类命令必须按规范 UUID 校验（`validation::is_canonical_uuid`，要求 `to_string()` 与原文完全一致）——`theme_dir(id)` 是字符串拼接，传 `../` 能越出数据目录。
8. 多来源必须部分成功：注册表读不到不能让用户主题一起消失，失败进 `warnings`。
9. 新增依赖需单独决策并记入决策记录（现有能力为何不够 / 手写成本 / 安装包与供应链代价），默认不加；Toast/浮层用 `@base-ui/react` 自封装，不引 sonner / radix（决策 6/27）。
10. 动效只写 `duration-(--motion-*)` + `ease-standard/ease-exit`，禁裸数字时长、禁 `transition-all`。**唯一例外 Toast 倒计时条**：时长=toast timeout（内联注入）、缓动必须 `linear` —— 它是剩余时间的读数，改缓动=读数失真（详见 motion.md §2）。
11. zustand selector **不能返回新对象**（`filter`/`map`/字面量）→ 无限重渲染白屏；派生数据用纯函数 + `useMemo`。
12. 后台起 dev server 只用 `npm run dev:bg`，且**启动与验证写进同一条命令**；禁止 `npm run dev | head`（管道一关 EPIPE 直接杀死 vite）。
13. 可滚动容器一律加 `scroll-thin`：6px、轨道透明、拇指**平时完全隐形**、指针进入容器才浮出（`::-webkit-scrollbar`）。**别用 `scrollbar-width: thin`**——Chromium 里它仍走经典样式（带箭头、常显），在 320px 面板里会被当成进度条；也别自绘轨道或改滚动手感。
14. 检查器宽度由 `InspectorResizer` 拖动（280–560、双击复位、`←/→` 16px），**只在会话内有效、不落盘**：面板宽度是"此刻怎么摆"，存下来会在改了默认值后留下一个没人维护的旧数字。
15. `minWidth: 1080` / `minHeight: 640` 别从 `tauri.conf.json` 删：侧栏 224 + 检查器最小 280 + 正文 440，窄于此三栏会互相挤压（`design_check` 会断言这两个值）。
16. 外观三态（跟随系统 / 浅色 / 深色）只由 `lib/theme-mode.ts` 管：`html.dark` + 落盘 `cursorstudio.theme-mode` + `setTheme` 同步标题栏。**组件里不写 `dark:` 前缀**，颜色全走 token；手选浅/深后不再跟系统，选回「跟随系统」才恢复。控件在「设置 → 通用」（决策 14，已从侧栏迁走）；改这段先看 `design_check` 的 18 条断言。
17. 设置的持久化分三处，别做大一统：行为类 `settings.json`（Rust 也要读：关闭行为、主题目录、开关）、外观 `localStorage`（首帧同步读）、自启动 `HKCU\...\Run`（注册表即真相）。
18. 主题槽位路径**磁盘存相对、运行时用绝对**：`theme.json` / 备份 zip 里只准出现相对主题目录的路径（`utils/theme_paths.rs` 的 `to_storage` / `write_theme_json`），读盘后必须 `resolve_theme` 再交给预览/应用。主题目录迁移只走 `utils/themes_dir.rs`：目标先 canonicalize，拒绝 UNC / 重解析点 / 数据目录内部（默认除外）/ 祖先 / 互相嵌套 / 非空目录（含同名主题）；内容先写同级 `.cursorstudio-migrate-<uuid>` 暂存区、逐文件哈希校验后原子改名；注册表重绑或设置写入失败必须回滚，源目录只在全部成功后删除。
19. 归档与文本读取只走 `utils/limits.rs`：主题包 `THEME_LIMITS`（50MB / 单文件 20MB / 512 条目 / 8 层）、备份 `BACKUP_LIMITS`（1GiB / 64MB / 4096 / 10 层）共用 `ArchiveBudget`、`copy_bounded`（64KB 流式）、`safe_relative_parts`；文件夹导入用 `ScanBudget`，`.inf` 也占同一份额度；备份恢复第一遍必须先按条目声明大小做整包预检。所有 JSON 文本读走 `read_text_bounded`（`theme.json` 1MB，`settings.json` / `history.json` 512KB）；编码不定的 `.inf` 走 `read_bytes_bounded`（1MB）后直接交给 `inf_parse`，禁止先按 UTF-8 解码。禁止 `fs::read_to_string`。目录遍历一律用 `is_reparse_entry` 跳过 symlink / junction / 其它重解析点并 warning。**禁止一次性读整个条目**，超限必须清理解压临时目录与半成品主题目录。预览源文件 8MB、光标文件 20MB 上限同理。
20. 前端传来的 `CursorTheme` / 路径一律视为不可信：槽位必须命中 15 个白名单、`theme.id` 必须是规范 UUID 且等于目录名与 `theme.json` 里的 id；用户主题的光标 canonicalize 后必须落在**这套主题自己的目录**内（系统方案才允许任意目录，预览路径允许主题根目录或系统光标目录）；`dest_path` 父目录存在且后缀正确。校验只在 `utils/validation.rs` 做，别在组件里复制。
21. 重操作必须后台 + 互斥：导入、备份导出 / 恢复、主题目录迁移、删除主题 / 批量删除 / 回收站恢复 / 彻底删除 / 清空、保存当前光标都要 `spawn_blocking` + `ops::try_begin`（`try_lock` 立即失败，不排队）+ 阶段进度事件；`spawn_blocking` 的 JoinError 也要转成中文错误，不能 `.unwrap()`。
22. 前端安全基线：`main.tsx` 必须保留 `ErrorBoundary`；外链只走 `lib/open-external.ts` 的 `https://github.com` 白名单；检查更新必须 8 秒超时；busy 按 `动作:ID` 记且 `finally` 释放；导出默认文件名必须过 `sanitizeFileName`（Windows 非法字符 / 保留名）。
23. 无障碍基线：标题 `h1 → h2 → h3` 不跳级；`Segmented` 保持 radiogroup + roving tabindex（方向键 / Home / End）；`.ani` 播放必须响应 `prefers-reduced-motion`（降级画一帧）；装饰性预览图 `alt=""`；时间用 `<time dateTime>`。
24. 测试**不碰真实环境**：数据根用 `paths::use_test_roots` 指向临时目录，注册表测试用 `TEST_CURSORS_KEY`（`Software\CursorStudio.Tests\...`，结束删除），光标用 `test_support` 生成 fixture；注册表用例仍全局串行。CI 六道闸 `build` / `npm test`（前端单测，决策 49）/ `cargo test` / `clippy -D warnings` / `design_audit` / `doc_ref_check` 不得删减（clippy 警告基线为零，新警告直接拦下）。
25. CSP 与 capability 别放宽：生产 `csp` 只放行 `self` / `data:` / `blob:` / asset / `https://api.github.com`，Vite HMR 的 `ws://localhost:1420/1421` 与 inline/eval 只写在 `devCsp`；opener 只给 `opener:allow-open-url` + `https://github.com/*`，dialog 只给 `allow-open` / `allow-save`。**不要恢复 `csp: null`、`opener:default`、`dialog:default`，也不要删 `--no-sandbox`**（决策 22、硬约束 3）。
26. 回收站与主题库分开：条目目录名是**回收站条目 UUID**（不是主题 ID），命令只收规范 UUID；恢复前复核快照、`theme.json` 与当前主题目录；`trash\` 不参与主题扫描、备份与迁移（决策 26）。
27. 保存当前光标是**复制**：只读注册表当前值、复制到新的主题目录并写相对路径，不改系统光标目录、不写 `Schemes`；有槽位没抄全时不得自动应用（否则会把没抄到的非空槽位写成空字符串）（决策 28）。
28. 光标守护只事件驱动：默认关闭；启动检查要等设置与主题列表就绪且注册表读取成功；运行期只处理 `active_external`，不抢已知主题与系统默认；目标必须仍在主题库里；复用 `applyTheme`，不轮询注册表、不写 `Schemes`、不做后台服务（决策 29）。
29. 备份单主题恢复只做追加：目标 ID 已存在必须拒绝且不碰原目录；只解压请求的那套主题，不合并使用记录、不改设置；失败清理本次新建目录；旧绝对路径必须按主题 id / 文件名映射后再落相对路径；部分缺文件恢复后必须把缺口写进 `warnings`，全部槽位缺文件必须拒绝（决策 34）。

---

## 未实现（别写成已支持）

| 项 | 现状 |
|---|---|
| （当前无缺口） | 原「文件夹导入」「`.inf` 槽位映射」已实现（决策 15/16），别再当未实现 |

**已拍板不做**（决策 10，别当"待排期"重新提）：自制方案（逐槽位上图）、单光标替换；光标大小（决策 51：注册表路线被真机证伪，维持「鼠标属性面板直达」）。槽位卡保持纯展示、不可点、不做 hover 暗示 —— 这是产品决定，不是没做完。

**窗口不是缺口**：`minWidth: 1080` / `minHeight: 640` 兜底，仍**不做响应式断点**（窄窗下不重排、不收起任何一栏）。

---

## 改完怎么验

```powershell
npm run build              # tsc + vite，类型错会拦下
npm test                   # 前端纯逻辑单测（node --test，无需 dev server）
cd src-tauri; cargo check  # 后端快速反馈
cargo test                 # 单元测试；数据根与注册表都已隔离，不碰真实光标
```

cargo 拉包被系统代理挡住时（本机 Clash 常关）：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy CARGO_HTTP_PROXY="" cargo test
```

界面/动效脚本跑在浏览器里、走 mock，不写系统光标；**必须与 dev server 同一条命令**（各脚本验收内容见手册）：

```powershell
node scripts/dev_bg.mjs start; node scripts/nav_check.mjs; node scripts/design_check.mjs; node scripts/motion_check.mjs; node scripts/migration_check.mjs; node scripts/recent_check.mjs; node scripts/ui_check.mjs; node scripts/dnd_check.mjs; node scripts/future_check.mjs; node scripts/auto_switch_check.mjs; node scripts/trash_check.mjs; node scripts/trash_copy_check.mjs; node scripts/capture_check.mjs; node scripts/guard_check.mjs; node scripts/integrity_check.mjs; node scripts/auto_backup_check.mjs; node scripts/schedule_check.mjs; node scripts/rotate_check.mjs; node scripts/backup_content_check.mjs; node scripts/backup_verify_check.mjs; node scripts/duplicate_check.mjs; node scripts/maintenance_check.mjs; node scripts/batch_check.mjs; node scripts/scheme_import_check.mjs; node scripts/mine_view_check.mjs; node scripts/dev_bg.mjs stop
```

碰注册表的测试只写隔离键（`Software\CursorStudio.Tests\...`），数据根指向临时目录，不备份 / 还原用户设置。

## CI、文档检查与真机验证

- CI 在 `.github/workflows/ci.yml`：`windows-latest` 上跑 `npm ci` → `npm run build` → `cargo test` → `cargo clippy --all-targets -- -D warnings` → `design_audit` → `doc_ref_check`，六道闸不得删减。
- 动了文档、尤其是本文件的 `§x` / `决策 N` 引用，跑 `node scripts/doc_ref_check.mjs`（断言命令总数、决策总览、CI clippy 口径、发布指南 5 个版本位置与相对链接大小写；不需要 dev server）。`node scripts/design_audit.mjs` 发现违规同样退出码 1。
- 真机验证脚本在 `scripts/real_machine/`：碰真实文件系统，**不进 CI、不入本验证链**，改动导入链路或批量删除路径后手动跑；脚本清单与前置条件见手册，历史证据见 `docs/real-machine-verify/`。

---

## 其余口径

Windows 10/11 x64；全程无 UAC；应用主题 < 500ms；预览单帧最长边 128px、最多 32 帧；数据在 `%LOCALAPPDATA%\CursorStudio\`（`themes/` + `trash/` 回收站 + `history.json` + `backups/` 应用内备份），卸载不删；主题包 50MB / 备份 1GiB 上限，预览源文件 8MB；仅简体中文，不做多语言。
