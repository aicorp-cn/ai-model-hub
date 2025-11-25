#!/bin/bash

# 构建所有平台的二进制文件
echo "Building binaries for all platforms..."

# 构建macOS版本
echo "Building macOS version..."
pnpm pack:macos

# 构建Linux版本
echo "Building Linux version..."
pnpm pack:linux

# 构建Windows版本
echo "Building Windows version..."
pnpm pack:windows

echo "All binaries built successfully!"
echo "Output files:"
echo "  - dist/llm-hub-macos (macOS)"
echo "  - dist/llm-hub-linux (Linux)"
echo "  - dist/llm-hub-windows.exe (Windows)"

# 显示文件信息
echo ""
echo "File information:"
file dist/llm-hub-macos
file dist/llm-hub-linux
file dist/llm-hub-windows.exe