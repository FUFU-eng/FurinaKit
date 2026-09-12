#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FurinaKit 双轨版本构建与发布工具
支持一键同时构建：
1. 完整全量安装包 (FurinaKit.Setup.X.X.X.exe, ~570MB, 供新用户安装)
2. 极速增量升级补丁 (FurinaKit.Patch.X.X.X.exe, ~15MB, 供老用户几秒极速升级)
3. 自动生成与更新 dual-package version.json
"""

import os
import sys
import json
import shutil
import base64
import hashlib
import argparse
import re
import subprocess
import zipfile
from datetime import datetime

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_DIR = os.path.join(ROOT_DIR, "apps", "web")
RELEASE_OUTPUT_DIR = os.path.join(ROOT_DIR, "dist-release")
STAGING_DIR = os.path.join(ROOT_DIR, "patch_staging")

# electron-builder 的完整产物目录。补丁的资源文件必须全部从这里取，
# 保证「增量补丁」与「完整安装包」的内容永远一致、不会各自漂移。
PACKAGED_RES_DIR = os.path.join(WEB_DIR, "dist-installer", "win-unpacked", "resources")
WORKER_SRC_DIR = os.path.join(ROOT_DIR, "services", "worker")
WORKER_BUILD_EXE = os.path.join(WORKER_SRC_DIR, "dist", "furinakit-worker.exe")
WORKER_EXE_NAME = "furinakit-worker.exe"

# 补丁要携带的运行时组件，每项为 (文件名, 在没有历史清单时是否必须下发)：
#
#   - furinakit-worker.exe 里装着全部 Python 侧业务逻辑（PDF / 音视频 / 抠图 / 超分…）。
#     「没有历史清单」意味着无法确认用户手上是不是旧引擎，因此必须下发 ——
#     否则就会重演 2.0.5 的事故：修复只存在于源码里，走一键升级的用户永远拿不到。
#   - 其余是体积很大、由第三方提供、极少变化的组件。内容变了才下发，避免补丁无谓膨胀；
#     没有历史清单时按「用户本机已存在」处理（它们都随完整安装包分发过）。
RUNTIME_FILES = [
    (WORKER_EXE_NAME, True),
    ("ffmpeg.exe", False),
    ("node.exe", False),
    ("yt-dlp.exe", False),
    ("aria2c.exe", False),
    ("furinakit.ico", False),
]

# 目录型运行时资源（超分引擎与模型），每项为 (目录名, 没有历史清单时是否必须下发)：
#
#   - upscale/ 必须为 True。这是 2.0.6 修掉的一个真实事故：
#     该目录直到 v2.0.5 才被写进 electron-builder 的 extraResources，也就是说
#     v2.0.1~v2.0.4 的**完整安装包从来不含超分引擎**；而 v2.0.5 只发过增量补丁、没发完整包，
#     补丁又按「没有历史清单就认为本机已存在」跳过它 —— 两头一凑，所有从 2.0.4 及更早
#     一键升级上来的用户，本机根本没有 resources/upscale，于是「图片强化」永远报
#     「超分引擎缺失」，只有开发机（直接用仓库里的 services/worker/upscale）能用。
#     目录型资源的判定只能靠构建机上的历史清单，无法知道用户本机的真实情况，
#     所以拿不准时一律下发；重复下发只是覆盖同名文件，成本是补丁大几十 MB，不会出问题。
RUNTIME_DIRS = [
    ("upscale", True),
]

# 记录上一次发布时各运行时文件的哈希，用于判断「是否需要随补丁下发」
RUNTIME_MANIFEST = os.path.join(ROOT_DIR, ".release-runtime-manifest.json")


def sha256_file(path, chunk_size=1 << 20):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk_size), b""):
            digest.update(block)
    return digest.hexdigest()


def load_runtime_manifest():
    if os.path.isfile(RUNTIME_MANIFEST):
        try:
            with open(RUNTIME_MANIFEST, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_runtime_manifest(data):
    with open(RUNTIME_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)


def sha256_dir(path):
    """对目录内容做哈希（文件名 + 内容），用于判断该目录是否需要随补丁下发"""
    digest = hashlib.sha256()
    for current, dirs, files in os.walk(path):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(current, name)
            rel = os.path.relpath(full, path).replace("\\", "/")
            digest.update(rel.encode("utf-8"))
            try:
                with open(full, "rb") as f:
                    for block in iter(lambda: f.read(1 << 20), b""):
                        digest.update(block)
            except OSError:
                digest.update(b"<unreadable>")
    return digest.hexdigest()


def record_runtime_manifest(manifest):
    """把本次发布实际携带的运行时组件哈希落盘，供下一次发布比较。

    只在补丁成功产出之后调用。若发布中途失败就提前写入，下一次会误判为「没有变化」
    从而漏发组件 —— 这正是我们要避免的事故类型。
    """
    save_runtime_manifest(manifest)
    print(f"   已记录运行时组件清单: {RUNTIME_MANIFEST}")


def newest_worker_source_mtime():
    """services/worker 源码树里最新的修改时间（排除虚拟环境与构建产物）"""
    skip_dirs = {".venv", "venv", "dist", "build", "__pycache__", "upscale"}
    skip_suffix = (".pyc", ".log")
    newest = 0.0
    for current, dirs, files in os.walk(WORKER_SRC_DIR):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if name.endswith(skip_suffix) or name == ".env":
                continue
            try:
                newest = max(newest, os.path.getmtime(os.path.join(current, name)))
            except OSError:
                pass
    return newest


def verify_worker_is_fresh():
    """发布前守门：确认补丁将要携带的 worker 确实是由当前源码编译出来的。

    存在的意义：2.0.5 的「图片转 PDF 体积异常」修复只改在 services/worker/app/tools/pdf_tools.py，
    而增量补丁不含 furinakit-worker.exe，导致走一键升级的用户装完仍是旧引擎、
    问题看起来「根本没修」。这里用三道检查把这类事故挡在发布之前。
    """
    packaged_worker = os.path.join(PACKAGED_RES_DIR, WORKER_EXE_NAME)

    # 检查 1：完整产物里必须有 worker
    if not os.path.isfile(packaged_worker):
        print(f"[错误] 完整打包产物中找不到 {WORKER_EXE_NAME}：{packaged_worker}")
        print("       请先执行 `pnpm --filter @furinakit/web dist` 生成完整产物后再发布。")
        return False

    # 检查 2：完整产物里的 worker 必须与最新编译产物完全一致（防止 dist 没重跑，补丁发出去的是旧引擎）
    if os.path.isfile(WORKER_BUILD_EXE):
        built_hash = sha256_file(WORKER_BUILD_EXE)
        packaged_hash = sha256_file(packaged_worker)
        if built_hash != packaged_hash:
            print("[错误] 完整打包产物中的 worker 与最新编译产物不一致！")
            print(f"       最新编译产物: {WORKER_BUILD_EXE}  sha256={built_hash[:16]}…")
            print(f"       完整打包产物: {packaged_worker}  sha256={packaged_hash[:16]}…")
            print("       说明 worker 重新编译过但完整安装包没有重新打包，")
            print("       请重新执行完整打包（不要加 --patch-only），否则补丁与安装包会不一致。")
            return False

    # 检查 3：worker 源码不得比已编译的 worker 更新（防止改了 Python 但忘了重新编译）
    worker_mtime = os.path.getmtime(packaged_worker)
    source_mtime = newest_worker_source_mtime()
    if source_mtime > worker_mtime:
        print("[错误] services/worker 源码比已编译的 worker 更新，补丁会发出旧引擎！")
        print(f"       worker 编译时间: {datetime.fromtimestamp(worker_mtime):%Y-%m-%d %H:%M:%S}")
        print(f"       最新源码修改时间: {datetime.fromtimestamp(source_mtime):%Y-%m-%d %H:%M:%S}")
        print("       请先重新编译 worker（pyinstaller furinakit-worker.spec）并重新完整打包。")
        return False

    print(f"   worker 校验通过：{WORKER_EXE_NAME} sha256={sha256_file(packaged_worker)[:16]}…")
    return True

def find_makensis():
    """自动寻找系统或 electron-builder 缓存中的 makensis.exe"""
    candidates = [
        r"C:\Users\syy\AppData\Local\electron-builder\Cache\nsis-3.0.4.1\nsis-3.0.4.1-1mx3n\Bin\makensis.exe",
        shutil.which("makensis") or "",
        r"C:\Program Files (x86)\NSIS\makensis.exe",
        r"C:\Program Files\NSIS\makensis.exe",
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    
    # 扫描 electron-builder 缓存目录
    eb_cache = os.path.expanduser(r"~\AppData\Local\electron-builder\Cache")
    if os.path.isdir(eb_cache):
        for root, _, files in os.walk(eb_cache):
            if "makensis.exe" in files:
                return os.path.join(root, "makensis.exe")
    return None

def get_current_version():
    """从 apps/web/package.json 读取当前版本号"""
    pkg_path = os.path.join(WEB_DIR, "package.json")
    with open(pkg_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("version", "2.0.4")

def build_web_app():
    """构建 Next.js 与前端资源"""
    print("\n[1/4] 正在构建前端与 Electron 产物 (pnpm build)...")
    res = subprocess.run(["pnpm.cmd", "--filter", "@furinakit/web", "build"], cwd=ROOT_DIR)
    if res.returncode != 0:
        print("[错误] 前端构建失败，终止发布流程！")
        sys.exit(1)
    print("前端构建完成！")

def build_full_installer(version):
    """打包完整全量安装包 (~570MB)"""
    print(f"\n[2/4] 正在构建全量安装包 FurinaKit Setup {version}.exe...")
    res = subprocess.run(["pnpm.cmd", "--filter", "@furinakit/web", "dist"], cwd=ROOT_DIR)
    if res.returncode != 0:
        print("[错误] electron-builder 打包失败！")
        sys.exit(1)

    os.makedirs(RELEASE_OUTPUT_DIR, exist_ok=True)
    dist_inst = os.path.join(WEB_DIR, "dist-installer")
    src_exe = os.path.join(dist_inst, f"FurinaKit Setup {version}.exe")
    target_exe = os.path.join(RELEASE_OUTPUT_DIR, f"FurinaKit.Setup.{version}.exe")

    if os.path.isfile(src_exe):
        shutil.copy2(src_exe, target_exe)
        size_mb = os.path.getsize(target_exe) / (1024 * 1024)
        print(f"全量安装包构建成功: {target_exe} ({size_mb:.1f} MB)")
        return target_exe, f"约 {int(round(size_mb))} MB"
    else:
        print(f"[警告] 未在 {dist_inst} 找到期望的安装包产物: {src_exe}")
        return None, "约 570 MB"

def build_incremental_patch(version, makensis_path):
    """打包极速增量升级补丁"""
    print(f"\n[3/4] 正在构建极速增量补丁 FurinaKit.Patch.{version}.exe...")

    # 0. 发布前守门：绝不允许再打出「缺少后端引擎」的补丁
    if not verify_worker_is_fresh():
        print("[中止] 补丁构建已停止，请按上面的提示处理后重新发布。")
        return None, None, "未知"

    os.makedirs(RELEASE_OUTPUT_DIR, exist_ok=True)

    # 1. 准备 staging 目录
    if os.path.exists(STAGING_DIR):
        shutil.rmtree(STAGING_DIR)

    staging_app = os.path.join(STAGING_DIR, "resources", "app")
    staging_res = os.path.join(STAGING_DIR, "resources")
    os.makedirs(staging_app, exist_ok=True)
    os.makedirs(staging_res, exist_ok=True)

    # 复制核心变动目录：.next、electron、public、package.json
    shutil.copytree(
        os.path.join(WEB_DIR, ".next"),
        os.path.join(staging_app, ".next"),
        ignore=shutil.ignore_patterns("cache")
    )
    shutil.copytree(os.path.join(WEB_DIR, "electron"), os.path.join(staging_app, "electron"))
    shutil.copytree(os.path.join(WEB_DIR, "public"), os.path.join(staging_app, "public"))
    shutil.copy2(os.path.join(WEB_DIR, "package.json"), os.path.join(staging_app, "package.json"))

    # 复制 sharp 原生二进制包
    unpacked_img = os.path.join(PACKAGED_RES_DIR, "app", "node_modules", "@img")
    if os.path.isdir(unpacked_img):
        shutil.copytree(unpacked_img, os.path.join(staging_app, "node_modules", "@img"))

    # ── 运行时组件：必须从完整打包产物取，保证补丁与安装包内容一致 ──
    previous_manifest = load_runtime_manifest()
    staged_runtime_files = []
    staged_dirs = []
    shipped_manifest = dict(previous_manifest)

    for name, ship_when_unknown in RUNTIME_FILES:
        src = os.path.join(PACKAGED_RES_DIR, name)
        if not os.path.isfile(src):
            if name == WORKER_EXE_NAME:
                print(f"[错误] 补丁必须携带 {name}，但完整打包产物中不存在：{src}")
                print("       终止发布，避免再次发出「缺少后端引擎」的补丁。")
                return None, None, "未知"
            continue

        digest = sha256_file(src)
        known = previous_manifest.get(name)

        if known is None and not ship_when_unknown:
            print(f"   - {name} 无历史清单，按「本机已存在」处理，本次不下发（已记录哈希）")
            shipped_manifest[name] = digest
            continue
        if known == digest:
            print(f"   - {name} 与上次发布一致，跳过（补丁瘦身）")
            continue

        shutil.copy2(src, os.path.join(staging_res, name))
        staged_runtime_files.append(name)
        shipped_manifest[name] = digest
        size_mb = os.path.getsize(src) / 1048576
        why = "内容已变化" if known else "状态未知，必须下发"
        print(f"   - 随补丁下发 {name}（{size_mb:.1f} MB，{why}）")

    for dir_name, ship_when_unknown in RUNTIME_DIRS:
        src = os.path.join(PACKAGED_RES_DIR, dir_name)
        if not os.path.isdir(src):
            src = os.path.join(WORKER_SRC_DIR, dir_name)
        if not os.path.isdir(src):
            print(f"   [警告] 找不到目录 {dir_name}，本次不下发（完整产物与 worker 源码目录都没有）")
            continue

        digest = sha256_dir(src)
        key = dir_name + "/"
        known = previous_manifest.get(key)
        dir_mb = sum(
            os.path.getsize(os.path.join(cur, f))
            for cur, _, files in os.walk(src)
            for f in files
        ) / 1048576

        if known is None and not ship_when_unknown:
            print(f"   - {dir_name}/ 无历史清单，按「本机已存在」处理，本次不下发（已记录哈希）")
            shipped_manifest[key] = digest
            continue
        if known == digest:
            print(f"   - {dir_name}/ 与上次发布一致，跳过（补丁瘦身）")
            continue

        shutil.copytree(src, os.path.join(staging_res, dir_name), dirs_exist_ok=True)
        staged_dirs.append(dir_name)
        shipped_manifest[key] = digest
        why = "内容已变化" if known else "状态未知，必须下发（老版本用户的安装包里可能从来没有它）"
        print(f"   - 随补丁下发 {dir_name}/ 目录（{dir_mb:.1f} MB，{why}）")

    if staged_runtime_files or staged_dirs:
        print(f"   本次随补丁下发的运行时组件: {', '.join(staged_runtime_files)}"
              + (f" 目录: {', '.join(staged_dirs)}" if staged_dirs else ""))
    else:
        print("   本次补丁只包含前端代码改动（运行时组件均未变化），属正常情况。")

    # 2. 生成绿色解压升级 ZIP
    zip_out = os.path.join(RELEASE_OUTPUT_DIR, f"FurinaKit.Patch.{version}.zip")
    with zipfile.ZipFile(zip_out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(STAGING_DIR):
            for file in files:
                full = os.path.join(root, file)
                rel = os.path.relpath(full, STAGING_DIR)
                z.write(full, rel)
    zip_mb = os.path.getsize(zip_out) / (1024 * 1024)
    print(f"增量绿色补丁 ZIP 产出: {zip_out} ({zip_mb:.1f} MB)")

    # 3. 编译自动化 NSIS 安装补丁 EXE
    if not makensis_path or not os.path.isfile(makensis_path):
        print("[错误] 未找到 makensis.exe，无法编译 EXE 格式补丁！")
        return None, zip_out, f"约 {zip_mb:.1f} MB"

    nsi_path = os.path.join(ROOT_DIR, "patch_builder.nsi")
    patch_exe_out = os.path.join(RELEASE_OUTPUT_DIR, f"FurinaKit.Patch.{version}.exe")
    ico_path = os.path.join(ROOT_DIR, "furinakit.ico")

    # 依据「实际暂存了什么」生成 NSIS 部署指令，避免脚本硬编码清单再次漏文件
    runtime_deploy_lines = "\n".join(
        f'    File "{os.path.join(staging_res, name)}"' for name in staged_runtime_files
    )
    dir_deploy_lines = "\n".join(
        f'    SetOutPath "$INSTDIR\\resources\\{dir_name}"\n'
        f'    File /r "{os.path.join(staging_res, dir_name)}\\*.*"'
        for dir_name in staged_dirs
    )
    print(f"   本补丁将部署运行时组件: {', '.join(staged_runtime_files)}"
          + (f" 目录: {', '.join(staged_dirs)}" if staged_dirs else ""))

    # 只结束属于 FurinaKit 的 node 进程（Next.js 服务），而不是把全机器所有 node 程序一起杀掉。
    # 用 EncodedCommand（UTF-16LE + base64）传递脚本，可以完全避开 NSIS/PowerShell 的引号与
    # $ 转义问题——base64 里不含引号、花括号和 $，是最稳的做法。
    # 这一步必须真正生效：若残留的旧前端服务继续占着 3001 端口，新启动的客户端会「复用旧服务」，
    # 用户看到的就还是旧界面，表现为「补丁装了却没生效」。
    ps_kill_script = (
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Name -eq 'node.exe' -and "
        "($_.CommandLine -like '*FurinaKit*' -or $_.ExecutablePath -like '*FurinaKit*') } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    ps_kill_encoded = base64.b64encode(ps_kill_script.encode("utf-16-le")).decode("ascii")

    nsi_script = f"""!include "MUI2.nsh"
