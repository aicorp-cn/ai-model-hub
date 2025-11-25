#!/bin/bash

# LLM Hub 发布脚本
# 用于创建新版本标签并触发 GitHub Release

set -e

echo "LLM Hub 发布脚本"
echo "=================="

# 检查当前分支
current_branch=$(git rev-parse --abbrev-ref HEAD)
echo "当前分支: $current_branch"

# 获取当前版本号
current_version=$(grep '"version"' package.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
echo "当前版本: v$current_version"

# 提示用户输入新版本号
read -p "请输入新版本号 (直接回车使用当前版本): " new_version

if [ -z "$new_version" ]; then
    new_version=$current_version
fi

# 确保版本号以 v 开头
if [[ $new_version != v* ]]; then
    new_version="v$new_version"
fi

echo "准备创建标签: $new_version"

# 提示用户确认
read -p "确认创建标签 $new_version 并推送? (y/N): " confirm

if [[ $confirm != [yY] ]]; then
    echo "操作已取消"
    exit 0
fi

# 创建标签
echo "正在创建标签 $new_version..."
git tag -a "$new_version" -m "Release $new_version"

# 推送标签
echo "正在推送标签到远程仓库..."
git push origin "$new_version"

echo "标签 $new_version 已成功创建并推送!"
echo "GitHub Actions 将自动触发 Release 流程。"