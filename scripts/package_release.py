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
import argparse
import subprocess
import zipfile
from datetime import datetime

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_DIR = os.path.join(ROOT_DIR, "apps", "web")
RELEASE_OUTPUT_DIR = os.path.join(ROOT_DIR, "dist-release")
STAGING_DIR = os.path.join(ROOT_DIR, "patch_staging")

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
    """打包极速增量升级补丁 (~15MB)"""
    print(f"\n[3/4] 正在构建极速增量补丁 FurinaKit.Patch.{version}.exe...")
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

    # 复制轻量新增二进制依赖（如有更新）
    aria2_path = os.path.join(WEB_DIR, "aria2c.exe")
    if os.path.isfile(aria2_path):
        shutil.copy2(aria2_path, os.path.join(staging_res, "aria2c.exe"))

    # 复制 sharp 原生二进制包
    unpacked_img = os.path.join(WEB_DIR, "dist-installer", "win-unpacked", "resources", "app", "node_modules", "@img")
    if os.path.isdir(unpacked_img):
        shutil.copytree(unpacked_img, os.path.join(staging_app, "node_modules", "@img"))

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

    nsi_script = f"""!include "MUI2.nsh"
!include "FileFunc.nsh"

Unicode true
Name "FurinaKit 芙宁娜工具箱 v{version} 极速增量升级补丁"
OutFile "{patch_exe_out}"
Icon "{ico_path}"
RequestExecutionLevel highest
SetCompressor /SOLID lzma

InstallDir "C:\\Program Files\\FurinaKit"
InstallDirRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\furinakit" "InstallLocation"

!define MUI_ABORTWARNING
!define MUI_ICON "{ico_path}"
!define MUI_UNICON "{ico_path}"
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 FurinaKit v{version} 极速升级补丁"
!define MUI_WELCOMEPAGE_TEXT "本补丁包仅包含本次版本迭代的代码与功能改动（约 15MB）。$\\r$\\n$\\r$\\n★ 优势：$\\r$\\n1. 无需重新下载 570MB 庞大安装包，升级全程仅需数秒$\\r$\\n2. 您的所有偏好设置、历史记录与已下载文件 100% 完整保留$\\r$\\n$\\r$\\n点击下一步即可开始自动部署。"

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
    ; 优先尝试读取安装注册表
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
    nsExec::Exec 'taskkill /F /IM node.exe'
    nsExec::Exec 'taskkill /F /IM aria2c.exe'
    Sleep 1000

    DetailPrint "正在极速部署核心应用模块..."
    SetOutPath "$INSTDIR\\resources\\app"
    File /r "{STAGING_DIR}\\resources\\app\\*.*"

    DetailPrint "正在同步加速驱动组件..."
    SetOutPath "$INSTDIR\\resources"
    ${{If}} ${{FileExists}} "{STAGING_DIR}\\resources\\aria2c.exe"
        File "{STAGING_DIR}\\resources\\aria2c.exe"
    ${{EndIf}}

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
    return patch_exe_out, zip_out, f"约 {patch_mb:.1f} MB"

def update_version_json(version, full_size_desc, patch_size_desc):
    """更新根目录与 public 下的 version.json，包含双包配置"""
    print("\n[4/4] 正在生成双源配置 version.json...")
    v_json_path = os.path.join(ROOT_DIR, "version.json")
    web_v_json_path = os.path.join(WEB_DIR, "public", "version.json")

    existing_changelog = []
    if os.path.isfile(v_json_path):
        try:
            with open(v_json_path, "r", encoding="utf-8") as f:
                d = json.load(f)
                existing_changelog = d.get("changelog", [])
        except Exception:
            pass

    config = {
        "version": version,
        "releaseDate": datetime.now().strftime("%Y-%m-%d"),
        "changelog": existing_changelog,
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
