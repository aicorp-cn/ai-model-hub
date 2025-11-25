import http from 'http';
import url from 'url';
import { handleChatCompletions, handleErrorResponse } from './requestHandler';
import { loadModelConfigs, loadCACerts } from './configLoader';
import type { ModelConfig } from './types';

// 服务器配置
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 7891;
const TIMEOUT = parseInt(process.env.TIMEOUT || '300000', 10); // 5分钟

// 打印模型配置
function printModelConfigs(): void {
  console.log('\nAvailable Model Configurations:');
  
  // 按provider分组显示模型
  const providers: Record<string, any[]> = {};
  const providerHostnames: Record<string, string> = {}; // 用于存储每个provider的hostname
  const providerCertStatus: Record<string, string> = {}; // 用于存储每个provider的证书状态
  
  // 从configLoader导入所需的变量
  const { modelConfigs, caCerts } = require('./configLoader');
  
  for (const [id, config] of Object.entries(modelConfigs)) {
    const [provider] = id.split('/');
    if (!providers[provider]) {
      providers[provider] = [];
      // 提取并存储hostname
      let hostname = 'Invalid URL';
      try {
        const urlObj = new URL((config as ModelConfig).baseUrl);
        hostname = urlObj.hostname;
        providerHostnames[provider] = hostname;
        
        // 检查该hostname是否在caCerts中配置且must为true
        const certConfig = caCerts.find((cert: any) => cert.hostname === hostname);
        providerCertStatus[provider] = certConfig && certConfig.must ? '[SSL]' : '[SSL Skipped]';
      } catch (e) {
        providerHostnames[provider] = hostname;
        providerCertStatus[provider] = '[SSL Skipped]';
      }
    }
    providers[provider].push({
      'Model ID': id,
      'Model Name': (config as ModelConfig).modelName,
      'Temperature': (config as ModelConfig).temperature
    });
  }
  
  // 显示每个provider的模型
  for (const [provider, models] of Object.entries(providers)) {
    console.log(`\n${provider.toUpperCase()}(${providerHostnames[provider]} ${providerCertStatus[provider]}) Models:`);
    console.table(models);
  }
}

// 创建HTTP服务器
const server = http.createServer(async (clientReq: any, clientResp: any) => {
  // 设置CORS头
  clientResp.setHeader('Access-Control-Allow-Origin', '*');
  clientResp.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  clientResp.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // 设置客户端响应超时
  clientResp.setTimeout(TIMEOUT, () => {
    console.error('Client response timeout occurred.');
    if (!clientResp.headersSent) {
      handleErrorResponse(
        clientResp,
        `Response timeout after ${TIMEOUT}ms`,
        '',
        504
      );
    }
  });

  // 处理预检请求
  if (clientReq.method === 'OPTIONS') {
    clientResp.writeHead(200);
    clientResp.end();
    return;
  }

  try {
    const parsedUrl: any = url.parse(clientReq.url, true);
    const path = parsedUrl.pathname;

    // 路由处理
    if (clientReq.method === 'POST' && (path === '/chat/completions' || path === '/v1/chat/completions')) {
      await handleChatCompletions(clientReq, clientResp);
    } else {
      clientResp.writeHead(404, { 'Content-Type': 'application/json' });
      clientResp.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error: any) {
    console.error('Server error:', error);
    clientResp.writeHead(500, { 'Content-Type': 'application/json' });
    clientResp.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// 启动服务器
server.timeout = TIMEOUT;

export async function startServer(): Promise<void> {
  // 加载模型配置
  await loadModelConfigs();
  // 加载证书配置
  await loadCACerts();
  
  server.listen(PORT, () => {
    console.log(`
---
AI Proxy server started!
Version: v1.0.3
LLM API Base URL: http://${HOST}:${PORT}
---
    `);
    printModelConfigs();
  });
}

export default server;