//! 系统与集成相关命令：诊断信息、Windows 快捷入口、右键菜单试点、待导入领取

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::utils::{integration, tray};

/// 右键菜单注册状态
#[derive(Debug, Serialize)]
pub struct ZipMenuStatus {
    pub registered: bool,
    /// 当前程序路径（注册时命令会指向它；界面展示让用户知道命令落在哪）
    pub exe_path: String,
}

/// Windows 版本描述（诊断信息用）
///
/// 注意 Win11 的 `ProductName` 仍是 "Windows 10..."（微软没改），所以用
/// `CurrentBuildNumber >= 22000` 判大版本，`DisplayVersion` 给出 23H2/24H2。
#[tauri::command]
pub async fn get_windows_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(windows_version)
        .await
        .map_err(|err| format!("读取系统版本任务异常退出（{err}）"))?
}

fn windows_version() -> Result<String, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hk = RegKey::predef(HKEY_LOCAL_MACHINE);
    let current = hk
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .map_err(|err| format!("读不到系统版本信息（{err}）"))?;

    let build: String = current
        .get_value("CurrentBuildNumber")
        .unwrap_or_else(|_| String::new());
    let ubr: u32 = current.get_value("UBR").unwrap_or(0);
    let display: String = current
        .get_value("DisplayVersion")
        .unwrap_or_else(|_| String::new());

    let edition = if build.parse::<u32>().map(|n| n >= 22000).unwrap_or(false) {
        "Windows 11"
    } else {
        "Windows 10"
    };
    let display = if display.is_empty() {
        String::new()
    } else {
        format!(" {display}")
    };
    Ok(format!("{edition}{display}（build {build}.{ubr}）"))
}

/// 打开经典「鼠标属性」面板，定位在「指针」选项卡
///
/// 曾尝试跳转新版设置页（`ms-settings:mouse`）：cmd start / explorer.exe /
/// ShellExecuteW / 用户手按 Win+R 在本机全回落设置主页——页面别名在这台
/// 系统上不解析（2026-10-22 实证）。经典面板全系统可用，收敛于此。
#[tauri::command]
pub async fn open_mouse_panel() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        std::process::Command::new("rundll32")
            .args(["shell32.dll,Control_RunDLL", "main.cpl,,1"])
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("打开鼠标属性面板失败（{err}）"))
    })
    .await
    .map_err(|err| format!("打开鼠标属性面板任务异常退出（{err}）"))?
}

/// 右键菜单当前是否已注册
#[tauri::command]
pub async fn get_zip_menu_registered() -> Result<ZipMenuStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (registered, exe_path) = integration::zip_menu_status();
        Ok(ZipMenuStatus {
            registered,
            exe_path,
        })
    })
    .await
    .map_err(|err| format!("读取右键菜单状态任务异常退出（{err}）"))?
}

/// 注册 / 移除 `.zip` 右键菜单（试点：先看效果再定去留，见决策 12）
#[tauri::command]
pub async fn set_zip_menu(register: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if register {
            integration::register_zip_menu().map(|_| ())
        } else {
            integration::unregister_zip_menu()
        }
    })
    .await
    .map_err(|err| format!("右键菜单任务异常退出（{err}）"))?
}

/// 领取待导入的主题文件路径（右键菜单 / 二次启动转交；.zip / .themepack /
/// .theme 按扩展名分发，决策 41），领取即消费
#[tauri::command]
pub async fn take_pending_import() -> Option<String> {
    tauri::async_runtime::spawn_blocking(integration::take_pending_import)
        .await
        .unwrap_or(None)
}

/// 关窗询问里选「最小化到托盘」的一次性执行（决策 57）：藏窗并按需补托盘
///
/// 藏窗必须在**主线程**执行：Win32 的 ShowWindow 从非创建线程发起时，那个
/// 线程对这扇窗的**第一次调用会被窗口管理器丢弃**（起始窗口惯例的副作用），
/// spawn_blocking 线程池每次可能是不同线程，隐藏会随机静默失效。托盘同步
/// 跟在 hide 之后同一闭包里执行：ask 模式按「藏窗期间存在」判定，不能在
/// hide 生效前就被当时的可见性顶掉。
///
/// 此时关闭行为仍是 ask；勾「不再询问」的持久化走 `update_settings`（那边
/// 会同步托盘），这里只管当下这一次。
#[tauri::command]
pub async fn hide_window_to_tray(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在，无法最小化到托盘".to_string())?;
    let for_hide = window.clone();
    let for_sync = app.clone();
    window
        .run_on_main_thread(move || {
            let _ = for_hide.hide();
            tray::sync(&for_sync);
        })
        .map_err(|err| format!("调度主窗口隐藏失败（{err}）"))?;
    Ok(())
}

/// 退出应用（关窗询问里选「退出应用」，决策 57）：直接结束进程
///
/// 勾「不再询问」时的持久化由前端先走 `update_settings`，这里不重复写。
#[tauri::command]
pub async fn exit_app(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.exit(0))
        .await
        .map_err(|err| format!("退出任务异常退出（{err}）"))
}