!include "FileFunc.nsh"

Unicode true
Name "FurinaKit 芙宁娜工具箱 v{version} 极速增量升级补丁"
OutFile "{patch_exe_out}"
Icon "{ico_path}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

InstallDir "$LOCALAPPDATA\\Programs\\FurinaKit"
InstallDirRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\furinakit" "InstallLocation"

!define MUI_ABORTWARNING
!define MUI_ICON "{ico_path}"
!define MUI_UNICON "{ico_path}"
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 FurinaKit v{version} 极速升级补丁"
!define MUI_WELCOMEPAGE_TEXT "本补丁包包含本次版本迭代的前端代码与后台处理引擎。$\\r$\\n$\\r$\\n★ 优势：$\\r$\\n1. 无需重新下载完整安装包，升级全程仅需数十秒$\\r$\\n2. 您的所有偏好设置、历史记录与已下载文件 100% 完整保留$\\r$\\n$\\r$\\n点击下一步即可开始自动部署。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "升级完成！"
!define MUI_FINISHPAGE_TEXT "FurinaKit 已顺利完成增量升级并已就绪。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\FurinaKit.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 FurinaKit 芙宁娜工具箱"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
    ; 0. 最可靠的一招：直接取当前正在运行的 FurinaKit 进程真实路径
    ;    （注册表 InstallLocation 在部分安装方式下为空，只靠注册表会找错目录）
    nsExec::ExecToStack 'powershell.exe -NoProfile -Command "(Get-Process FurinaKit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1)"'
    Pop $R0
    Pop $R1
    ${{GetParent}} "$R1" $R2
    ${{If}} $R2 != ""
    ${{AndIf}} ${{FileExists}} "$R2\\FurinaKit.exe"
        StrCpy $INSTDIR $R2
        Return
    ${{EndIf}}

    ; 1. 优先尝试读取安装注册表
    ReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\furinakit" "InstallLocation"
    ${{If}} $0 != ""
    ${{AndIf}} ${{FileExists}} "$0\\FurinaKit.exe"
        StrCpy $INSTDIR $0
        Return
    ${{EndIf}}

    ReadRegStr $1 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\furinakit" "UninstallString"
    ${{If}} $1 != ""
        ${{GetParent}} $1 $0
        StrCpy $2 $0 1 0
        ${{If}} $2 == '"'
            StrCpy $0 $0 "" 1
        ${{EndIf}}
        ${{If}} ${{FileExists}} "$0\\FurinaKit.exe"
            StrCpy $INSTDIR $0
            Return
        ${{EndIf}}
    ${{EndIf}}

    ; 常见路径探测
    ${{If}} ${{FileExists}} "$LOCALAPPDATA\\Programs\\FurinaKit\\FurinaKit.exe"
        StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\FurinaKit"
        Return
    ${{EndIf}}

    ${{If}} ${{FileExists}} "$PROGRAMFILES\\FurinaKit\\FurinaKit.exe"
        StrCpy $INSTDIR "$PROGRAMFILES\\FurinaKit"
        Return
    ${{EndIf}}
