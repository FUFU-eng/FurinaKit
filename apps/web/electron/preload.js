// FurinaKit 预加载脚本
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('furinakit', {
  // 最小化窗口
  minimize: () => ipcRenderer.send('window-minimize'),
  // 最大化/还原
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  // 关闭窗口（最小化到托盘）
  close: () => ipcRenderer.send('window-close'),
  // 同步原生主题（暗色/浅色，避免OS层闪白）
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  // 订阅最大化状态变化（返回取消订阅函数）
  onMaximizedChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, maximized) => {
      try {
        callback(Boolean(maximized));
      } catch (err) {
        console.error('[furinakit] onMaximizedChange callback error:', err);
      }
    };
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
  // 启动时问一次当前是否处于最大化
  getIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // 获取平台信息
  platform: process.platform,
  // 是否为 Electron 环境
  isElectron: true,
  // 选择文件夹对话框
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  // 应用设置
  applySettings: (settings) => ipcRenderer.invoke('apply-settings', settings),
  // 打开文件夹（在资源管理器中显示）
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  // 打开全平台视频下载窗口（datatool.vip）
  openDatatool: () => ipcRenderer.invoke('open-datatool'),
  // ============ BrowserView：datatool.vip 嵌入（比 webview 更稳定） ============
  // 显示 datatool BrowserView
  datatoolShow: (bounds) => ipcRenderer.invoke('datatool-show', bounds),
  // 隐藏 datatool BrowserView
  datatoolHide: () => ipcRenderer.invoke('datatool-hide'),
  // 调整 datatool BrowserView 位置和大小
  datatoolSetBounds: (bounds) => ipcRenderer.invoke('datatool-setBounds', bounds),
  // 刷新 datatool BrowserView
  datatoolReload: () => ipcRenderer.invoke('datatool-reload'),
  // 获取加载状态
  datatoolGetStatus: () => ipcRenderer.invoke('datatool-getStatus'),
  // ============ ARCHPR 压缩包密码破解 ============
  launchArchpr: () => ipcRenderer.invoke('launch-archpr'),
  openArchprDir: () => ipcRenderer.invoke('open-archpr-dir'),
  // ============ 在线版本检测与一键更新 ============
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  onUpdateDownloadProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },
  installUpdate: (filePath) => ipcRenderer.invoke('install-update', filePath),
});
