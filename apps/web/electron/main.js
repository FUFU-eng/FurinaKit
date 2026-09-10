// FurinaKit Electron 主进程
const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, shell, ipcMain, session, dialog, nativeTheme } = require('electron');

// 统一原生渲染主题为深色，避免任何系统弹窗/控件出现白屏底色
try {
  nativeTheme.themeSource = 'dark';
} catch (e) {}

// 提前设置 Windows AppUserModelID（确保任务栏图标正确关联到已注册的应用身份和图标）
if (process.platform === 'win32') {
  app.setAppUserModelId('furinakit.desktop.app');
}

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

// ============ 配置 ============
const PORT = 3001;

// 读取系统代理设置，让yt-dlp等子进程自动走代理
function getSystemProxy() {
  try {
    const { execSync } = require('child_process');
    const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer', { encoding: 'utf-8', windowsHide: true });
    const match = result.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (match) {
      const proxyAddr = match[1];
      const enableResult = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable', { encoding: 'utf-8', windowsHide: true });
      const enableMatch = enableResult.match(/ProxyEnable\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/);
      if (enableMatch && parseInt(enableMatch[1], 16) === 1) {
        return proxyAddr;
      }
    }
  } catch (e) {}
  return null;
}
const SYSTEM_PROXY = getSystemProxy();
if (SYSTEM_PROXY) {
  process.env.HTTP_PROXY = 'http://' + SYSTEM_PROXY;
  process.env.HTTPS_PROXY = 'http://' + SYSTEM_PROXY;
  process.env.ALL_PROXY = 'http://' + SYSTEM_PROXY;
  console.log('[FurinaKit] 系统代理已启用:', SYSTEM_PROXY);
}

const URL = `http://localhost:${PORT}`;
const IS_PACKAGED = app.isPackaged;
const RESOURCES_DIR = IS_PACKAGED ? process.resourcesPath : path.resolve(__dirname, '..', '..', '..');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKER_PY = IS_PACKAGED 
  ? path.join(RESOURCES_DIR, 'furinakit-worker.exe')
  : path.join(ROOT, 'services', 'worker', '.venv', 'Scripts', 'pythonw.exe');
const WORKER_SCRIPT = IS_PACKAGED ? null : path.join(ROOT, 'services', 'worker', 'worker.py');
const WORKER_DIR = IS_PACKAGED ? RESOURCES_DIR : path.join(ROOT, 'services', 'worker');
const WEB_DIR = IS_PACKAGED ? path.join(RESOURCES_DIR, 'app') : path.join(ROOT, 'apps', 'web');
const ICON_PATH = IS_PACKAGED ? path.join(RESOURCES_DIR, 'furinakit.ico') : path.join(ROOT, 'furinakit.ico');
const FFMPEG_PATH = IS_PACKAGED ? path.join(RESOURCES_DIR, 'ffmpeg.exe') : path.join(ROOT, 'apps', 'web', 'ffmpeg.exe');

// 配置文件和输出目录（自动适配安装目录，不硬编码盘符）
const USER_DATA_DIR = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA_DIR, 'furinakit-settings.json');
const DEFAULT_OUTPUT_DIR = path.join(app.getPath('documents'), 'FurinaKit', '输出结果');

// 把路径通过环境变量传给Python worker
process.env.FURINAKIT_SETTINGS_FILE = SETTINGS_FILE;
process.env.FURINAKIT_DEFAULT_OUTPUT_DIR = DEFAULT_OUTPUT_DIR;
// 统一存储路径（任务队列、任务文件、上传文件、结果文件），确保前端和worker路径一致
const STORAGE_DIR = IS_PACKAGED ? path.join(USER_DATA_DIR, 'storage') : path.join(ROOT, 'data', 'storage');
process.env.STORAGE_PATH = STORAGE_DIR;
process.env.FURINAKIT_STORAGE_PATH = STORAGE_DIR;
process.env.USE_FILE_QUEUE = '1';
process.env.NEXT_PUBLIC_ENABLE_DOWNLOADS = '1';
process.env.NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS = '1';

