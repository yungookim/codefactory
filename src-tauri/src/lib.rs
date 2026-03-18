use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct ServerProcess(Mutex<Option<Child>>);

fn start_server(resource_dir: std::path::PathBuf, port: u16) -> std::io::Result<Child> {
    let server_script = resource_dir.join("dist").join("index.cjs");

    if !server_script.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Server bundle not found at {:?}", server_script),
        ));
    }

    Command::new("node")
        .arg(&server_script)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .current_dir(&resource_dir)
        .spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port: u16 = if cfg!(debug_assertions) {
        5001
    } else {
        portpicker::pick_unused_port().unwrap_or(5001)
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            // In production, start the bundled Express server
            if !cfg!(debug_assertions) {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("Failed to resolve resource directory");

                let child = start_server(resource_dir, port)
                    .expect("Failed to start server. Is Node.js installed?");
                app.manage(ServerProcess(Mutex::new(Some(child))));

                // Give the server time to initialize
                std::thread::sleep(std::time::Duration::from_millis(2000));
            } else {
                app.manage(ServerProcess(Mutex::new(None)));
            }

            // Point the webview at the Express server
            let server_url = format!("http://localhost:{}", port);
            if let Some(window) = app.get_webview_window("main") {
                let url: tauri::Url = server_url.parse().expect("Invalid URL");
                let _ = window.navigate(url);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill the server process when the app is closed
                if let Some(state) = window.try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