FunctionEnd

Section "UpdateFiles" SecUpdate
    DetailPrint "正在安全关闭后台服务与应用进程..."
    nsExec::Exec 'taskkill /F /IM FurinaKit.exe'
    nsExec::Exec 'taskkill /F /IM furinakit-worker.exe'
    ; 只结束属于 FurinaKit 的 node 进程（Next.js 服务），避免误杀用户其它 Node 程序。
    ; 这一步必须真正生效：若残留旧前端服务继续占用端口，新客户端会「复用旧服务」，
    ; 于是用户升级后看到的还是旧界面 —— 表现就是「补丁装了但没生效」。
    nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -EncodedCommand {ps_kill_encoded}'
    nsExec::Exec 'taskkill /F /IM aria2c.exe'
    Sleep 1200

    DetailPrint "正在极速部署核心应用模块..."
    SetOutPath "$INSTDIR\\resources\\app"
    File /r "{STAGING_DIR}\\resources\\app\\*.*"

    ; ↓↓↓ 以下清单由 scripts/package_release.py 按「实际暂存内容」自动生成 ↓↓↓
    ; furinakit-worker.exe 必须出现在这里：所有 Python 侧业务逻辑（PDF / 音视频 /
    ; 抠图 / 超分…）都封装在该文件中。历史上 2.0.5 的图片转 PDF 体积修复就是因为
    ; 这段漏掉了它，导致走一键升级的用户装完仍是旧引擎、问题看起来「根本没修」。
    DetailPrint "正在更新后台处理引擎与运行时组件..."
    SetOutPath "$INSTDIR\\resources"
{runtime_deploy_lines}

    DetailPrint "正在同步超分模型与驱动引擎..."
{dir_deploy_lines}

    DetailPrint "更新已全部就绪！"
