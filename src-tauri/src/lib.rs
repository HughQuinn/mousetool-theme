pub mod commands;
pub mod models;
pub mod utils;

use commands::backup::{
    delete_backup, export_backup, import_backup, list_backup_themes, list_backups,
    restore_theme_from_backup, run_auto_backup, verify_backup,
};
use commands::cursor::get_cursor_preview;
use commands::data::{clear_history, get_data_dir, get_storage_stats, open_data_dir, open_log_dir};
use commands::settings::{
    get_autostart, get_settings, preview_themes_dir, set_autostart, set_themes_dir, update_settings,
};
use commands::system::{
    exit_app, get_windows_version, get_zip_menu_registered, hide_window_to_tray, open_mouse_panel,
    set_zip_menu, take_pending_import,
};
use commands::theme::{
    apply_theme, delete_theme, delete_themes, export_all_themes, export_theme,
    find_duplicate_themes, get_active_state, get_all_themes, import_theme, rename_theme,
    restore_default, save_current_theme,
};
use commands::trash::{delete_from_trash, empty_trash, list_trash, restore_from_trash};
use tauri::{Emitter, Manager};
use utils::log;
use utils::settings::{self, CloseBehavior};
use utils::{integration, tray};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例 + 右键菜单 `--import` 转交：已有实例时这里可能直接退出进程
    integration::handle_launch();

    // 每次会话一条启动标记：报障时日志能对上「当时用的是哪个版本」
    log::info("app", &format!("应用启动（版本 {}）", env!("CARGO_PKG_VERSION")));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 托盘按设置决定有无：关闭行为是「最小化到托盘」才有图标
            tray::sync(app.handle());
            // 二次启动唤回隐藏窗的信号由这个线程接收（integration::handle_launch
            // 在首实例分支创建了事件），显示动作派回主线程执行
            integration::spawn_show_waiter(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭行为在 Rust 侧拦截（settings.json 存的就是给这里读的）：
            // - tray：拦下关闭，藏窗继续跑（托盘能叫回来）
            // - ask（决策 57）：拦下关闭，发 `close-ask` 事件交给前端弹询问框；
            //   页面尚未就绪时事件会丢、窗口保持打开，再关一次即可
            // - exit：不拦，按默认行为退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                match settings::read().close_behavior {
                    CloseBehavior::Tray => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    CloseBehavior::Ask => {
                        api.prevent_close();
                        let _ = window.app_handle().emit("close-ask", ());
                    }
                    CloseBehavior::Exit => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_all_themes,
            get_active_state,
            get_cursor_preview,
            apply_theme,
            restore_default,
            save_current_theme,
            import_theme,
            delete_theme,
            delete_themes,
            rename_theme,
            export_theme,
            export_all_themes,
            find_duplicate_themes,
            get_data_dir,
            open_data_dir,
            open_log_dir,
            get_storage_stats,
            clear_history,
            get_windows_version,
            open_mouse_panel,
            get_zip_menu_registered,
            set_zip_menu,
            take_pending_import,
            hide_window_to_tray,
            exit_app,
            get_settings,
            update_settings,
            get_autostart,
            set_autostart,
            preview_themes_dir,
            set_themes_dir,
            export_backup,
            import_backup,
            list_backups,
            list_backup_themes,
            restore_theme_from_backup,
            delete_backup,
            verify_backup,
            run_auto_backup,
            list_trash,
            restore_from_trash,
            delete_from_trash,
            empty_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
