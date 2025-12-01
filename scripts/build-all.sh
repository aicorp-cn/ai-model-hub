#!/bin/bash

# 构建所有平台的二进制文件
echo "Building binaries for all platforms..."

# 构建macOS Intel版本
echo "Building macOS Intel version..."
pnpm pack:macos:x64

# 构建macOS ARM版本
echo "Building macOS ARM version..."
pnpm pack:macos:arm64

# 构建Linux版本
echo "Building Linux version..."
pnpm pack:linux

# 构建Windows版本
echo "Building Windows version..."
pnpm pack:windows

echo "All binaries built successfully!"
echo "Output files:"
echo "  - dist/llm-hub-macos-x64 (macOS Intel)"
echo "  - dist/llm-hub-macos-arm64 (macOS ARM)"
echo "  - dist/llm-hub-linux (Linux)"
echo "  - dist/llm-hub-windows.exe (Windows)"

# 显示文件信息
echo ""
echo "File information:"
file dist/llm-hub-macos-x64
file dist/llm-hub-macos-arm64
file dist/llm-hub-linux
file dist/llm-hub-windows.exe