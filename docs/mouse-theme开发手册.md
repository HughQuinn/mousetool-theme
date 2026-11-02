# mouse-theme 开发手册

> 仓库根目录的 [`AGENTS.md`](../AGENTS.md) 是速查卡，只留"容易踩错、必须马上知道"的；
> 本文件是它的展开，收录改到对应模块才需要读的明细：模块职责、命令逐条契约、
> 视图与页面规则、安装器坑位、检查脚本说明、真机验证。**改速查卡与改本文件是一件事的两半**，动了哪边记得同步另一边。
> 权威顺序不变：决策记录 > 需求描述 > 架构设计 > 本文件；**事实以代码为准**，本文件与代码不一致时改本文件，不要改代码迁就文档。

---

## 模块职责明细

（与 `AGENTS.md`「职责边界」一一对应，这里是完整版。同一仓库，不是独立进程。）

### Frontend（`src/`）

骨架（侧栏 + 页头）+ 四个独立视图（含设置）+ 右侧检查器。组件不直接 `invoke`，走 store action；`services/`（`theme.ts` / `system.ts` / `settings.ts`）是唯一 invoke 出口；浏览器降级的 mock 全部住在 `mock.ts`（示例数据）与 `mock-theme.ts` / `mock-settings.ts`（命令级实现），服务文件里只留一行委派（决策 50）。

### Backend（`src-tauri/src/commands/`）

命令编排，错误一律 `Result<T, String>` 且是**用户能照着行动**的中文。所有 I/O 走 `spawn_blocking`；导入 / 备份 / 迁移，以及删除主题 / 批量删除 / 恢复 / 彻底删除 / 清空回收站 / 保存当前光标，取 `utils/ops.rs` 的 `try_begin` 互斥锁并发 `*-progress` 事件（决策 19/26/28/43）。前端传来的结构先过 `utils/validation.rs`（槽位白名单、路径包含、`dest_path`、`theme.id`），归档读取只走 `utils/limits.rs`（决策 18）。

### Theme（导入 / 槽位映射 / 落盘）

`utils/importer.rs`、`utils/inf_parse.rs`、`utils/theme_file.rs`、`utils/paths.rs`、`utils/theme_paths.rs`：zip / `.themepack` / `.theme` 方案 / 文件夹导入、槽位映射、落盘。

- **四个入口共用同一条链路**（`importer::import_source` 分发，决策 16/36/39；侧栏对话框收 `.zip`/`.theme`/`.themepack`，拖拽全收）。
- 包内带 `.inf` 时槽位按说明书映射、优先于文件名推断，没带或解析失败才退回文件名推断（`inf_parse.rs`，决策 15）。
- `.theme` 同为说明书级映射（`theme_file.rs`，优先级仅次于 `.inf`，引用可指向包外系统光标，决策 36/39），**被映射认领的文件不再参与文件名推断**；`.theme` 单文件收编是复制、引用全部落空才拒绝（决策 36）。
- `.themepack` 是 CAB 容器（决策 39，依赖 `cab` crate）。
- 导出 zip 附带通用 `.inf` 安装文件（`utils/inf_export.rs`，决策 13），接收方右键即可安装。
- **磁盘上的 `theme.json` 只存相对主题目录的槽位路径**（`cursors/arrow.cur`），运行时统一由 `theme_paths::resolve_theme` 拼绝对路径；旧绝对路径兼容读取，备份导出/恢复也走同一套相对化（决策 17）。
- 主题存储目录可换（`utils/themes_dir.rs`）：暂存复制 + 内容校验 + 原子切换 + 失败回滚，见 `AGENTS.md` 硬约束 18。
- **文件完整性是读列表时顺带的只读体检**（决策 31）：`all_themes` 逐主题 stat 非空槽位文件，缺口进 `ThemesResult.file_gaps`；空槽位不算缺口，只展示不拦截，`theme.json` 不落这个字段。

### Trash（`utils/trash.rs`）

