## 下载

- **安装版（推荐）**：[国内加速下载](https://gh-proxy.com/https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.1/FurinaKit.Setup.2.1.1.exe) · [备用加速](https://ghfast.top/https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.1/FurinaKit.Setup.2.1.1.exe) · [GitHub 原始文件](https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.1/FurinaKit.Setup.2.1.1.exe)，约 120.5 MiB。
- **便携版**：[国内加速下载](https://gh-proxy.com/https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.1/FurinaKit-v2.1.1-windows-x64.zip) · [GitHub 原始文件](https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.1/FurinaKit-v2.1.1-windows-x64.zip)，约 150.3 MiB。解压完整目录后运行 FurinaKit.exe。
- Windows 10 / 11 x64。基础音视频引擎、OCR 和轻量超分资源随包提供；可选 AI 模型仍按需下载。

## 本次更新

- 新增 **抽卡记录分析与分享**：支持原神、崩坏：星穹铁道、绝区零、鸣潮（国服），展示垫抽、平均出金、UP 平均花费、小保底不歪率，支持 UIGF / SRGF 导入导出和长图分享。
- 抽卡页面重新整理：卡池筛选与搜索、排序、统计入口放在同一行；单栏 / 双栏随时切换，右栏可选择、更换卡池。正在获取记录时显示旋转图标。
- 完善多通行证与角色存档：昵称旁下拉切换已提取账号，更新时核对目标 UID；授权缺失或过期时提示重新扫码或读取记录。重做授权界面，统一圆角下拉菜单。
- 修复长图保存与输出目录定位不一致，保存后显示文件名并可定位图片。
- 新增 **HTML 转 PDF / 图片**，支持原图提取、PDF 合成及网页导出。
- 应用内更新改为后台安装并自动重新打开，兼容旧版更新安装包的无参数启动；修复镜像切换时地址嵌套和下载校验失败的处理。
- 下载工具支持暂停 / 继续；修复艺术签名生成、图片混淆还原格式、B 站短链接及竖屏视频解析。

[查看抽卡界面和完整工具介绍](https://github.com/FUFU-eng/FurinaKit#-界面预览)，README 中使用实际记录截图，UID 已打码。

## 升级

本次发布完整安装包与便携包，**不提供增量补丁**。完整包可同时覆盖旧版 Electron 与 Tauri 安装，避免旧资源缺失。

- **2.0.3–2.1.0 已安装版**：从应用内检查更新、下载并安装，安装包在后台完成并重新打开，不弹出安装向导。更新会等待旧程序退出，仅处理当前安装目录的程序；设置、收藏和抽卡存档保留。已删除的桌面快捷方式不会被重新创建。
- **2.0.2 及更早**：2.0.2 指向的旧更新仓库已失效，2.0.1 没有更新入口，请从上述链接手动下载完整安装包。便携版和安装登记缺失的情况也请手动安装。
- 手动双击下载的安装包仍显示正常安装向导。升级前请完成正在进行的任务，并从托盘退出旧版。
- 旧 Electron 若为“所有用户”安装，静默更新会为当前用户安装新版，不要求管理员授权；共享旧程序保留，可另行卸载。

国内下载沿用上一版的 gh-proxy 加速线路，提供 ghfast 备用线路。应用更新清单也提供国内镜像回退。

## 校验与测试范围

安装包和便携包内含 348 个文件，装配时逐项校验资源哈希；上传后核对 GitHub 返回的 SHA-256。下载校验值见 SHA256SUMS.txt，详细验证范围见 RELEASE-VERIFICATION.md。

已完成前端类型检查、生产构建、抽卡分析前后端回归、下载完整性与镜像回退测试，以及隔离目录中的三组静默安装测试（2.1.0 / 2.0.6 旧入口与新版入口）。测试确认无安装器窗口、自动重启、测试数据保留、桌面快捷方式删除偏好保留。Electron 卸载调用在隔离测试中使用桩程序，未进行全新 Windows 环境验收；实际旧版凭据、已登录账号不会随发布包上传。

按需模型目录沿用 2.1.0 的已校验下载清单，未重新下载全部模型。源码构建资源也沿用固定版本 [FurinaKit.BuildResources.2.1.0.zip](https://github.com/FUFU-eng/FurinaKit/releases/download/v2.1.0/FurinaKit.BuildResources.2.1.0.zip)，已有音视频引擎在本次完整包中直接内置。

## 隐私

离线文件任务在本机处理。抽卡记录与通行证授权在本机保存，授权凭据使用 Windows DPAPI 加密；主动获取官方记录时联网。截图分享前请自行检查账号信息。工具箱本体为 MIT 开源；第三方资源遵循各自许可，ARCHPR 无授权环境为 Trial，不包含激活信息。
