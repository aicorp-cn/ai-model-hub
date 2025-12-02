import { encoding_for_model, type Tiktoken } from 'tiktoken';

// 实现LRU缓存机制
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map<K, V>();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (this.cache.has(key)) {
      const value = this.cache.get(key)!;
      // 更新访问顺序
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // 删除最久未使用的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

// 使用LRU缓存替代简单的对象缓存
const encoderCache = new LRUCache<string, Tiktoken>(100);

/**
 * 根据模型名称获取对应的tokenizer编码器
 * @param model 模型名称
 * @returns 编码器实例
 */
export function getEncoder(model: string): Tiktoken {
  let encoder = encoderCache.get(model);
  if (!encoder) {
    encoder = encoding_for_model(model as any);
    encoderCache.set(model, encoder);
  }
  return encoder;
}

/**
 * 计算文本的token数量
 * @param text 输入文本
 * @param model 模型名称
 * @returns token数量
 */
export function countTokens(text: string, model: string): number {
  try {
    const encoder = getEncoder(model);
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (error) {
    console.warn(`Failed to count tokens for model ${model}:`, error);
    // 如果无法获取特定模型的编码器，返回字符数作为粗略估计
    return text.length;
  }
}

/**
 * 异步计算文本的token数量
 * @param text 输入文本
 * @param model 模型名称
 * @returns token数量的Promise
 */
export function countTokensAsync(text: string, model: string): Promise<number> {
  // 使用原有的异步处理方式
  return new Promise((resolve) => {
    // 使用setImmediate避免阻塞事件循环
    setImmediate(() => {
      try {
        const encoder = getEncoder(model);
        const tokens = encoder.encode(text);
        resolve(tokens.length);
      } catch (error) {
        console.warn(`Failed to count tokens for model ${model}:`, error);
        // 如果无法获取特定模型的编码器，返回字符数作为粗略估计
        resolve(text.length);
      }
    });
  });
}

/**
 * 从聊天消息中提取文本内容
 * @param messages 聊天消息数组
 * @returns 提取的文本内容
 */
export function extractTextFromMessages(messages: any[]): string {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'system' || msg.role === 'assistant')
    .map(msg => msg.content)
    .join('\n');
}

/**
 * 从响应中提取生成的文本
 * @param response 响应对象
 * @returns 提取的文本内容
 */
export function extractTextFromResponse(response: any): string {
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response);
      return extractTextFromResponse(parsed);
    } catch {
      return response;
    }
  }
  
  if (response.choices && Array.isArray(response.choices)) {
    return response.choices
      .map((choice: any) => {
        if (choice.message) {
          return choice.message.content || '';
        }
        if (choice.text) {
          return choice.text;
        }
        return '';
      })
      .join('\n');
  }
  
  return '';
}