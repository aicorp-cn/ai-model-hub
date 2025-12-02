import { Transform } from 'stream';
import zlib from 'zlib';
import url from 'url';
import http from 'http';
import https from 'https';
import { StringDecoder } from 'string_decoder';
import type { ProviderConfig } from './types';
import { logRequestBody, logResponse, updateLogEntry, formatSize } from './logger';
import { modelConfigs, providerConfigs, setupCA } from './configLoader';
// 导入tokenizer相关函数
import { countTokens, countTokensAsync, extractTextFromMessages, extractTextFromResponse } from './tokenizer';
// 导入请求数据处理器
import { processRequestData, getCachedRequestData } from './requestDataProcessor';

// 服务器配置
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 7891;
const TIMEOUT = process.env.TIMEOUT || 300000; // 5分钟

// 处理自定义请求头
export function customHeaders(options: any, providerConfig: ProviderConfig): void {
  // 检查是否有自定义头部规则
  if (!providerConfig.customHeader) {
    return;
  }

  const customRules = providerConfig.customHeader;
  
  // 处理需要添加的头部
  if (customRules.add) {
    for (const [headerName, headerValue] of Object.entries(customRules.add)) {
      // 处理占位符替换
      let finalValue = headerValue;
      if (typeof headerValue === 'string') {
        // 查找并替换形如 {propertyName} 的占位符
        finalValue = headerValue.replace(/\{([^}]+)\}/g, (match, propertyName) => {
          // 检查属性是否存在于providerConfig中
          if (providerConfig.hasOwnProperty(propertyName)) {
            return providerConfig[propertyName as keyof ProviderConfig] as string;
          }
          // 如果属性不存在，返回空字符串
          return '';
        });
      }
      
      // 设置头部值，如果已存在则覆盖
      options.headers[headerName] = finalValue;
      console.debug(`Headers changed: '${headerName}' added/updated with value '${finalValue}'`);
    }
  }

  // 处理需要替换的头部
  if (customRules.replace) {
    for (const [clientSideHeaderName, upstreamHeaderName] of Object.entries(customRules.replace)) {
      if (options.headers[clientSideHeaderName]) {
        options.headers[upstreamHeaderName] = options.headers[clientSideHeaderName];
        delete options.headers[clientSideHeaderName];
        console.debug(`Headers changed: '${clientSideHeaderName}' replaced with '${upstreamHeaderName}'`);
      }
    }
  }

  // 处理需要删除的头部
  if (customRules.remove) {
    for (const headerName of customRules.remove) {
      if (options.headers[headerName]) {
        delete options.headers[headerName];
        console.debug(`Headers changed: '${headerName}' removed`);
      }
    }
  }
}

// 创建合并的响应处理流，同时处理日志记录和token计算
export function createMergedResponseStream(
  requestId: string, 
  headers: any, 
  statusCode: number,
  model: string,
  onCompletionTokens: (tokens: number) => void
): Transform {
  let accumulatedResponse = '';
  let responseData = Buffer.alloc(0);
  const maxLogSize = 1024 * 1024; // 1MB限制
  let dataSize = 0;
  
  return new Transform({
    transform(chunk: any, encoding: any, callback: any) {
      // 同时处理日志数据收集和token计算数据收集
      // 1. 收集日志数据
      if (dataSize < maxLogSize) {
        const remainingSpace = maxLogSize - dataSize;
        const chunkToStore = chunk.length <= remainingSpace ? chunk : chunk.slice(0, remainingSpace);
        responseData = Buffer.concat([responseData, chunkToStore]);
        dataSize += chunkToStore.length;
      }
      
      // 2. 累积响应数据用于token计算
      accumulatedResponse += chunk.toString();
      
      // 将数据块传递给下一个流
      callback(null, chunk);
    },
    
    flush(callback: any) {
      // 流结束时同时处理日志记录和token计算
      setImmediate(async () => {
        try {
          // 并行处理日志记录和token计算
          const logPromise = (async () => {
            try {
              // 处理日志记录
              const contentType = headers ? headers['content-type'] || '' : '';
              const isBinary = !contentType.includes('application/json') && !contentType.includes('text/');
              
              let responseToLog: string;
              if (isBinary) {
                responseToLog = '<binary-data>';
              } else {
                try {
                  responseToLog = responseData.toString('utf8');
                  if (contentType.includes('application/json')) {
                    JSON.parse(responseToLog);
                  }
                } catch {
                  responseToLog = '<malformed-json-data>';
                }
              }
              
              // 记录响应日志
              logResponse(responseToLog, headers, requestId, statusCode);
            } catch (err) {
              console.error('Failed to log response data:', err);
            }
          })();
          
          const tokenPromise = (async () => {
            try {
              // 计算completion tokens
              const completionTokens = await countTokensAsync(accumulatedResponse, model);
              onCompletionTokens(completionTokens);
            } catch (err) {
              console.error('Failed to count completion tokens:', err);
              onCompletionTokens(0);
            }
          })();
          
          // 等待两个操作都完成
          await Promise.all([logPromise, tokenPromise]);
        } catch (err) {
          console.error('Failed to process merged response stream:', err);
        }
      });
      
      callback();
    }
  });
}