SectionEnd
"""
    with open(nsi_path, "w", encoding="utf-8-sig") as f:
        f.write(nsi_script)

    res = subprocess.run([makensis_path, nsi_path], capture_output=True, text=True)
    if res.returncode != 0:
        print("[错误] Makensis 编译补丁程序失败：")
        print(res.stdout)
        print(res.stderr)
        return None, zip_out, f"约 {zip_mb:.1f} MB"

    patch_mb = os.path.getsize(patch_exe_out) / (1024 * 1024)
    print(f"极速增量补丁 EXE 产出: {patch_exe_out} ({patch_mb:.1f} MB)")
    print(f"   补丁清单: {', '.join(staged_runtime_files)}"
          + (f" + {', '.join(staged_dirs)}/" if staged_dirs else ""))
    # 补丁真正产出成功后才记账，避免发布失败后下次漏发组件
    record_runtime_manifest(shipped_manifest)
    return patch_exe_out, zip_out, f"约 {patch_mb:.1f} MB"

def extract_highlights_from_version_ts(version):
    """从 apps/web/src/lib/version.ts 的 APP_CHANGELOG 里取出这个版本的 highlights。

    为什么不沿用上一版 version.json 里的 changelog：那样会导致「新版本的更新说明永远是上一版的」
    —— 用户点「检查更新」看到的是上个版本的内容（2.0.6 的 version.json 里躺着 2.0.5 的更新点）。
    version.ts 里的 APP_CHANGELOG 才是软件内更新日志的唯一真源，这里直接读它，避免两边漂移。
    """
    ts_path = os.path.join(WEB_DIR, "src", "lib", "version.ts")
    if not os.path.isfile(ts_path):
        return []
    try:
        with open(ts_path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []

    # 定位 "version: \"x.y.z\"" 之后的第一个 highlights: [ ... ]
    anchor = re.search(r'version:\s*"%s"' % re.escape(version), text)
    if not anchor:
        return []
    tail = text[anchor.end():]
    block = re.search(r"highlights:\s*\[(.*?)\n\s*\],", tail, re.S)
    if not block:
        return []
    items = re.findall(r'"((?:[^"\\]|\\.)*)"', block.group(1))
    # 还原 TS 字符串里的转义（目前只有 \" 与 \\，保险起见都处理）
    return [i.replace('\\"', '"').replace("\\\\", "\\") for i in items]


def update_version_json(version, full_size_desc, patch_size_desc):
    """更新根目录与 public 下的 version.json，包含双包配置"""
    print("\n[4/4] 正在生成双源配置 version.json...")
    v_json_path = os.path.join(ROOT_DIR, "version.json")
    web_v_json_path = os.path.join(WEB_DIR, "public", "version.json")

    changelog = extract_highlights_from_version_ts(version)
    if changelog:
        print(f"   更新说明取自 version.ts 的 APP_CHANGELOG（{len(changelog)} 条）")
    else:
        print(f"   [警告] 没能在 version.ts 里找到 {version} 的 highlights，更新说明将为空")

    config = {
        "version": version,
        "releaseDate": datetime.now().strftime("%Y-%m-%d"),
        "changelog": changelog,
        "downloadUrl": f"https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Setup.{version}.exe",
        "fullSize": full_size_desc,
        "patchUrl": f"https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Patch.{version}.exe",
        "patchSize": patch_size_desc,
        "minPatchVersion": "2.0.3",
        "mirrors": [
            {
                "name": "GitHub 官方直链",
                "url": f"https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Setup.{version}.exe"
            },
            {
                "name": "国内高速镜像线路",
                "url": f"https://ghproxy.net/https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Setup.{version}.exe"
            }
        ],
        "patchMirrors": [
            {
                "name": "GitHub 官方直链",
                "url": f"https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Patch.{version}.exe"
            },
            {
                "name": "国内高速镜像线路",
                "url": f"https://ghproxy.net/https://github.com/FUFU-eng/FurinaKit/releases/download/v{version}/FurinaKit.Patch.{version}.exe"
            }
        ]
    }

    content_str = json.dumps(config, indent=2, ensure_ascii=False)
    with open(v_json_path, "w", encoding="utf-8") as f:
        f.write(content_str)
    with open(web_v_json_path, "w", encoding="utf-8") as f:
        f.write(content_str)

    print(f"version.json 已成功同步更新（完整包: {full_size_desc}, 增量包: {patch_size_desc}）")

def main():
    parser = argparse.ArgumentParser(description="FurinaKit 双轨版本构建工具")
    parser.add_argument("--version", type=str, default="", help="指定发布的版本号 (如 2.0.5)")
    parser.add_argument("--patch-only", action="store_true", help="仅打包极速增量补丁")
    parser.add_argument("--full-only", action="store_true", help="仅打包完整安装包")
    parser.add_argument("--skip-build", action="store_true", help="跳过前端 pnpm build 阶段")
    args = parser.parse_args()

    version = args.version or get_current_version()
    print("==================================================")
    print(f"      FurinaKit v{version} 双轨发布构建流水线")
    print("==================================================")

    makensis = find_makensis()
    if makensis:
        print(f"发现 NSIS 编译器: {makensis}")
    else:
        print("[警告] 未检测到 makensis.exe，增量 EXE 将无法编译！")

    if not args.skip_build and not args.patch_only:
        build_web_app()

    full_desc = "约 570 MB"
    patch_desc = "约 15 MB"

    if not args.patch_only:
        _, full_desc = build_full_installer(version)

    if not args.full_only:
        _, _, patch_desc = build_incremental_patch(version, makensis)

    update_version_json(version, full_desc, patch_desc)

    print("\n==================================================")
    print("构建流程全部完成！产物已输出到 dist-release/ 目录：")
    if os.path.isdir(RELEASE_OUTPUT_DIR):
        for f in os.listdir(RELEASE_OUTPUT_DIR):
            fp = os.path.join(RELEASE_OUTPUT_DIR, f)
            print(f" - {f} ({os.path.getsize(fp)/1024/1024:.2f} MB)")
    print("==================================================")

if __name__ == "__main__":
    main()
