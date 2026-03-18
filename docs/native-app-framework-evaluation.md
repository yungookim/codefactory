# Native App Framework Evaluation for CodeFactory

## Context

CodeFactory is currently a web application (React frontend + Express backend) that runs locally and opens in the user's browser. We want to convert it into a native desktop app with the following critical requirement:

- **Single-instance enforcement**: Only one instance of CodeFactory may run on the OS at a time.

This document evaluates frameworks as alternatives to Electron.

---

## Framework Comparison

### 1. Tauri (Rust backend)

| Aspect | Details |
|--------|---------|
| **Single-instance support** | Built-in via the `tauri-plugin-single-instance` plugin. Uses OS-level mutex/lock. When a second instance launches, a callback fires on the first instance (e.g., to focus the window or handle deep links). First-class, zero-effort support. |
| **Bundle size** | ~3-10 MB (vs. Electron's ~150+ MB). Uses the OS webview (WebView2 on Windows, WebKit on macOS/Linux) instead of bundling Chromium. |
| **Memory usage** | ~50-80 MB typical (vs. Electron's 150-300+ MB). No bundled V8 engine or Chromium. |
| **Tech stack** | Rust for backend/system APIs, any web framework for frontend. Our existing React/Vite frontend can be reused with minimal changes. |
| **Frontend reuse** | Excellent. Tauri serves the web frontend in a webview. Our React + Tailwind + shadcn/ui frontend works as-is. |
| **System APIs** | File system, system tray, notifications, clipboard, dialogs, shell commands, auto-start, global shortcuts, deep linking, IPC (commands + events). |
| **Child process spawning** | Supported via `tauri-plugin-shell` (sidecar and command execution). Critical for CodeFactory's `codex`/`claude` CLI agent spawning. |
| **Auto-update** | Built-in updater plugin with signature verification. |
| **Cross-platform** | Windows, macOS, Linux. Also supports iOS/Android (Tauri v2). |
| **Maturity** | Tauri v2 is stable (released 2024). Large community, active development, used in production by many projects. |
| **SQLite support** | `tauri-plugin-sql` or use the existing Node.js SQLite via a sidecar. Alternatively, can run the Express server as a sidecar process. |
| **Migration effort** | **Medium**. Frontend reusable. Backend needs adaptation: either port Express routes to Tauri commands (Rust), or run Express as a sidecar process and use the webview to connect to it. |

**Single-instance implementation:**
```rust
// In Cargo.toml
// tauri-plugin-single-instance = "2"

// In lib.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // Focus the main window when a second instance is attempted
            if let Some(window) = app.get_webview_window("main") {
                window.set_focus().unwrap();
            }
        }))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### 2. Wails (Go backend)

| Aspect | Details |
|--------|---------|
| **Single-instance support** | Built-in via `SingleInstanceLock` option in app config (Wails v2/v3). Uses named mutex on Windows and file lock on macOS/Linux. Provides a callback with the second instance's launch arguments. |
| **Bundle size** | ~5-15 MB. Uses OS webview like Tauri. |
| **Memory usage** | ~60-100 MB. Similar to Tauri. |
| **Tech stack** | Go for backend, any web framework for frontend. |
| **Frontend reuse** | Excellent. Same webview approach. React frontend works directly. |
| **System APIs** | File system, system tray, menus, dialogs, clipboard, events. Slightly smaller API surface than Tauri. |
| **Child process spawning** | Native Go `os/exec` — trivial and robust. |
| **Auto-update** | Community solutions; no built-in updater as mature as Tauri's. |
| **Cross-platform** | Windows, macOS, Linux. |
| **Maturity** | Wails v2 is stable. Wails v3 is in active development. Smaller community than Tauri but growing. |
| **Migration effort** | **Medium-High**. Backend would need to be rewritten in Go. Frontend reusable. |

**Single-instance implementation:**
```go
app := wails.CreateApp(&wails.AppConfig{
    SingleInstanceLock: &options.SingleInstanceLock{
        UniqueId: "com.codefactory.app",
        OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
            // Focus main window
            runtime.WindowUnminimise(ctx)
            runtime.Show(ctx)
        },
    },
})
```

---

### 3. Neutralinojs

| Aspect | Details |
|--------|---------|
| **Single-instance support** | **No built-in support.** Must be implemented manually using file locks, named pipes, or inter-process communication. This is a significant gap for our requirements. |
| **Bundle size** | ~2-5 MB. Smallest of all options. |
| **Memory usage** | ~30-50 MB. Very lightweight. |
| **Tech stack** | C++ runtime, JavaScript/TypeScript for both backend and frontend. |
| **Frontend reuse** | Good. Web frontend works. |
| **System APIs** | File system, system tray, clipboard, OS info. More limited than Tauri/Wails. |
| **Child process spawning** | Supported via `Neutralino.os.execCommand()`. |
| **Auto-update** | Basic built-in updater (resource replacement only, not full binary updates). |
| **Cross-platform** | Windows, macOS, Linux, Web. |
| **Maturity** | **Low-medium.** Primarily maintained by a single developer. Not recommended for enterprise use. Limited ecosystem. |
| **Migration effort** | **Low** (since JS backend), but fragile for production use. |

---

### 4. Flutter Desktop

| Aspect | Details |
|--------|---------|
| **Single-instance support** | Available via community packages (`window_manager`, `single_instance` pub packages). Not built-in — requires third-party dependency. |
| **Bundle size** | ~15-30 MB. Bundles the Skia rendering engine. |
| **Memory usage** | ~80-150 MB. Higher due to custom rendering. |
| **Tech stack** | Dart. **Cannot reuse the existing React frontend.** Full rewrite required. |
| **Frontend reuse** | **None.** Flutter uses its own widget system. The entire React/Tailwind/shadcn UI would need to be rebuilt in Dart/Flutter. |
| **System APIs** | File system, system tray (via plugins), notifications, platform channels for native code. |
| **Child process spawning** | Supported via `dart:io` `Process.run()`. |
| **Auto-update** | Community solutions. MSIX on Windows, DMG on macOS. |
| **Cross-platform** | Windows, macOS, Linux, iOS, Android, Web. Broadest reach. |
| **Maturity** | High. Backed by Google. Large ecosystem. |
| **Migration effort** | **Very High.** Complete frontend rewrite in Dart. No code reuse for UI. |

---

## Comparison Summary

| Feature | Tauri | Wails | Neutralinojs | Flutter |
|---------|-------|-------|--------------|---------|
| **Single-instance** | Built-in plugin | Built-in option | Manual only | Community package |
| **Bundle size** | ~3-10 MB | ~5-15 MB | ~2-5 MB | ~15-30 MB |
| **Memory** | ~50-80 MB | ~60-100 MB | ~30-50 MB | ~80-150 MB |
| **Frontend reuse** | Full | Full | Full | None |
| **System API breadth** | Excellent | Good | Limited | Good |
| **Child process spawn** | Plugin | Native Go | Supported | Supported |
| **Auto-update** | Built-in | Community | Basic | Community |
| **Maturity** | High | Medium | Low | High |
| **Backend language** | Rust | Go | JS | Dart |
| **Migration effort** | Medium | Medium-High | Low | Very High |

---

## Recommendation: Tauri

**Tauri is the clear winner for CodeFactory** for the following reasons:

### 1. First-class single-instance support
The `tauri-plugin-single-instance` plugin provides exactly what we need with zero custom code — OS-level mutex enforcement with a callback to handle the second instance's arguments (e.g., to focus the existing window or handle deep links).

### 2. Full frontend reuse
Our React + Vite + Tailwind + shadcn/ui frontend works in Tauri's webview with minimal changes. The migration primarily affects the backend integration layer, not the UI.

### 3. Practical migration path for CodeFactory
Two viable approaches:

- **Option A — Sidecar architecture** (recommended for faster migration): Run the existing Express server as a Tauri sidecar process. The webview connects to `localhost:5001` as it does today. Tauri provides the native shell (window management, system tray, single-instance, auto-update). This preserves the entire existing backend.

- **Option B — Full Tauri commands**: Port Express API routes to Tauri commands in Rust. More work upfront but tighter integration and better security (no open localhost port).

### 4. Production-ready features CodeFactory needs
- **Shell command execution**: Critical for spawning `codex`/`claude` CLI agents — supported via `tauri-plugin-shell`.
- **File system access**: Critical for worktree management, SQLite database, logs — supported via `tauri-plugin-fs`.
- **System tray**: Run CodeFactory in background while babysitting PRs.
- **Notifications**: Alert when PR feedback needs attention.
- **Auto-update**: Push updates to users seamlessly.

### 5. Small footprint
~3-10 MB bundle (vs. Electron's 150+ MB) means fast downloads and low disk usage. ~50-80 MB memory fits CodeFactory's "runs in the background" use case.

---

## Why Not the Others?

| Framework | Reason to pass |
|-----------|---------------|
| **Wails** | Good option, but requires rewriting the backend in Go. Smaller ecosystem and less mature auto-update story. Single-instance is built-in though. Would be a reasonable second choice. |
| **Neutralinojs** | No built-in single-instance support. Single-maintainer project. Limited API surface. Not enterprise-ready. |
| **Flutter** | Requires complete frontend rewrite in Dart. No code reuse for our React UI. Overkill for a developer tool that already has a web frontend. |
| **Electron** | Works but bundles Chromium (~150 MB), high memory usage (~300 MB+). Single-instance is supported via `app.requestSingleInstanceLock()`. Only advantage is zero migration effort for a Node.js/web app. |

---

## Next Steps

1. **Scaffold a Tauri v2 project** alongside the existing codebase
2. **Start with Option A (sidecar)**: wrap the existing Express server as a Tauri sidecar
3. **Add `tauri-plugin-single-instance`** for single-instance enforcement
4. **Add system tray** support for background operation
5. **Incrementally migrate** Express routes to Tauri commands if desired
