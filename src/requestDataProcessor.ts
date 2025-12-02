import { extractTextFromMessages, extractTextFromResponse } from './tokenizer';

// 缓存的数据结构
interface ProcessedRequestData {
  requestId: string;
  promptText: string;
  model: string;
  timestamp: number; // 添加时间戳用于过期检查
}

interface ProcessedResponseData {
  requestId: string;
  responseText: string;
  model: string;
  timestamp: number; // 添加时间戳用于过期检查
}

// 缓存存储
const requestDataCache: Map<string, ProcessedRequestData> = new Map();
const responseDataCache: Map<string, ProcessedResponseData> = new Map();

// 缓存配置
const CACHE_CONFIG = {
  maxSize: 1000, // 最大缓存条目数
  ttl: 5 * 60 * 1000 // 5分钟过期时间
};

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  // 清理请求数据缓存
  for (const [key, value] of requestDataCache.entries()) {
    if (now - value.timestamp > CACHE_CONFIG.ttl) {
      requestDataCache.delete(key);
    }
  }
  
  // 清理响应数据缓存
  for (const [key, value] of responseDataCache.entries()) {
    if (now - value.timestamp > CACHE_CONFIG.ttl) {
      responseDataCache.delete(key);
    }
  }
}, 60 * 1000); // 每分钟检查一次

/**
 * 处理请求数据，提取用于token计算和日志记录的信息
 * @param requestId 请求ID
 * @param parsedReqBody 解析后的请求体
 * @param model 模型名称
 * @returns 处理后的请求数据
 */
export function processRequestData(requestId: string, parsedReqBody: any, model: string): ProcessedRequestData {
  // 检查缓存
  if (requestDataCache.has(requestId)) {
    const cached = requestDataCache.get(requestId)!;
    // 检查是否过期
    if (Date.now() - cached.timestamp < CACHE_CONFIG.ttl) {
      return cached;
    } else {
      // 过期则删除
      requestDataCache.delete(requestId);
    }
  }
  
  // 检查缓存大小，如果超过最大值则删除最旧的条目
  if (requestDataCache.size >= CACHE_CONFIG.maxSize) {
    const firstKey = requestDataCache.keys().next().value;
    if (firstKey) {
      requestDataCache.delete(firstKey);
    }
  }
  
  // 提取所需数据
  const promptText = parsedReqBody.messages && Array.isArray(parsedReqBody.messages) 
    ? extractTextFromMessages(parsedReqBody.messages) 
    : '';
  
  const processedData: ProcessedRequestData = {
    requestId,
    promptText,
    model,
    timestamp: Date.now()
  };
  
  // 缓存数据
  requestDataCache.set(requestId, processedData);
  
  return processedData;
}

/**
 * 处理响应数据，提取用于token计算和日志记录的信息
 * @param requestId 请求ID
 * @param responseData 响应数据
 * @param model 模型名称
 * @returns 处理后的响应数据
 */
export function processResponseData(requestId: string, responseData: any, model: string): ProcessedResponseData {
  // 检查缓存
  if (responseDataCache.has(requestId)) {
    const cached = responseDataCache.get(requestId)!;
    // 检查是否过期
    if (Date.now() - cached.timestamp < CACHE_CONFIG.ttl) {
      return cached;
    } else {
      // 过期则删除
      responseDataCache.delete(requestId);
    }
  }
  
  // 检查缓存大小，如果超过最大值则删除最旧的条目
  if (responseDataCache.size >= CACHE_CONFIG.maxSize) {
    const firstKey = responseDataCache.keys().next().value;
    if (firstKey) {
      responseDataCache.delete(firstKey);
    }
  }
  
  // 提取所需数据
  const responseText = extractTextFromResponse(responseData);
  
  const processedData: ProcessedResponseData = {
    requestId,
    responseText,
    model,
    timestamp: Date.now()
  };
  
  // 缓存数据
  responseDataCache.set(requestId, processedData);
  
  return processedData;
}

/**
 * 获取缓存的请求数据
 * @param requestId 请求ID
 * @returns 缓存的请求数据，如果不存在或过期则返回null
 */
export function getCachedRequestData(requestId: string): ProcessedRequestData | null {
  const cached = requestDataCache.get(requestId);
  if (cached && Date.now() - cached.timestamp < CACHE_CONFIG.ttl) {
    return cached;
  }
  return null;
}

/**
 * 获取缓存的响应数据
 * @param requestId 请求ID
 * @returns 缓存的响应数据，如果不存在或过期则返回null
 */
export function getCachedResponseData(requestId: string): ProcessedResponseData | null {
  const cached = responseDataCache.get(requestId);
  if (cached && Date.now() - cached.timestamp < CACHE_CONFIG.ttl) {
    return cached;
  }
  return null;
}

/**
 * 清理缓存数据
 * @param requestId 请求ID
 */
export function clearCachedData(requestId: string): void {
  requestDataCache.delete(requestId);
  responseDataCache.delete(requestId);
}

/**
 * 获取缓存统计信息
 * @returns 缓存统计信息
 */
export function getCacheStats(): { requestCacheSize: number; responseCacheSize: number } {
  return {
    requestCacheSize: requestDataCache.size,
    responseCacheSize: responseDataCache.size
  };
}