// 确保存储及其必要子目录预先创建完毕
try {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(path.join(STORAGE_DIR, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(STORAGE_DIR, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(STORAGE_DIR, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(STORAGE_DIR, 'results'), { recursive: true });
} catch (e) {}

// 把ffmpeg添加到PATH
if (fs.existsSync(FFMPEG_PATH)) {
  process.env.PATH = path.dirname(FFMPEG_PATH) + ';' + process.env.PATH;
}

// ============ 全局变量 ============
let mainWindow = null;
let tray = null;
let workerProc = null;
let webProc = null;
let isQuitting = false;
let datatoolBrowserView = null;
let datatoolViewVisible = false;

// ============ 工具函数 ============
function findNode() {
  // 打包环境下优先使用打包的node.exe
  if (IS_PACKAGED) {
    const bundledNode = path.join(RESOURCES_DIR, 'node.exe');
    if (fs.existsSync(bundledNode)) {
      return bundledNode;
    }
  }
  // 开发环境或打包的node不存在时，尝试系统安装的node
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : '',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'node'; // fallback to PATH
}

function checkServiceReady() {
  return new Promise((resolve) => {
    const req = http.get(URL, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForService(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    const ready = await checkServiceReady();
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ============ 启动子进程 ============
function startWorker() {
  console.log('[FurinaKit] 启动 Python Worker...');
  console.log(`[FurinaKit] WORKER_PY: ${WORKER_PY}`);
  console.log(`[FurinaKit] WORKER_SCRIPT: ${WORKER_SCRIPT}`);
  console.log(`[FurinaKit] WORKER_DIR: ${WORKER_DIR}`);
  if (!fs.existsSync(WORKER_PY)) {
    console.error(`[FurinaKit] 找不到 Worker: ${WORKER_PY}`);
    return;
  }
  const workerArgs = IS_PACKAGED ? [] : [WORKER_SCRIPT];
  console.log(`[FurinaKit] workerArgs: ${workerArgs.join(' ')}`);
  workerProc = spawn(WORKER_PY, workerArgs, {
    cwd: WORKER_DIR,
    detached: false,
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      STORAGE_PATH: STORAGE_DIR,
      FURINAKIT_STORAGE_PATH: STORAGE_DIR,
      FURINAKIT_DEFAULT_OUTPUT_DIR: DEFAULT_OUTPUT_DIR,
      FURINAKIT_SETTINGS_FILE: SETTINGS_FILE,
    },
  });
  workerProc.stdout.on('data', (data) => {
    console.log(`[Worker] ${data.toString().trim()}`);
  });
  workerProc.stderr.on('data', (data) => {
    console.error(`[Worker Error] ${data.toString().trim()}`);
  });
  workerProc.on('error', (err) => {
    console.error(`[FurinaKit] Worker 启动失败: ${err.message}`);
  });
  workerProc.on('exit', (code) => {
    console.log(`[FurinaKit] Worker 退出，代码: ${code}`);
  });
  console.log(`[FurinaKit] Worker 已启动，PID: ${workerProc.pid}`);
}

async function startWebServer() {
  console.log('[FurinaKit] 启动 Next.js 服务...');
  // 如果已经有服务占用端口（例如旧进程或用户手动启动过），
  // 不要再重复拉起第二个 Next.js 进程，避免端口冲突导致窗口一直空转。
  if (await portInUse()) {
    console.log('[FurinaKit] 检测到端口已在提供服务，复用现有服务');
    return;
  }
  const binDir = path.join(WEB_DIR, 'node_modules', '.bin');
  const nodeExe = findNode();
  const nodeDir = path.dirname(nodeExe);
  const env = {
    ...process.env,
    PATH: nodeDir + ';' + binDir + ';' + process.env.PATH,
    FURINAKIT_YTDLP_PATH: IS_PACKAGED ? path.join(RESOURCES_DIR, "yt-dlp.exe") : "",
    FURINAKIT_FFMPEG_PATH: FFMPEG_PATH,
    FURINAKIT_ARIA2_PATH: IS_PACKAGED ? path.join(RESOURCES_DIR, "aria2c.exe") : path.join(ROOT, "apps", "web", "aria2c.exe"),
    FURINAKIT_DEFAULT_OUTPUT_DIR: DEFAULT_OUTPUT_DIR,
    FURINAKIT_STORAGE_PATH: STORAGE_DIR,
    STORAGE_PATH: STORAGE_DIR,
    USE_FILE_QUEUE: '1',
    NEXT_PUBLIC_ENABLE_DOWNLOADS: '1',
    NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS: '1',
  };
  // 直接用 node 运行 next.js（避免 .cmd 的 shell 问题）
  const nextJs = path.join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  // 有生产构建产物（.next/BUILD_ID）时用 start（秒开、无调试徽标），否则回退 dev。
  const hasBuild = fs.existsSync(path.join(WEB_DIR, '.next', 'BUILD_ID'));
  const mode = hasBuild ? 'start' : 'dev';
  console.log('[FurinaKit] Next 模式:', mode);
  webProc = spawn(nodeExe, [nextJs, mode, '--port', String(PORT)], {
    cwd: WEB_DIR,
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  webProc.on('error', (err) => {
    console.log('[FurinaKit] Web 服务启动错误:', err.message);
  });
  webProc.on('exit', (code) => {
    console.log(`[FurinaKit] Web 服务退出，代码: ${code}`);
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    // Windows上使用taskkill /T /F杀死整个进程树
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) {
    // 进程可能已经退出，忽略错误
  }
}

function killPortOwner(port) {
  if (process.platform !== 'win32') return;
  try {
    const { execSync } = require('child_process');
    const netstatOut = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf-8', windowsHide: true });
    const lines = netstatOut.trim().split('\n');
    const pidsToKill = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid !== process.pid) {
          pidsToKill.add(pid);
        }
      }
    }
    for (const pid of pidsToKill) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } catch (e) {}
    }
  } catch (e) {}
}

function killFurinaKitProcesses() {
  if (process.platform !== 'win32') return;
  try {
    const { execSync } = require('child_process');
    const script = `
$ProgressPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -match '^(python|pythonw|node|electron|furinakit-worker|yt-dlp|ffmpeg)\\.exe$') -and
  ($_.CommandLine -match 'FurinaKit|OmniKit' -or $_.ExecutablePath -match 'FurinaKit|OmniKit') -and
  ($_.ProcessId -ne ${process.pid})
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { stdio: 'ignore', windowsHide: true });
  } catch (e) {}
}

let isStopping = false;
let hasNotifiedTray = false;

// 检查是否已经向用户提示过最小化到托盘（持久化保存在配置文件中，仅在用户初次关闭时提示一次）
function shouldNotifyTray() {
  if (hasNotifiedTray) return false;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (s && (s.hasNotifiedTray || s.trayNotificationShown)) {
        hasNotifiedTray = true;
        return false;
      }
    }
  } catch (e) {}
  return true;
}

function markTrayNotified() {
  hasNotifiedTray = true;
  try {
    let s = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) || {};
      } catch (e) {}
    }
    s.hasNotifiedTray = true;
    s.trayNotificationShown = true;
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8');
  } catch (e) {}
}

function notifyTrayOnce() {
  if (!tray) return;
  if (!shouldNotifyTray()) return;
  markTrayNotified();
  try {
    tray.displayBalloon({
      title: 'FurinaKit 芙宁娜工具箱',
      content: '已最小化到系统托盘，右键托盘图标可彻底退出',
    });
  } catch (err) {}
}

function shouldCloseToTray() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (s && s.closeAction === 'quit') return false;
    }
  } catch (e) {}
  return true;
}

// 首次安装与激活匿名统计打卡（仅作者私有桌面监控看板可见，用户端无任何界面感知）
function checkAndReportInstall() {
  try {
    let s = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) || {};
      } catch (e) {}
    }
    if (s.installedReported) return;

    const https = require('https');
    let marked = false;
    const markSuccess = () => {
      if (marked) return;
      marked = true;
      s.installedReported = true;
      s.installedReportedAt = new Date().toISOString();
      try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8');
      } catch (e) {}
    };

    // 通道 1: CountAPI 主通道
    try {
      const req1 = https.get(
        'https://countapi.mileshilliard.com/api/v1/hit/furinakit_prod_installs_v2',
        { timeout: 7000, headers: { 'User-Agent': 'FurinaKit/' + (app.getVersion() || '2.0.1') } },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) markSuccess();
        }
      );
      req1.on('error', () => {});
      req1.on('timeout', () => req1.destroy());
    } catch (e) {}

    // 通道 2: Abacus 备用通道
    try {
      const req2 = https.get(
        'https://abacus.jasoncameron.dev/hit/furinakit_prod/installs',
        { timeout: 7000, headers: { 'User-Agent': 'FurinaKit/' + (app.getVersion() || '2.0.1') } },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) markSuccess();
        }
      );
      req2.on('error', () => {});
      req2.on('timeout', () => req2.destroy());
    } catch (e) {}
  } catch (err) {}
}

function stopAll() {
  if (isStopping) return;
  isStopping = true;
  console.log('[FurinaKit] 开始执行全量退出与后台清理...');

  const workerPid = workerProc ? workerProc.pid : null;
  const webPid = webProc ? webProc.pid : null;
  
  // 1. 温和终止记录的子进程句柄
  if (workerProc && !workerProc.killed) {
    try { workerProc.kill(); } catch (e) {}
  }
  if (webProc && !webProc.killed) {
    try { webProc.kill(); } catch (e) {}
  }
  
  // 2. 强力杀死子进程树（包括其产生的所有衍生进程）
  if (workerPid) killProcessTree(workerPid);
  if (webPid) killProcessTree(webPid);
  
  workerProc = null;
  webProc = null;
  
  // 3. 销毁托盘
  if (tray) {
    try { tray.destroy(); } catch (e) {}
    tray = null;
  }

  // 4. 销毁所有打开的窗口
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      try { w.destroy(); } catch (e) {}
    });
  } catch (e) {}
  
  // 5. 释放端口 3001 占用
  killPortOwner(PORT);

  // 6. 深度精准清理：所有属于 FurinaKit 的 python/pythonw/node/electron 残留子进程
  killFurinaKitProcesses();
  
  console.log('[FurinaKit] 所有进程与后台服务已彻底清理完毕');
}

// ============ 创建窗口 ============
function createWindow() {
  const appIcon = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 750,
    minWidth: 1000,
    minHeight: 620,
    title: 'FurinaKit 芙宁娜工具箱',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : appIcon,
    backgroundColor: '#0f172a',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (appIcon && !appIcon.isEmpty()) {
    try {
      mainWindow.setIcon(appIcon);
    } catch (e) {}
  }

  // 加载页面
  mainWindow.loadURL(URL);

  // 页面加载完成后显示窗口
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
  });

  // 防止服务没起来时窗口永远不显示：兜底强制显示
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }, 5000);

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 内部服务地址不甩到外部浏览器（下载/导航应由应用内处理）
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return { action: 'deny' };
    }
    // 真正的外部链接才用系统默认浏览器打开
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 严格拦截主窗口意外跳转：确保主窗口永远停留在 SPA 界面，
  // 彻底防止点击音视频链接、下载接口或外部网页把整个软件窗口冲成视频播放器或外部页面
  mainWindow.webContents.on('will-navigate', (e, reqUrl) => {
    // 允许本地 Next.js 应用内的客户端路由跳转
    if (reqUrl.startsWith(URL)) {
      // 如果跳转到下载接口或音视频文件，坚决阻止页面级刷新导航，交由后台下载逻辑
      if ((reqUrl.includes('/api/jobs/') && reqUrl.includes('/download')) || /\.(mp4|mp3|m4a|mkv|webm|flv|avi)(\?.*)?$/i.test(reqUrl)) {
        e.preventDefault();
        return;
      }
      return;
    }
    // 其它非应用内页面（blob:、外部链接、文件协议等）一律拦截
    e.preventDefault();
    if (reqUrl.startsWith('http://') || reqUrl.startsWith('https://')) {
      shell.openExternal(reqUrl);
    }
  });

  // 关闭时根据用户设置：最小化到托盘或彻底退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      if (shouldCloseToTray()) {
        e.preventDefault();
        mainWindow.hide();
        notifyTrayOnce();
      } else {
        isQuitting = true;
        stopAll();
        app.exit(0);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 把"最大化状态变化"实时推给渲染进程，让顶部按钮图标和首页卡片列数能同步切换
  const pushMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', pushMaximizedState);
  mainWindow.on('unmaximize', pushMaximizedState);
}

// 渲染进程启动时问一次当前是否处于最大化（避免事件竞态）
ipcMain.handle('window:is-maximized', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isMaximized();
});

// ============ 窗口控制 IPC（供 preload 暴露的 furinakit.minimize/toggleMaximize/close 调用） ============
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => {
  if (!isQuitting) {
    if (shouldCloseToTray()) {
      if (mainWindow) mainWindow.hide();
      notifyTrayOnce();
    } else {
      isQuitting = true;
      stopAll();
      app.exit(0);
    }
  }
});
ipcMain.on('set-theme', (_e, theme) => {
  try {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  } catch (err) {}
});

// ============ 设置相关 IPC ============
// 选择文件夹对话框
ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择输出目录',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 应用设置（开机自启、输出目录等）
ipcMain.handle('apply-settings', async (_event, settings) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const settingsFile = SETTINGS_FILE;
    
    // 读取现有设置
    let existingSettings = {};
    try {
      if (fs.existsSync(settingsFile)) {
        existingSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      }
    } catch (e) {
      // 忽略读取错误
    }
    
    // 合并新设置
    const mergedSettings = { ...existingSettings, ...settings };
    
    // 确保目录存在
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    // 写入配置文件
    fs.writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2), 'utf-8');
    
    // 设置开机自启
    if (settings && typeof settings.autoStart === 'boolean') {
      app.setLoginItemSettings({
        openAtLogin: settings.autoStart,
        path: process.execPath,
      });
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 打开文件夹（在资源管理器中显示）
ipcMain.handle('open-path', async (_event, targetPath) => {
  try {
    if (!targetPath) {
      return { success: false, error: '路径为空' };
    }
    const fs = require('fs');
    const path = require('path');
    
    // 如果是文件，打开它所在的文件夹并选中文件
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      shell.showItemInFolder(targetPath);
      return { success: true };
    }
    
    // 如果是文件夹，直接打开
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      await shell.openPath(targetPath);
      return { success: true };
    }
    
    // 如果路径不存在，尝试打开它的父目录
    const parentDir = path.dirname(targetPath);
    if (fs.existsSync(parentDir)) {
      await shell.openPath(parentDir);
      return { success: true, openedParent: true };
    }
    
    return { success: false, error: '路径不存在' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 在系统默认浏览器中打开外部链接
ipcMain.handle('open-external', async (_event, targetUrl) => {
  try {
    if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
      shell.openExternal(targetUrl);
      return { success: true };
    }
    return { success: false, error: '链接无效' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============ 在线更新与一键自动安装 IPC ============
// 下载安装包到系统临时目录，支持多级 HTTP/HTTPS 302 重定向与进度广播
ipcMain.handle('download-update', async (_event, downloadUrl) => {
  return new Promise((resolve) => {
    try {
      if (!downloadUrl) {
        return resolve({ success: false, error: '下载链接为空' });
      }

      const https = require('https');
      const http = require('http');
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const { URL } = require('url');

      const tempDir = app.getPath('temp') || os.tmpdir();
      const targetFilePath = path.join(tempDir, 'FurinaKit-Setup-Update.exe');

      try {
        if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath);
      } catch (e) {}

      const fileStream = fs.createWriteStream(targetFilePath);

      function downloadFromUrl(currentUrl, maxRedirects = 6) {
        if (maxRedirects <= 0) {
          fileStream.close();
          return resolve({ success: false, error: '重定向层级过多' });
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(currentUrl);
        } catch (e) {
          fileStream.close();
          return resolve({ success: false, error: '无效的下载 URL' });
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const req = protocol.get(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FurinaKit-Updater',
          },
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, currentUrl).href;
            return downloadFromUrl(redirectUrl, maxRedirects - 1);
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            return resolve({ success: false, error: `下载失败，服务器响应: HTTP ${res.statusCode}` });
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          let lastReportPercent = -1;

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.min(100, Math.floor((receivedBytes / totalBytes) * 100));
              if (percent !== lastReportPercent) {
                lastReportPercent = percent;
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('update-download-progress', {
                    percent,
                    receivedBytes,
                    totalBytes,
                  });
                }
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              resolve({ success: true, filePath: targetFilePath });
            });
          });
        });

        req.on('error', (err) => {
          fileStream.close();
          try { if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath); } catch (e) {}
          resolve({ success: false, error: err.message });
        });
      }

      downloadFromUrl(downloadUrl);
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// 拉起下载好的安装包，并优雅退出当前运行的软件
ipcMain.handle('install-update', async (_event, filePath) => {
  try {
    const fs = require('fs');
    const { spawn } = require('child_process');
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '未找到下载的更新安装包' };
    }

    // 启动外部安装程序进程
    const child = spawn(filePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    // 立即终止当前所有子服务并退出应用
    isQuitting = true;
    stopAll();
    setTimeout(() => {
      app.exit(0);
    }, 400);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============ ARCHPR 压缩包密码恢复相关 IPC ============
ipcMain.handle('launch-archpr', async () => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    
    // 候选路径：FurinaKit 内置 tools/archpr 或 E盘安装目录
    const candidates = [
      path.join(ROOT, 'tools', 'archpr', 'ARCHPR.exe'),
      IS_PACKAGED ? path.join(RESOURCES_DIR, 'tools', 'archpr', 'ARCHPR.exe') : '',
      'E:\\Elcomsoft Password Recovery\\Advanced Archive Password Recovery\\ARCHPR.exe',
      'C:\\Program Files (x86)\\Elcomsoft Password Recovery\\Advanced Archive Password Recovery\\ARCHPR.exe',
    ].filter(Boolean);

    for (const exe of candidates) {
      if (fs.existsSync(exe)) {
        const child = spawn(exe, [], {
          cwd: path.dirname(exe),
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { success: true, path: exe };
      }
    }
    return { success: false, error: '未找到 ARCHPR 压缩包密码恢复程序' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-archpr-dir', async () => {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(ROOT, 'tools', 'archpr'),
      IS_PACKAGED ? path.join(RESOURCES_DIR, 'tools', 'archpr') : '',
      'E:\\Elcomsoft Password Recovery\\Advanced Archive Password Recovery',
    ].filter(Boolean);

    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        await shell.openPath(dir);
        return { success: true, path: dir };
      }
    }
    return { success: false, error: '未找到 ARCHPR 目录' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============ datatool.vip 嵌入已重构为原生 DOM 内置 <webview>，废弃易遮挡弹窗的 BrowserView ============
ipcMain.handle('datatool-show', async () => ({ success: true }));
ipcMain.handle('datatool-hide', async () => ({ success: true }));
ipcMain.handle('datatool-setBounds', async () => ({ success: true }));
ipcMain.handle('datatool-reload', async () => ({ success: true }));
ipcMain.handle('datatool-getStatus', async () => ({ success: true, isLoading: false }));

// ============ 全平台视频下载（datatool.vip 嵌入窗口） ============
let datatoolWindow = null;

ipcMain.handle('open-datatool', async () => {
  try {
    if (datatoolWindow && !datatoolWindow.isDestroyed()) {
      datatoolWindow.show();
      datatoolWindow.focus();
      return { success: true, existing: true };
    }

    datatoolWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: '全平台视频下载 - FurinaKit',
      icon: nativeImage.createFromPath(ICON_PATH),
      backgroundColor: '#ffffff',
      frame: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:datatool',
      },
    });

    datatoolWindow.loadURL('https://www.datatool.vip/zh');

    datatoolWindow.webContents.on('did-finish-load', () => {
      if (datatoolWindow && !datatoolWindow.isDestroyed()) {
        datatoolWindow.show();
      }
    });

    setTimeout(() => {
      if (datatoolWindow && !datatoolWindow.isDestroyed()) datatoolWindow.show();
    }, 5000);

    datatoolWindow.webContents.setWindowOpenHandler(() => {
      return { action: 'allow' };
    });

    datatoolWindow.on('closed', () => {
      datatoolWindow = null;
    });

    return { success: true, existing: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// ============ 系统托盘 ============
function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip('FurinaKit 芙宁娜工具箱');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出软件',
      click: () => {
        console.log('[FurinaKit] 用户从系统托盘点击彻底退出');
        isQuitting = true;
        stopAll();
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ============ App 生命周期 ============
app.whenReady().then(async () => {
  console.log('[FurinaKit] Electron 已启动');

  // ============ 配置 datatool partition 的 session（解决 webview 经常打不开的问题） ============
  try {
    const datatoolSession = session.fromPartition('persist:datatool');
    // 设置 Chrome 的 User-Agent，避免网站反爬
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    datatoolSession.setUserAgent(chromeUA);
    console.log('[FurinaKit] datatool session User-Agent 已设置');
    
    // 如果系统有代理，也配置到这个 session
    if (SYSTEM_PROXY) {
      const proxyUrl = SYSTEM_PROXY.startsWith('http') ? SYSTEM_PROXY : 'http://' + SYSTEM_PROXY;
      datatoolSession.setProxy({ proxyRules: proxyUrl });
      console.log('[FurinaKit] datatool session 代理已设置:', proxyUrl);
    }
  } catch (err) {
    console.log('[FurinaKit] datatool session 配置失败:', err.message);
  }

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  // ============ 下载处理：点下载时弹"另存为"，不再跳转外部浏览器 ============
  const handleDownload = (_event, item) => {
    try {
      const suggested = item.getFilename() || 'download';
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const result = dialog.showSaveDialogSync(win, {
        title: '保存文件',
        defaultPath: suggested,
      });
      if (result) {
        item.setSavePath(result);
      } else {
        // 用户在保存对话框点了取消，直接中止下载
        item.cancel();
        return;
      }
      // 下载意外中断时取消，避免残留半成品文件
      item.once('done', (_e, state) => {
        if (state === 'interrupted') item.cancel();
      });
    } catch (err) {
      console.log('[FurinaKit] 下载处理异常:', err.message);
    }
  };

  session.defaultSession.on('will-download', handleDownload);
  try {
    session.fromPartition('persist:datatool').on('will-download', handleDownload);
  } catch (e) {}

  // ============ 网络层劫持：将所有直接导航的音视频流强制转为 attachment 下载 ============
  // 核心防止用户点击音视频下载链接或直链时，Chromium 将其当作 MediaDocument 直接在窗口内全屏播放
  const forceDownloadDisposition = (details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    const ctHeader = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'content-type');
    const contentType = (ctHeader && responseHeaders[ctHeader] ? responseHeaders[ctHeader][0] : '').toLowerCase();
    
    // 仅针对顶层框架或子框架页面级导航 (mainFrame / subFrame)：
    // 如果返回的是音视频内容，且非应用内置 <video>/<audio> 标签发起的媒体流 (resourceType !== 'media')
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      const isMedia = contentType.startsWith('video/') ||
                      contentType.startsWith('audio/') ||
                      contentType === 'application/octet-stream' ||
                      /\.(mp4|mp3|m4a|mkv|webm|flv|avi)(\?.*)?$/i.test(details.url);
      if (isMedia) {
        responseHeaders['Content-Disposition'] = ['attachment'];
        responseHeaders['content-disposition'] = ['attachment'];
      }
    }
    callback({ responseHeaders });
  };

  session.defaultSession.webRequest.onHeadersReceived(forceDownloadDisposition);
  try {
    session.fromPartition('persist:datatool').webRequest.onHeadersReceived(forceDownloadDisposition);
  } catch (e) {}

  // 监听所有创建的 webview 内容，防止 webview 内部直接播放音视频
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      contents.on('will-navigate', (e, navUrl) => {
        if (/\.(mp4|mp3|m4a|mkv|webm|flv|avi)(\?.*)?$/i.test(navUrl)) {
          e.preventDefault();
          shell.openExternal(navUrl);
        }
      });
      contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          shell.openExternal(url);
        }
        return { action: 'deny' };
      });
    }
  });

  // 设置应用图标
  if (process.platform === 'win32') {
    app.setAppUserModelId('furinakit.desktop.app');
  }

  // 启动服务
  startWorker();
  await new Promise((r) => setTimeout(r, 1500));
  await startWebServer();

  // 等待服务就绪
  console.log('[FurinaKit] 等待服务就绪...');
  const ready = await waitForService(40);
  if (!ready) {
    console.log('[FurinaKit] 警告：服务启动超时，仍尝试打开窗口');
  }

  // 创建窗口和托盘
  createWindow();
  createTray();
  checkAndReportInstall();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 不退出，保持托盘运行
  }
});

// 退出前清理
app.on('before-quit', () => {
  console.log('[FurinaKit] 应用即将退出...');
  isQuitting = true;
  stopAll();
});

// 确保退出时所有窗口和后台服务都彻底清理
app.on('will-quit', () => {
  console.log('[FurinaKit] 应用将退出，执行最终清理...');
  stopAll();
});

