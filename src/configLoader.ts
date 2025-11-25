import fs from 'fs/promises';
import path from 'path';
import type { CertConfig, GlobalConfig, ModelConfig, ProviderConfig } from './types';

// 全局变量，存储模型配置和提供商配置
export const modelConfigs: Record<string, ModelConfig> = {};
// 存储提供商完整配置的全局变量
export const providerConfigs: Record<string, ProviderConfig> = {};

// 证书缓存，结构为数组，每个元素包含：{ hostname: string, must: boolean, cert: Buffer }
export const caCerts: CertConfig[] = [];

// 加载模型配置
export async function loadModelConfigs(configPath?: string): Promise<void> {
  try {
    const configFilePath = configPath || path.join(__dirname, '..', 'config', 'model.config.json');
    const configFile = await fs.readFile(configFilePath, 'utf8');
    const config: GlobalConfig = JSON.parse(configFile);
    
    // 清空现有的模型配置
    for (const key in modelConfigs) {
      delete modelConfigs[key];
    }
    
    // 清空现有的提供商配置
    for (const key in providerConfigs) {
      delete providerConfigs[key];
    }
    
    // 遍历每个provider
    for (const [provider, providerConfig] of Object.entries(config)) {
      // 存储完整的提供商配置（包括customHeader等字段）
      providerConfigs[provider] = providerConfig;
      
      const baseUrl = providerConfig.baseUrl;
      const completionsPath = providerConfig.completionsPath;
      
      // 处理不同结构的模型配置
      let models: Record<string, any> = {};
      if (providerConfig.models) {
        // 标准结构：模型在models字段下
        models = providerConfig.models;
      } else {
        // 特殊结构：模型直接在provider下（如aliyun）
        // 过滤掉非模型字段（baseUrl, completionsPath, apiKey等）
        const reservedKeys = ['baseUrl', 'completionsPath', 'apiKey', 'customHeader'];
        models = Object.fromEntries(
          Object.entries(providerConfig).filter(
            ([key]) => !reservedKeys.includes(key)
          )
        );
      }
      
      // 遍历每个模型
      for (const [modelKey, modelConfig] of Object.entries(models)) {
        const fullModelId = `${provider}/${modelKey}`;
        modelConfigs[fullModelId] = {
          baseUrl: baseUrl,
          completionsPath: completionsPath,
          modelName: modelConfig.modelName,
          temperature: modelConfig.temperature
        };
      }
    }
    
    console.log(`Loaded ${Object.keys(modelConfigs).length} model configurations`);
    console.log(`Loaded ${Object.keys(providerConfigs).length} provider configurations`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('Error: Model configuration file not found. Please create config/model.config.json');
    } else if (error instanceof SyntaxError) {
      console.error('Error: Invalid JSON in model configuration file');
    } else {
      console.error('Error loading model configurations:', error.message);
    }
    process.exit(1);
  }
}

// 验证证书文件是否存在且可读
export async function loadCertFromFile(certConfig: CertConfig): Promise<Buffer | null> {
  if (!certConfig.certPath) {
    // 如果没有指定证书路径，直接返回null
    return null;
  }
  
  try {
    // 尝试读取证书文件
    const cert = await fs.readFile(certConfig.certPath);
    return cert;
  } catch (readError: any) {
    // 如果must=true且证书文件读取失败，记录警告但继续执行（降级为must=false）
    if (certConfig.must) {
      console.warn(`Warning: Certificate required for ${certConfig.hostname} but file at ${certConfig.certPath} is not accessible: ${readError.message}. Downgrading must flag to false for this session.`);
    } else {
      // 如果must=false，记录警告并返回null
      console.warn(`Warning: Certificate file for ${certConfig.hostname} at path ${certConfig.certPath} is not accessible: ${readError.message}`);
    }
    return null;
  }
}

// 如果证书配置文件存在，则，从配置文件加载证书配置，并，将初化证书缓存（即： caCerts），否则，自动绕过证书验证。
export async function loadCACerts(configPath?: string): Promise<void> {
  try {
    const configFilePath = configPath || path.join(__dirname, '..', 'config', 'certs.config.json');
    const configFile = await fs.readFile(configFilePath, 'utf8');
    const certsConfig: CertConfig[] = JSON.parse(configFile);
    
    // 清空现有的证书缓存
    caCerts.length = 0;
    
    // 遍历每个证书配置
    for (const certConfig of certsConfig) {
      // 验证证书文件
      const cert = await loadCertFromFile(certConfig);
      
      // 将配置添加到缓存中
      caCerts.push({
        hostname: certConfig.hostname,
        must: certConfig.must && cert !== null, // 如果证书无效，即使must=true也设为false
        cert: cert || undefined
      } as CertConfig);
    }
    
    console.log(`Loaded ${caCerts.length} certificate configurations`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn('Warning: Certificate configuration file not found. SSL certificate validation will be skipped.');
    } else if (error instanceof SyntaxError) {
      console.error('Error: Invalid JSON in certificate configuration file:', error.message);
      process.exit(1); // JSON解析错误应该终止程序
    } else {
      console.error('Error loading certificate configurations:', error.message);
      // 不再终止程序，而是继续执行但跳过证书验证
      console.warn('SSL certificate validation will be skipped due to configuration errors.');
    }
  }
}

// 如果证书缓存中存在与hostname匹配的CA证书，则，使用该证书进行验证。否则，配置自动绕过证书验证。
export function setupCA(options: any, hostname: string): void {
  // 在证书缓存中查找与给定hostname匹配的证书
  const certConfig = caCerts.find(cert => cert.hostname === hostname);
  
  if (certConfig && certConfig.must && certConfig.cert) {
    // 如果找到匹配的证书且must为true且证书有效，则将该证书添加到options的ca属性中
    options.ca = certConfig.cert;
    options.rejectUnauthorized = true;
  } else {
    // 如果未找到匹配证书或must为false或证书无效，则设置options.rejectUnauthorized = false以跳过证书验证
    options.rejectUnauthorized = false;
  }
}