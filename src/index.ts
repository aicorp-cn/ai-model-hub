#!/usr/bin/env node

import { startServer } from './server';

// 启动服务器
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});