删除即软删除，整目录移入数据根 `trash\<条目 UUID>\` 并写 `.trash.json` 快照（决策 26）。**条目 ID 与主题 ID 分开**：同一主题可删多次、删完恢复再删也不撞目录；恢复前复核快照 / `theme.json` / 目标目录；上限 20 套或 512 MB，超限按删除时间自动清最早；跨盘 `rename` 失败走复制 + 文件数与字节数校验 + 删源。恢复遇同 ID 被占可改「存为副本」（决策 54）：分配**新 UUID** 复制落盘（不走搬移，失败删半成品、条目原样保留），`theme.json` 的 id 与目录名同步改写、名称加「（副本）」（40 字截断）；副本不自动应用、不记使用事件。`trash\` 不参与主题列表、备份与目录迁移。

### Capture（`utils/capture.rs`）

把外部改写态的当前光标复制为我的主题（决策 28）。只读注册表、复制到新的 UUID 主题目录、`theme.json` 写相对路径；同一源文件多槽位只复制一份，单文件 20MB / 总量 50MB；有槽位没抄全时只保存不自动应用，当前已是已知主题则拒绝重复。

### Cursor 与 Registry

- **Cursor**（`utils/cursor.rs`）：`.cur`/`.ico`/`.ani` 解码。自解 ICO 目录挑最大帧、手写 RIFF 取 `LIST/fram`；**不转 GIF**。
- **Registry**（`utils/registry.rs`）：HKCU 读写 + `SPI_SETCURSORS`。

### 日志（`utils/log.rs`）

发布版持久日志（决策 46）。数据根 `logs\mousetool.log` 追加写，512KB 轮转、连当前共 3 份；只记事件与原因、不写主题内容，写失败一律静默（日志系统不能弄坏业务）；启动写一条版本标记；诊断中心页脚「打开日志目录」直达（`open_log_dir`）；`logs\` 不计入存储统计。非测试代码禁止再写 `eprintln!`（发布版没有控制台，等于丢掉）。

### 行为设置（`utils/settings.rs` / `tray.rs` / `autostart.rs`）

- `settings.json` 存关闭行为/主题目录/开关/自动切换映射/光标守护/自动备份开关与保留份数/定时切换时段与映射/定时轮换开关与间隔（Rust 与前端共用）。
- 关闭到托盘时托盘图标动态创建移除，托盘菜单带最近使用主题快速切换（≤8 + 还原默认勾选，决策 30）：应用 / 还原走 `commands/theme.rs` 的 `apply` / `restore` 同链路，`tray::refresh` 在应用 / 还原 / 保存当前光标 / 删除 / 改名 / 回收站 / 备份恢复等命令完成后重建菜单，不轮询；过期条目靠 `apply_by_id` 点击时复核自愈。
- 自启动写 `HKCU\...\Run`。
- 外观三态留 `localStorage`（`lib/theme-mode.ts`，首帧落色要同步读）。
- 跟随系统深浅色自动切换主题的**切换逻辑在前端** `lib/auto-switch.ts`（决策 25）：主题 ID 补丁用**空串表示清空**（serde_json 分不清 null 与缺省）。
- **光标守护也在前端** `lib/cursor-guard.ts`（决策 29）：启动检查 + 运行期 `active_external` 一轮恢复，复用 `applyTheme`，不轮询、不新增命令。
- **自动备份也在前端** `lib/auto-backup.ts`（决策 32）：启动就绪后 / 窗口聚焦节流后 / 开关打开时触发 `run_auto_backup`，当日去重与过期清理在命令层。
- **定时切换主题也在前端** `lib/schedule-switch.ts`（决策 33）：时间段内 / 外配对主题，边界用 `setTimeout` 到点评估，不轮询；时间段内且期间主题已设时深浅色切换让位。
- **定时轮换也在前端** `lib/theme-rotate.ts`（决策 55，纯函数拆 `theme-rotate-core.ts`）：间隔 `setTimeout` 链到点应用「当前主题的下一套」（候选 =「我的主题」按名称序）；**优先级最低**——定时切换或跟随系统任一开启时让位，还原默认后挂起到下一周期；间隔 15–1440 由 `update_settings` 校验。

### 系统集成（`utils/integration.rs`）

单实例互斥（`CreateMutexW`）、`--import` 转交（`pending_import.json`，领取即删）、主题文件右键菜单注册（试点，决策 12/41：`.zip` / `.themepack` / `.theme` 三类一把注册，全有或全无，部分注册视为未注册可自愈）。**窗口激活按标题查找**——改窗口标题必须同步 `WINDOW_TITLE` 常量。

### Integration（`models/` ↔ `types/`、`capabilities/`）

前后端字段逐个同名，共用 `snake_case`，不做驼峰转换。

### 安装器（`src-tauri/installer/` + `tauri.conf.json` 的 `bundle` 段）

NSIS 走**整窗自绘模板** `installer/template/installer.nsi`（设计源 `docs/安装器原型/setup-ui-prototype.html`：欢迎 / 已安装维护 / 安装选项 / 进度 / 完成五页；常驻侧栏步骤高亮、自绘页脚、品牌渐变进度）。坑位密集，**改安装器前把本节通读一遍**。

结构与资源：

- UI 位图由 `installer/src/make_ui_assets.ps1`（`npm run installer:assets`）生成到 `installer/ui`（通用图 1x/2x，按钮与进度填充另出 125/150/175/200%），模板在 MUI 的 `MUI_CUSTOMFUNCTION_GUIINIT` 钩子里 `File /r` 解到 `$PLUGINSDIR` 下的 `ui` 目录。
- **`installer/ui` 已 .gitignore、不入库**（侧栏把版本号烘进了位图，入库会在升版本时留下旧图）：打包前先 `npm run installer:assets`，缺文件 makensis 会直接报错、不会静默用旧图；`npm run installer:build` = 生成资源 + `tauri build --bundles nsis`。
- QA 脚本 `capture_setup_window.ps1` / `walkthrough_capture.ps1` / `verify_install_cycle.ps1`；截图用置顶 + 24bpp 屏幕拷贝（`PrintWindow` 对位图页会丢 alpha 截成黑块）。改许可文本跑 `make_license_rtf.mjs`。

容易踩的坑：

- 颜色只能给 `SetCtlColors` 传**十六进制字面量**（经变量或十进制都会被按十六进制误解析，偏色甚至整页黑）；**NSIS 的 `;` 是注释，命令必须逐行写**。
- 可点卡片/文字/圆点必须用 `nsDialogs::CreateControl` 创建（raw `CreateWindowEx` 的 ID 0 控件挂不上 `${NSD_OnClick}`），卡片文字还要带 `SS_NOTIFY`；原生单选/勾选做成 20×20 完全压在自绘圆点下（缩到 1px 会露出系统蓝边），只负责状态/键盘/自动化；焦点环位图 32×32、离圆点 2px。
- 进度页复用原生 InstFiles 页对话框当画布（控件在 `Section UiBuild` 里建，show 回调时页面对话框还没创建）；**InstFiles 对话框不认控件首帧的 `SetCtlColors` 背景**（文字变黑、深色底变白块），自绘控件建完必须 `RedrawWindow` 整树重绘一次；完成页的"完成"要 PostMessage 原生 Close 按钮的 `BM_CLICK`，直接 `WM_COMMAND` 不关窗。
- 许可页按原型裁掉了（MIT 全文靠 `bundle.resources` 的 `LICENSE.txt` 进安装目录）；主程序名是 Cargo 包名 `mousetool-theme` 不是 productName；自启动注册表值名是 **`CursorStudio`**（`autostart.rs` 的 `RUN_NAME`，安装器与卸载器都写/删这个值）。
- 模板里 `System::Call` 不求值 `|` 表达式（先 IntOp）且 `LoadImage` 在 **user32**；makensis 工作目录是 `target/release/nsis/x64`（模板里的相对 `File` 路径按四级上级算）；bundler 会自己给模板加 UTF-8 BOM（模板文件本身不要带）。
- MSI 需 `wix.language: "zh-CN"` 才能装下中文 productName。
- Edit 的路径初值必须等页面显示后的首帧再 `WM_SETTEXT`（创建阶段写进去不绘制）；步骤文字底色不能用 `-1` 透明（STATIC 会画成白块），品牌色块按原型做成 220×220、只露右下角，避开步骤文字。
- 改 `installer/` 会让 `tauri dev` 重启调试窗口，`src-tauri/.taurignore` 已忽略该目录（重启 dev 后生效）。

---

## 视图与页面规则明细

（与 `AGENTS.md`「三个内容视图 + 设置」对应；速查卡只留结构规则，这里是全部细则。）

- **任务层弹窗与子页**（决策 23/26/34）：诊断、批量导入与备份内容都是任务层弹窗；备份历史与回收站是「数据」子页。不进 `PAGE_META` / `VIEWS`，不加导航、不加设置分组（备份内容从备份历史的行内「查看内容」打开）。单文件导入（侧栏按钮 / Ctrl+O / 拖 1 个）保持原链路不动；拖 2–20 个进 `importStore` 队列，串行执行、失败可单独重试。外部改写态下「保存并应用」只出现在侧栏当前使用卡，也不新开页面（决策 28）。
- **设置五分组**（决策 14）：通用 = 应用主题三态（从侧栏迁入）/ 跟随系统切换主题（浅/深配对，决策 25）/ 定时切换主题（时间段内/外配对，默认关闭，决策 33）/ 定时轮换主题（间隔轮换「我的主题」，默认关闭，决策 55）/ 光标守护（启动或系统改写后自动恢复上次主题，默认关闭，决策 29）/ 开机自启动 / 关闭行为（直接退出·最小化到托盘）/ 主题存储目录 / 自动检查更新；快捷键 = 应用内快捷键一览 + 开关；数据 = 数据目录 + 存储占用（决策 35）+ 数据备份（导出/合并恢复）+ 自动备份（每天一份进备份历史，默认关闭，决策 32）+ 备份历史（含内容浏览与单主题恢复，决策 34）+ 回收站（恢复 / 恢复为副本 / 彻底删除 / 清空，决策 26/54）+ 清空使用记录（决策 35）+ 诊断信息；系统集成 = 鼠标属性面板直达 + 右键菜单开关（试点）；关于 = 版本 / 开源地址 / 检查更新（GitHub Releases）。进设置后侧栏整体切成「返回 + 分组」，页头跟随分组标题。
- 改名只做在 `ThemeNameField` 一处（检查器头部）；描述编辑同理只做在 `ThemeDescriptionField`（决策 61，与改名共用 `rename_theme` 的补丁语义）；表格行内的操作只有导出与删除。槽位统计口径在 `lib/slots.ts`（`SYSTEM_SLOT_TOTAL = 15` 是 `SLOT_DEFS` 的镜像，后端改槽位必须同步改它）。
- **文件缺口**（声明了的槽位文件读不到，决策 31）只在三处提示：「我的主题」槽位列「缺 N 个文件」、检查器头部警示条（点名槽位中文名 + 「应用后写成空」的后果）、诊断中心第五项「文件完整性」；图库卡与最近使用不背管理信息。缺口**只展示不拦截**——应用 / 导出等命令行为不变，别给它加确认弹窗或自动修复。
- 「我的主题」工具条排序与筛选——最新/最早/名称/槽位完整度/应用次数 × 缺文件的/从未使用的，会话内不落盘（决策 48/53）。并列排序口径：槽位 / 次数同数按导入时间**新在前**（决策 48 原文，`byDateNewestFirst`）。

---

## 命令逐条契约

命令数量以 `doc_ref_check` 的三方断言为准（Rust 代码 / 架构设计 §5 标题与表格 / 速查卡）；
完整入参出参以架构设计 §5 表格为准，这里收录速查卡放不下的逐条易错点。

### 命令清单（按类）

主题类 `get_all_themes` / `get_active_state` / `get_cursor_preview` / `import_theme` / `apply_theme` / `restore_default` / `save_current_theme` / `delete_theme` / `delete_themes` / `rename_theme` / `export_theme` / `export_all_themes` / `find_duplicate_themes`；回收站 `list_trash` / `restore_from_trash` / `delete_from_trash` / `empty_trash`；数据与系统类 `get_data_dir` / `open_data_dir` / `open_log_dir` / `get_storage_stats` / `clear_history` / `get_windows_version` / `open_mouse_panel` / `get_zip_menu_registered` / `set_zip_menu` / `take_pending_import`；设置类 `get_settings` / `update_settings` / `get_autostart` / `set_autostart` / `preview_themes_dir` / `set_themes_dir` / `export_backup` / `import_backup` / `list_backups` / `list_backup_themes` / `restore_theme_from_backup` / `verify_backup` / `delete_backup` / `run_auto_backup`。

### 逐条易错点

- `apply_theme` / `export_theme` 收**整个 `CursorTheme`**，不是 ID——系统方案只存在于注册表，没有磁盘目录，只给 ID 拿不到它的文件。
- `import_theme` 收 `sourcePath`（**zip、.themepack、.theme 光标方案或整个主题文件夹**，决策 16/36/39，后端权威校验），返回 `{ theme, warnings, duplicate_of }`——与库里已有主题内容完全相同时 `duplicate_of` 点名 + warnings 追加人话版（决策 47，**只提示不拦截**，复用决策 38 指纹 + 逐字节确认，在 ops 锁内比对）——目录里的链接 / 目录联接会被跳过并说明原因；包内带 `.inf` 时槽位按说明书映射、**优先于文件名推断**，没带或解析失败退回文件名推断、不缺槽位（决策 15，`utils/inf_parse.rs`），`.inf` 与光标文件共用 `ScanBudget`；`.themepack`（CAB）解档走 `THEME_LIMITS` 全套限额后与 zip 同链路（`cab` crate，LZX/Quantum 压缩不支持，决策 39）；`.theme` 是说明书级映射且引用可指向包外系统光标（`theme_file.rs`），被映射认领的文件不再被推断重复使用；`.theme` 单文件收编 = 按槽位复制引用文件（源文件不动），引用缺失只跳槽位并 warning、全部落空才拒绝（决策 36）。
- `get_active_state` 是聚焦用的轻量重查（决策 24）：只读注册表 + 主题清单比对，不读历史、不取 `ops` 锁；失败直接 `Err`，前端静默保留旧状态。`get_all_themes` 的 `ThemesResult` 相应多出 `current_slots_filled` / `active_external`（槽位非空但匹配不到任何主题 = 被系统设置改写）与 `file_gaps`（文件缺口清单，决策 31：托盘与聚焦重查不做这一步）。
- 没有 `list_themes`（是 `get_all_themes`）；没有 `create_custom_theme`（未实现）。
- `delete_theme` 是**软删除**（决策 26）：整目录移入 `trash\`，返回 `{ auto_purged, warning }`；回收站上限 20 套 / 512 MB，超出自动清最早。`restore_from_trash` 会复核快照 / `theme.json` / 目标目录（同 ID 已存在就拒绝；`asCopy = true` 改为恢复为副本，新 UUID + 名称加「（副本）」，决策 54），返回 `theme_id` 供前端选中新主题；`delete_from_trash` / `empty_trash` 才真正删文件；损坏条目列出但不可恢复。`list_trash` 返回条目 + 限额，前端不硬编码。
- `delete_themes` 是**批量软删除**（决策 43）：收 `themeIds`，去重后逐套复用 `delete_theme` 的 ID 校验、系统方案 / 使用中拒绝与回收站链路，返回 `{ deleted, failed, auto_purged, warning }`；单套失败只进 `failed`，其余照常删除（不回滚成功项）；整批取一把 `ops` 锁、发 `delete-progress`、有成功项才刷新一次托盘。UI 只在「我的主题 → 批量整理」出现，使用中主题复选框禁用，换搜索词清空勾选；选择不落盘。
- `save_current_theme` 无入参（决策 28）：只在当前光标被外部改写时有意义；把注册表当前非空槽位复制为我的主题，全部抄全才自动应用，**有槽位没抄全绝不自动应用**（否则会把那些非空槽位写成空）；当前已是已知主题时返回「无需再保存」。返回 `SaveCurrentOutcome`，前端用 `applied` 区分「已保存并应用」与「只保存」。
- `export_backup` 的 `destPath` 可空：空 = 写入数据目录 backups 目录自动命名（进「备份历史」），传路径 = 导出到任意位置（不受历史管理）；返回含 `saved_path` / `bytes`。`list_backups` 只读 zip 中央目录列应用内备份（时间倒序、上限 200），`kind` 按文件名前缀判定 auto / manual（决策 32），`delete_backup` 只收文件名、拒绝越出备份目录。`verify_backup` 备份体检（决策 37）：流式读每个条目进 sink 触发 CRC，坏条目当场点名（≤20 条 + `corrupt_total`）；**只读不取锁、结果是快照**（列表只覆盖「打开就炸」，数据区静默损坏靠它）；体检入口在备份历史行内，诊断中心不做整库扫描（1GiB × N 会把诊断变成分钟级阻塞）。`run_auto_backup` 是自动备份的命令（决策 32）：收 `keep`，当日去重、按 keep 清理过期 auto 备份（手动备份不碰）、与手动备份共用 ops 锁且不发 `backup-progress`；前端 `lib/auto-backup.ts` 只管触发。
- `list_backup_themes` 只读备份内容（中央目录 + theme.json，不解压光标），返回可恢复的主题与 `warnings`；每项 `missing_files` 按包内实际条目算缺口，部分缺文件仍可恢复、全缺文件界面禁用且命令拒绝；`restore_theme_from_backup` 收 `zipPath` + `themeId`，**只追加一套主题**：目标 ID 已存在直接拒绝、不合并使用记录、不碰其它主题（决策 34）。恢复的是完整主题文件，落盘仍写相对路径，旧备份的绝对路径按主题 id / 文件名重新映射；部分缺文件写进 `warnings`，失败清理本次新建目录，执行期取 `ops` 锁并刷新托盘。**两条恢复路径（合并 + 单主题）遇条目数据损坏（CRC）一律拒绝**：`corrupt_entry_error` 点名坏条目、说明恢复已全部撤销、指引「备份历史 → 体检」（决策 40）；不做部分恢复、不做恢复前预检（决策 37 的体检按需覆盖）。「从文件恢复」外部备份**先看内容再动手**（决策 42）：内容弹窗复用任意路径的 `list_backup_themes`，看完选单套恢复或转整包合并确认。
- `get_data_dir` 只读不建目录；`open_data_dir` / `open_log_dir`（决策 46）才 `ensure_dir` + 调 opener。前端**禁止**用 `localDataDir()` 自己拼 `CursorStudio`（硬约束 1）。
- `get_storage_stats` 同为只读（决策 35）：不建目录、不取锁，条目口径是「含标记文件的一级子目录 / .zip」，孤儿文件只计字节不冒充条目数；`clear_history` 清空使用记录（决策 35），文件不存在返回 0 且**不凭空创建**，只读降级（版本过高 / 损坏）时拒绝覆盖，不走 ops 锁。
- `export_all_themes` 批量导出「我的主题」（决策 35）：收 `destDir`（拒绝落进备份 / 回收站 / 主题库），部分成功——单套失败进 `failed` 其余照常落盘；落盘名后端兜底（非法字符 / 保留名 / 重名加序号不覆盖）；取 ops 锁并发 `export-all-progress`。
- `find_duplicate_themes` 主题内容查重（决策 38）：槽位指纹（键 + 扩展名 + 字节）预分组 → 组内与首套逐字节确认，**只报证实的重复**；缺文件的主题不参与（`skipped_missing` 计数）；只读不取锁；UI 是诊断中心第六项，也是诊断中心**唯一的按需命令**（打开 / 重扫时跑一次、结果只是会话内快照）——其余五项仍全部从 store 派生，别顺手把更多命令塞进诊断。
- `take_pending_import` 领取即删除（右键菜单 `--import` 转交通路），App 在启动与聚焦两个时机调用；`take_pending_import` 损坏返回 null 不报错。
- `update_settings` 是**补丁语义**（只传要改的字段）；关闭行为变更会同步托盘有无；轮换间隔收 `rotateIntervalMinutes`（15–1440，越界中文报错，决策 55）。`preview_themes_dir` 只校验与统计、不碰文件；`set_themes_dir` 返回 `{ settings, report }`，执行中通过 `themes-dir-progress` 事件报阶段，整体成功前不改设置；`import_backup` 是合并恢复，不覆盖已有。
- 除纯路径计算的 `get_data_dir` 外，所有命令都是 `async` + `spawn_blocking`；`import_theme` / `export_backup` / `import_backup` / `restore_theme_from_backup` / `run_auto_backup` / `set_themes_dir` / `export_all_themes` / 删除主题 / 批量删除 / 回收站恢复 / 彻底删除 / 清空 / 保存当前光标额外取 `ops::try_begin` 锁，并分别发 `import-progress` / `backup-progress` / `themes-dir-progress` / `export-all-progress` / `delete-progress`（自动备份与单主题恢复不发事件）。第二个重操作会立刻失败，不要改成排队；只读命令（`get_storage_stats` / `list_backups` / `verify_backup` 等）不取锁。

---

## 检查脚本逐条说明

`design_audit.mjs` / `ui_ratio.mjs` 只扫源码；`nav_check` / `design_check` / `recent_check` / `ui_check` / `dnd_check` / `migration_check` / `future_check` / `auto_switch_check` / `trash_check` / `trash_copy_check` / `capture_check` / `guard_check` / `integrity_check` / `auto_backup_check` / `schedule_check` / `rotate_check` / `backup_content_check` / `backup_verify_check` / `duplicate_check` / `maintenance_check` / `batch_check` / `scheme_import_check` / `mine_view_check` 走交互链路。各脚本的验收内容：

- `nav_check` 逐页断言**结构签名**（网格 / 表格 / 时间轴 / 设置面板、有无检查器与搜索框），页面间同构会直接失败——这是防止"切页看不出变化"回潮的那道闸。
- `mine_view_check` 验收「我的主题」排序与筛选（决策 48 + 决策 53）：默认顺序不变 → 应用次数列与事件流口径一致、没记录显示「—」→ 注入一套最早/最小名/最少槽位的主题后各排序（含按应用次数）各自生效 → 从未使用筛选命中 → 计数标注 → 整理模式下控件让位 → 缺口筛选空态与恢复 → `?mock-broken-files=1` 缺口筛选命中带提示行 → 无 JS 异常。
- `trash_copy_check` 验收恢复为副本（决策 54）：无同 ID 冲突时不出现入口 → 删除主题进回收站仍无入口 → 注入同 ID 主题后行内出现「存为副本」并点击 → 副本以新 UUID 落库、名称带「（副本）」且被选中 → 无 JS 异常。
- `rotate_check` 验收定时轮换（决策 55）：卡片出现（开关 + 间隔下拉 + 状态行）、缺省关闭时下拉禁用 → 开开关改间隔走 mock 设置 → 定时切换开启时状态行点名让位、强制触发不切 → dev 钩子强制触发一轮应用下一套「我的主题」、再触循环推进 → 无 JS 异常。
- `future_check` 验收三个维护界面：诊断中心（设置 → 数据 → 运行诊断）、备份历史（mock 至少 2 行、往返切换）、导入中心（`__importStore.enqueue` 两条 → 串行成功 → 主题数 +2）。
- `trash_check` 验收回收站：删除 → 条目出现 → 恢复回列表 → 彻底删除 → 清空 → 损坏条目禁用恢复（`?mock-trash-damaged`）。
- `capture_check` 验收保存当前光标：`?mock-external=1` 外部改写态 → 保存并应用 → 收编为当前主题（普通态不出现入口）。
- `guard_check` 验收光标守护：默认关 → 开启即恢复 → 重载启动恢复 → 外部改写恢复 → 还原不抢 → 关开关不动 → 手动恢复 → 自动切换优先 → 主题被删不恢复 → 读取失败不动作。
- `integrity_check` 验收主题文件完整性（决策 31）：正常态行内无提示、诊断「正常」→ `?mock-broken-files=1` 行内「缺 N 个文件」→ 检查器警示条点名槽位中文名与后果 → 诊断「注意」并给出证据 → 无 JS 异常。
- `auto_backup_check` 验收自动备份（决策 32）：默认关 → 开启即出当天「自动」条目 → 当日去重 → 重载启动触发 → `?mock-backup-old=6` 注入旧备份后清理到保留份数且手动备份不牵连 → 关闭落盘。
- `schedule_check` 验收定时切换（决策 33）：默认关 → 全日窗口命中期间内主题 → 空串清空 → 还原不抢 → 跨零点窗口按当前时刻判定 → 时间段内深浅色让位 → 关掉后深浅色接管。
- `backup_content_check` 验收备份内容浏览与单主题恢复（决策 34）：备份历史 → 查看内容 → 已有主题禁用恢复 → 缺文件主题标出缺口（`?mock-backup-partial=1`）→ 恢复一套并提示缺口 → 列表重读并选中 → 重新打开仍显示已在库 → 无 JS 异常。
- `migration_check` 用浏览器 mock 注入预检失败与设置写入失败（`?mock-migrate-error` / `?mock-migrate-fail=settings`），断言确认框信息、执行期锁、进度、失败回滚与恢复默认。
- `maintenance_check` 验收维护工具箱（决策 35）：存储占用卡五个区域 + 总占用与「重新统计」→ 导入两条后「我的主题」点「导出全部」→ 提示「已导出 2 套主题」且列表不变 → 「清空使用记录」确认后 `recent` 清空、「最近使用」页变空。
- `batch_check` 验收批量整理（决策 43）：默认无勾选列 → 进入整理模式出现逐行 / 全选三态 → 单选与半选 → 搜索变更清空勾选 → 使用中禁选且全选自动排除 → 确认框点名并批量移入回收站 → 删空回空状态 → 无 JS 异常。
- `scheme_import_check` 验收 `.theme` 光标方案导入（决策 36）：store 直导（stem 命名 + 检查器选中）→ 拖入 `.theme` 走通 → 白名单外拒绝（新文案）→ `validateDrop` 放行 `.theme`、拒绝白名单外 → `.theme` 与 `.zip` 混拖进导入中心串行成功 → 无 JS 异常。
- `backup_verify_check` 验收备份完整性体检（决策 37）：备份历史行内「体检」→ 完好包通过无徽标 → `?mock-backup-corrupt=1` 注入损坏报告 → 「体检损坏 N 处」徽标 + 警告 toast → 无 JS 异常。
- `duplicate_check` 验收主题去重诊断（决策 38）：诊断中心六项齐全 → 默认「没有内容重复的主题」→ 重扫不变 → `?mock-duplicates=1` 摘要「1 组内容重复」+ 注意徽标 → 详情点名成员与可省字节 → 无 JS 异常。

碰注册表的测试只写隔离键（`Software\CursorStudio.Tests\...`；自启动 / 右键菜单用各自的 `TEST_KEY`），数据根指向临时目录，不备份 / 还原用户设置；隔离键让用例可以并行，只有共享同一个键的用例才需自行串行（防中毒取回锁：`unwrap_or_else(|e| e.into_inner())`）。

---

## 真机验证（浏览器 mock 覆盖不到的路径）

`scripts/real_machine/` 下的脚本对**真实 Tauri 窗口**验证（说明见该目录 README）：
隔离 LOCALAPPDATA 数据根 + `cargo run` + CDP 直连 `__TAURI_INTERNALS__.invoke`，
每条消息带 15 秒超时，结束后**按 PID 结束进程**（先 `tasklist /FO CSV /NH` 取
PID，绝不通配杀）并清理临时目录。**前置：应用未在运行**（单实例互斥会让验证
实例退出转交）、vite 已在 1420。`verify_theme_scheme.mjs`（决策 36：UTF-16LE
方案、`%SystemRoot%` 展开到真实系统光标、相对路径收编、真机查重成组）、
`verify_themepack.mjs`（决策 39：`makecab.exe` 打包的 MSZIP 真实 CAB、包内
`.theme` 映射、DisplayName 优先）、`verify_batch_delete.mjs`（决策 43：真实
IPC 下导入两套 → 批量删除（重复 / 非法 ID）→ 主题库清空、回收站两条正常）、
`verify_import_duplicate.mjs`（决策 47：同内容包二次导入点名重复、不拦截）、
`verify_iterate_features.mjs`（决策 53/54/55：隔离数据根手写事件流验证
`apply_counts` 真机派生与窗口展示、`asCopy` 副本恢复的真实落盘与同 ID 冲突
拒绝、轮换设置的 settings.json 落盘与越界拒绝——**全程不调 `apply_theme`**，
真机注册表不隔离）、
`verify_ani_blur.mjs`（决策 60：真实 OS 焦点迁移下 AniPlayer 失焦停表、
聚焦续播，只读系统方案预览不碰注册表）与
`verify_cursor_size.mjs`（决策 51：光标大小注册表假设的真机证伪——唯一不启动
应用的例外，整键备份还原，退出码 1 = 假设未证实）。
**不进 CI、不入 `AGENTS.md` 验证链**——它们碰真实文件系统，改动导入链路（决策
15/16/36/39/47 涉及的文件）或批量删除路径（决策 43）后手动跑一遍。历史证据（截图 + 结论）见 `docs/real-machine-verify/`。
