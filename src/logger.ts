import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LogEntry } from './types';

// 日志目录位于项目根目录下（与src同级）
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'requests.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// 存储待更新的日志条目
const pendingLogs: Map<string, Partial<LogEntry>> = new Map();

// 确保日志目录存在
export async function ensureLogDir(): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// 日志轮转支持
export async function rotateLogIfNeeded(): Promise<void> {
  try {
    const stats = await fs.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = path.join(LOG_DIR, `requests_${timestamp}.log`);
      await fs.rename(LOG_FILE, rotatedFile);
    }
  } catch (err) {
    console.error('Log rotation failed:', err);
  }
}

// 异步写入日志文件
async function writeLog(data: string): Promise<void> {
  try {
    await ensureLogDir();
    await rotateLogIfNeeded();
    await fs.appendFile(LOG_FILE, data, 'utf8');
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

// 记录请求日志
export function logRequestBody(parsedReqBody: any, additionalContext: any = {}): string {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const logEntry: LogEntry = {
    requestId,
    timestamp,
    ...additionalContext,
    body: parsedReqBody
  };
  
  // 存储待更新的日志条目
  pendingLogs.set(requestId, {});
  
  // 异步写入日志，不阻塞主流程
  writeLog(JSON.stringify(logEntry) + '\n').then(() => {
    console.debug(`[${timestamp}] Request logged (ID: ${requestId})`);
  }).catch(err => {
    console.error('Failed to log request:', err);
  });
  
  return requestId;
}

// 更新日志条目
export async function updateLogEntry(requestId: string, updates: Partial<LogEntry>): Promise<void> {
  try {
    // 更新待更新的日志条目
    const pendingUpdate = pendingLogs.get(requestId) || {};
    pendingLogs.set(requestId, { ...pendingUpdate, ...updates });
    
    // 注意：这里只是暂存更新，实际更新会在响应日志记录时完成
  } catch (err) {
    console.error('Failed to update log entry:', err);
  }
}

// 记录响应日志
export function logResponse(
  responseData: string, 
  headers: any, 
  requestId: string, 
  statusCode: number,
  promptTokens?: number,
  completionTokens?: number
): void {
  const timestamp = new Date().toISOString();
  const contentType = headers ? headers['content-type'] || '' : '';
  const isBinary = !contentType.includes('application/json') && !contentType.includes('text/');
  
  // 获取待更新的日志条目
  const pendingUpdate = pendingLogs.get(requestId) || {};
  pendingLogs.delete(requestId); // 清除已处理的待更新条目
  
  const logEntry: LogEntry = {
    requestId,
    timestamp,
    status: statusCode,
    headers: headers,
    response: isBinary ? '<binary-data>' : responseData,
    isBinary: isBinary,
    ...pendingUpdate, // 应用待更新的内容
    promptTokens,
    completionTokens,
    totalTokens: promptTokens && completionTokens ? promptTokens + completionTokens : undefined
  };
  
  // 异步写入日志，不阻塞主流程
  writeLog(JSON.stringify(logEntry) + '\n').then(() => {
    console.debug(`[${timestamp}] Response logged for request ID: ${requestId}`);
  }).catch(err => {
    console.error('Failed to log response:', err);
  });
}

// 格式化文件大小
export function formatSize(bytes: number, decimals = 2): string {
  if (isNaN(bytes) || bytes < 0) throw new Error('Invalid Request.');
  if (bytes === 0) return '0B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const base = 1024;
  let unitIndex = 0;
  let size = bytes;
  
  while (size >= base && unitIndex < units.length - 1) {
    size /= base;
    unitIndex++;
  }
  
  let formattedSize: string;
  if (size % 1 === 0) {
    formattedSize = size.toFixed(0);
  } else {
    formattedSize = size.toFixed(decimals);
    formattedSize = parseFloat(formattedSize).toString();
  }
  
  return `${formattedSize}${units[unitIndex]}`;
}