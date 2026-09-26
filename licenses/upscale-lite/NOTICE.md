# 内置精简超分：许可材料与未闭环边界

当前资源合同为 src-tauri/upscale-lite-manifest.json：NCNN EXE 与动漫 2x/3x 的 bin/param，共 5 个文件，8,662,490 字节。没有重新下载模型或修改原始资源。

本目录保留从官方上游固定提交取得的许可原文：

- Real-ESRGAN-ncnn-vulkan-LICENSE.txt：Xintao Wang 与 nihui 的 MIT 许可。
- Real-ESRGAN-LICENSE.txt：Real-ESRGAN 项目的 BSD-3-Clause 许可。
- ncnn-LICENSE.txt：ncnn 的完整复合许可文本，不裁掉其列出的第三方条款。
- UPSTREAM-SOURCES.json：来源 URL、提交、原始字节哈希与落盘文本哈希。

这些是上游许可文本证据，不等于当前 6,161,408 字节 EXE 的精确构建依赖清单，也不能据此推断每个模型制品的来源/再分发条件已核实。二进制构建版本、实际链接的 ncnn/glslang/SPIR-V/其他第三方依赖及资源制品来源仍需与原始发行物对应后闭环。不得把来源未核验改成“许可审计通过”，不得将哈希匹配当成发行者签名。

scripts/stage_release_runtime.py 会将 licenses/ 整树复制到候选的 licenses/project-dependencies/；本目录应随候选保留。许可文件字节另计，不包含在 8,662,490 字节的运行资源总量中。本次补充不授予公开发布权限。
