// 真机验证共用工具：应用启动（隔离数据根 + CDP）、带超时的 CDP 客户端、断言、清理
// 前置见同目录 README：应用未运行、vite 已在 1420、Rust 工具链可用。
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export const CDP_PORT = 9335;
export const ROOT = join(process.env.TEMP ?? ".", "cs-rm-verify");

export function prepareRoot() {
  rmWithRetry(ROOT);
  mkdirSync(join(ROOT, "appdata"), { recursive: true });
  mkdirSync(join(ROOT, "pack"), { recursive: true });
  return { appdata: join(ROOT, "appdata"), pack: join(ROOT, "pack") };
}

/** Windows 上刚用过的临时目录常被杀软 / 索引器短暂占着（EPERM），重试几轮再放弃 */
function rmWithRetry(path, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      return true;
    } catch {
      if (i < attempts - 1) sleep(500);
    }
  }
  return false;
}

export function assertNoRunningInstance() {
  const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq mousetool-theme.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  if (out.includes("mousetool-theme.exe")) {
    throw new Error("检测到 mousetool-theme.exe 已在运行：单实例互斥会让验证实例退出转交。请先关闭它再跑真机验证。");
  }
}

/** 启动带隔离数据根的应用（cargo run，dev 配置加载 1420 的 vite） */
export function launchApp(appdata) {
  const repoRoot = process.cwd();
  const child = spawn("cargo", ["run"], {
    cwd: join(repoRoot, "src-tauri"),
    env: {
      ...process.env,
      LOCALAPPDATA: appdata,
      // WebView2 的用户数据目录不认 LOCALAPPDATA 覆盖（按 bundle 标识符落在
      // 用户真实 %LOCALAPPDATA%），必须用自家环境变量显式指进隔离根，
      // 否则外观偏好等 localStorage 会写进并残留到用户真实 profile
      WEBVIEW2_USER_DATA_FOLDER: join(appdata, "webview-profile"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

/** 等待 CDP 页面目标就绪（应用窗口起来后才有） */
export async function waitPageTarget(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && !/devtools/i.test(t.url));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error("等应用 CDP 端口超时");
}

/** 带超时的 CDP 客户端：任何单条消息挂起都不会卡死整个脚本 */
export function connectCdp(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const pageErrors = [];
  const eventListeners = new Set();
  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        data.params?.exceptionDetails?.exception?.description ?? data.params?.exceptionDetails?.text,
      );
    }
    if (data.method && eventListeners.size) {
      for (const fn of eventListeners) fn(data.method, data.params);
    }
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  });
  const opened = new Promise((ok, err) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => err(new Error("CDP WebSocket 连接失败")), { once: true });
  });
  let msgId = 0;
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((ok) => {
        const id = ++msgId;
        pending.set(id, ok);
        ws.send(JSON.stringify({ id, method, params }));
      }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`CDP ${method} 超时`)), 15_000),
      ),
    ]);
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? "页面内执行失败");
    }
    return res.result?.result?.value;
  };
  /** 订阅 CDP 事件（如 Page.screencastFrame）；返回退订函数 */
  const onEvent = (fn) => {
    eventListeners.add(fn);
    return () => eventListeners.delete(fn);
  };
  return { opened, send, evaluate, onEvent, pageErrors };
}

export async function waitAppReady(evaluate) {
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(
      `Boolean(window.__TAURI_INTERNALS__ && globalThis.__themeStore && !globalThis.__themeStore.getState().loading)`,
    ).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

/** 按 PID 结束验证实例（进程是我们启动的那一个；绝不通配杀） */
export function killApp() {
  const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq mousetool-theme.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  const pids = [...out.matchAll(/"mousetool-theme\.exe","(\d+)"/g)].map((m) => m[1]);
  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

export function cleanup() {
  // 清理失败只告警不抛错：它在 finally 里，抛错会吞掉验证脚本本来的退出码
  if (!rmWithRetry(ROOT)) {
    console.log(`[warn] 临时目录未能清理（可能被占用，可手动删）：${ROOT}`);
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 统一的断言收集器 */
export function createChecker() {
  const results = [];
  return {
    check(name, ok, detail = "") {
      results.push(ok);
      console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? `  ${detail}` : ""}`);
    },
    finish(label) {
      const failed = results.filter((ok) => !ok).length;
      console.log(`\n[${label}] ${results.length - failed}/${results.length} 通过`);
      process.exitCode = failed > 0 ? 1 : 0;
    },
  };
}