// 解析请求体
export function parseRequestBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf-8');
    let body = '';
    
    req.on('data', (chunk: any) => {
      body += decoder.write(chunk);
    });
    
    req.on('end', () => {
      body += decoder.end();
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    
    req.on('error', (error: any) => {
      reject(error);
    });
  });
}

// 处理错误响应
export function handleErrorResponse(clientResp: any, errorMessage = '', model = '', statusCode = 500, contentType = 'application/json'): void {
  if (!clientResp.headersSent) {
    const errorResponse = {
      error: errorMessage,
      model: model,
      status: statusCode
    };
    
    clientResp.writeHead(
      statusCode,
      {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(JSON.stringify(errorResponse))
      }
    );
    clientResp.end(JSON.stringify(errorResponse));
  } else {
    console.error('Cannot send error response after headers were sent:', errorMessage);
    clientResp.destroy();
  }
}

// 创建响应数据记录流
export function createResponseLogger(requestId: string, headers: any, statusCode: number): Transform {
  let responseData = Buffer.alloc(0);
  const maxLogSize = 1024 * 1024; // 1MB限制
  let dataSize = 0;
  
  return new Transform({
    transform(chunk: any, encoding: any, callback: any) {
      // 检查数据大小限制
      if (dataSize < maxLogSize) {
        const remainingSpace = maxLogSize - dataSize;
        const chunkToStore = chunk.length <= remainingSpace ? chunk : chunk.slice(0, remainingSpace);
        responseData = Buffer.concat([responseData, chunkToStore]);
        dataSize += chunkToStore.length;
      }
      
      // 将数据块传递给下一个流
      callback(null, chunk);
    },
    
    flush(callback: any) {
      // 流结束时记录响应数据
      setImmediate(() => {
        try {
          // 确定内容类型
          const contentType = headers ? headers['content-type'] || '' : '';
          const isBinary = !contentType.includes('application/json') && !contentType.includes('text/');
          
          // 处理响应数据
          let responseToLog: string;
          if (isBinary) {
            responseToLog = '<binary-data>';
          } else {
            try {
              responseToLog = responseData.toString('utf8');
              // 如果是JSON，尝试解析以确保格式正确
              if (contentType.includes('application/json')) {
                JSON.parse(responseToLog);
              }
            } catch {
              responseToLog = '<malformed-json-data>';
            }
          }
          
          // 记录响应日志
          logResponse(responseToLog, headers, requestId, statusCode);
        } catch (err) {
          console.error('Failed to log response data:', err);
        }
      });
      
      callback();
    }
  });
}

// 创建专门用于token统计的Transform流
export function createTokenCountingStream(model: string, onCompletionTokens: (tokens: number) => void): Transform {
  let accumulatedResponse = '';
  
  return new Transform({
    transform(chunk: any, encoding: any, callback: any) {
      // 累积响应数据用于token计算
      accumulatedResponse += chunk.toString();
      // 将数据块传递给下一个流
      callback(null, chunk);
    },
    
    flush(callback: any) {
      // 流结束时计算completion tokens
      setImmediate(async () => {
        try {
          const completionTokens = await countTokensAsync(accumulatedResponse, model);
          onCompletionTokens(completionTokens);
        } catch (err) {
          console.error('Failed to count completion tokens:', err);
          onCompletionTokens(0);
        }
      });
      
      callback();
    }
  });
}

