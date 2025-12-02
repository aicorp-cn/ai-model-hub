// 模型配置接口
export interface ModelConfig {
  baseUrl: string;
  completionsPath: string;
  modelName: string;
  temperature: number;
}

// 提供商配置接口
export interface ProviderConfig {
  baseUrl: string;
  completionsPath: string;
  apiKey?: string;
  customHeader?: {
    add?: Record<string, string>;
    replace?: Record<string, string>;
    remove?: string[];
  };
  models?: Record<string, Omit<ModelConfig, 'baseUrl' | 'completionsPath'>>;
  // 用于支持特殊结构的模型配置
  [modelKey: string]: any;
}

// 证书配置接口
export interface CertConfig {
  hostname: string;
  certPath?: string;
  must: boolean;
  cert?: Buffer;
}

// 全局配置接口
export interface GlobalConfig {
  [provider: string]: ProviderConfig;
}

// 日志条目接口
export interface LogEntry {
  requestId: string;
  timestamp: string;
  model?: string;
  client?: string;
  path?: string;
  method?: string;
  body?: any;
  status?: number;
  headers?: Record<string, string>;
  response?: string;
  isBinary?: boolean;
  // 添加token统计字段
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}