// 处理chat.completions请求
export async function handleChatCompletions(clientReq: any, clientResp: any): Promise<void> {
  let inModelName: string;
  let actualModelName: string = 'unknown';
  let modelTemperature: number;
  let clientInfo = clientReq.headers['user-agent'];
  let parsedReqBody: any;
  // 添加token统计变量
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    parsedReqBody = await parseRequestBody(clientReq);
    
    // 初始化模型名称，用于后续token计算
    inModelName = parsedReqBody.model;
    if (!inModelName || !modelConfigs[inModelName]) {
      throw new Error(`Unsupported or Unknown Model: ${inModelName}`);
    }
    const config = modelConfigs[inModelName];
    actualModelName = config.modelName;
    
    // 记录请求日志（不等待token计算完成）
    const requestId = logRequestBody(parsedReqBody, {
      model: parsedReqBody.model,
      client: clientInfo?.startsWith('Zs/JS') ? 'CLine' : clientInfo,
      path: clientReq.url,
      method: clientReq.method
    });
    clientReq.headers['x-request-id'] = requestId;
    
    // 处理请求数据，提取用于token计算和日志记录的信息
    const processedRequestData = processRequestData(requestId, parsedReqBody, actualModelName);
    
    // 异步计算prompt tokens，不阻塞主流程
    let promptTokensPromise: Promise<number> | null = null;
    if (processedRequestData.promptText) {
      promptTokensPromise = countTokensAsync(processedRequestData.promptText, processedRequestData.model);
    }
    
    // 异步处理prompt tokens计算，不阻塞请求转发
    if (promptTokensPromise) {
      promptTokensPromise.then(promptTokensResult => {
        promptTokens = promptTokensResult;
        // 异步更新请求日志中的prompt tokens
        updateLogEntry(requestId, { promptTokens }).catch(err => {
          console.error('Failed to update prompt tokens in log:', err);
        });
      }).catch(err => {
        console.error('Failed to calculate prompt tokens:', err);
        // 即使token计算失败，也不影响主流程
      });
    }

    if (!inModelName || !modelConfigs[inModelName]) {
      throw new Error(`Unsupported or Unknown Model: ${inModelName}`);
    }

    // 使用配置中的实际模型名称
    console.debug(`Actual Model Name: ${config.modelName}`);
    actualModelName = config.modelName;
    
    // 处理温度参数
    modelTemperature = parsedReqBody.temperature;
    modelTemperature = !isNaN(modelTemperature) && modelTemperature >= 0 
      ? modelTemperature 
      : config.temperature;
    parsedReqBody.model = actualModelName;
    parsedReqBody.temperature = modelTemperature;

    // 重建请求体
    const jsonReqBody = JSON.stringify(parsedReqBody);
    const contentLength = Buffer.byteLength(jsonReqBody, 'utf8');

    // 目标API URL标准化
    const targetUrl: any = url.parse(config.baseUrl + config.completionsPath);

    // 准备转发请求的选项
    const options: any = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.path + (targetUrl.search || ''),
      method: 'POST',
      headers: {
        ...clientReq.headers,
        'Content-Type': 'application/json',
        'Content-Length': contentLength,
        'host': targetUrl.hostname
      },
      timeout: TIMEOUT,
      rejectUnauthorized: false
    };
    
    // 调用证书配置函数
    if (targetUrl.protocol === 'https:') {
      setupCA(options, targetUrl.hostname);
    }

    // 处理自定义请求头
    // 获取提供商配置（从已加载的提供商配置中提取）
    const providerName = inModelName.split('/')[0];
    
    // 从已加载的提供商配置中获取提供商配置
    const providerConfig = providerConfigs[providerName];
    
    // 如果找到了提供商配置，则应用自定义头部规则
    if (providerConfig && providerConfig.customHeader) {
      console.debug(`Applying custom headers for provider: ${providerName}`);
      customHeaders(options, providerConfig);
    }

    console.info(`
---
## New request from client and forward to upstream
- Hostname: ${targetUrl.protocol}//${targetUrl.hostname}:${targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)}
- API Path: ${config.completionsPath}
- Client: ${clientInfo?.startsWith('Zs/JS') ? 'CLine' : clientInfo}
- LLM Model: ${actualModelName}
- Model Temperature: ${modelTemperature}
- Prompt Request Size: ${formatSize(contentLength)}
- Target API URL: ${targetUrl.href} 
- Headers: ${JSON.stringify(options.headers, null, 2)}
---
    `);

    // 转发请求到目标API
    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(options, (proxyResp: any) => {
      proxyResp.headers['x-request-id'] = requestId;
      
      const upstreamRespStatusCode = proxyResp.statusCode;
      const upstreamRespEncoding = proxyResp.headers['content-encoding'];
      const upstreamRespContentType = proxyResp.headers['content-type'];

      console.info(`
---
## Upstream service responded with:
- Status code: ${upstreamRespStatusCode}
- Encoding: ${upstreamRespEncoding}
- Content-Type: ${upstreamRespContentType}
---
      `);

      let outputStream: any;
      if (upstreamRespEncoding === 'gzip') {
        outputStream = proxyResp.pipe(zlib.createGunzip());
      } else if (upstreamRespEncoding === 'deflate') {
        outputStream = proxyResp.pipe(zlib.createInflate());
      } else {
        outputStream = proxyResp;
      }

      if (upstreamRespStatusCode < 200 || upstreamRespStatusCode >= 300) {
        const chunkData: any[] = [];
        outputStream.on('data', (chunk: any) => {
          chunkData.push(chunk);
        });
        outputStream.on('end', () => {
          const respondData = Buffer.concat(chunkData).toString();
          console.error(`
---
### Error from Upstream service:
- Status: ${upstreamRespStatusCode}
- Error: ${respondData}
---
          `);
          
          try {
            const responseData = JSON.parse(respondData);
            // 在错误响应中记录token统计
            logResponse(responseData, proxyResp.headers, proxyResp.headers['x-request-id'], upstreamRespStatusCode, promptTokens, 0);
          } catch {
            logResponse('<binary-data>', proxyResp.headers, proxyResp.headers['x-request-id'], upstreamRespStatusCode, promptTokens, 0);
          }
          
          // 处理上游错误
          handleErrorResponse(
            clientResp,
            respondData,
            actualModelName,
            upstreamRespStatusCode,
            upstreamRespContentType
          );
        });
        return;
      }

      // 创建响应记录流并将其插入到管道中
      // 使用合并的响应处理流替代原来的两个独立流
      const mergedResponseStream = createMergedResponseStream(
        requestId, 
        proxyResp.headers, 
        upstreamRespStatusCode,
        actualModelName,
        (tokens: number) => {
          completionTokens = tokens;
          // 异步更新日志中的completion tokens
          updateLogEntry(requestId, { completionTokens, totalTokens: promptTokens + completionTokens }).catch(err => {
            console.error('Failed to update completion tokens in log:', err);
          });
          console.debug(`Prompt tokens: ${promptTokens}, Completion tokens: ${completionTokens}, Total tokens: ${promptTokens + completionTokens}`);
        }
      );
      
      // 通过管道将上游服务的响应数据输出给客户端，同时记录数据和统计tokens
      clientResp.writeHead(upstreamRespStatusCode, proxyResp.headers);
      outputStream.pipe(mergedResponseStream).pipe(clientResp);
      
      console.info(`
---
## Response replied to client (Done)
---
      `);
    });

    // 设置连接上游服务的超时
    proxyReq.setTimeout(options.timeout, () => {
      handleErrorResponse(
        clientResp,
        `Connection to upstream service (LLM/VLM API) timed out after ${TIMEOUT}ms`,
        actualModelName,
        504
      );
    });

    proxyReq.on('error', (error: any) => {
      console.error(`Proxy request error: ${error}`);
      handleErrorResponse(
        clientResp,
        error.message,
        actualModelName,
        500
      );
    });

    // 发送请求体
    proxyReq.write(jsonReqBody);
    proxyReq.end();
  } catch (error: any) {
    console.error('Unexpected Error in handleChatCompletions:', error);
    handleErrorResponse(
      clientResp,
      error.message,
      actualModelName,
      500,
      'application/json'
    );
  } finally {
    if (parsedReqBody) parsedReqBody = null;
  }
}