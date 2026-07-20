// ============================================================================
// SenseNova API Provider — 对接商汤日日新大模型
// 兼容 OpenAI SDK 格式，支持多模态（图片输入）和 Function Calling
// ============================================================================

const SENSENOVA_BASE_URL = 'https://token.sensenova.cn/v1';

// 从环境变量或配置中读取 API Key
// 用户需要在 Mobile Agent 的 Settings → Providers 中配置
let cachedApiKey: string = '';

/**
 * 设置 SenseNova API Key（由 Config UI 调用）
 */
export function setSenseNovaApiKey(key: string) {
  cachedApiKey = key;
}

/**
 * 获取当前 SenseNova API Key
 */
export function getSenseNovaApiKey(): string {
  return cachedApiKey;
}

/**
 * 通用 SenseNova Chat Completions 请求
 * 流式/非流式，支持多模态图片输入
 */
export async function senseNovaChat(params: {
  model: string;                                   // sensenova-6.7-flash-lite | deepseek-v4-flash
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  response_format?: { type: 'json_object' };
  max_tokens?: number;
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none';
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: 'auto' | 'none' | 'required';
}): Promise<any> {
  const apiKey = cachedApiKey || process.env.SENSENOVA_API_KEY;
  if (!apiKey) {
    throw new Error('[SenseNova] API Key 未配置。请先在 Settings → Providers 中添加 SenseNova API Key。');
  }

  const response = await fetch(`${SENSENOVA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(params.response_format ? { response_format: params.response_format } : {}),
      ...(params.max_tokens ? { max_tokens: params.max_tokens } : { max_tokens: 4096 }),
      ...(params.reasoning_effort ? { reasoning_effort: params.reasoning_effort } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : { temperature: 0.6 }),
      stream: params.stream ?? false,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[SenseNova] API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * 流式 SenseNova Chat — 用于 HUD 弹幕实时展示思考过程
 * 返回 AsyncGenerator，逐 chunk 产出
 */
export async function* senseNovaChatStream(params: {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<any>;
  }>;
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none';
  max_tokens?: number;
}): AsyncGenerator<{
  type: 'reasoning' | 'text' | 'done';
  content: string;
  usage?: any;
}> {
  const apiKey = cachedApiKey || process.env.SENSENOVA_API_KEY;
  if (!apiKey) {
    throw new Error('[SenseNova] API Key 未配置。');
  }

  const response = await fetch(`${SENSENOVA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: params.reasoning_effort ?? 'high',
      max_tokens: params.max_tokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[SenseNova] Stream Error (${response.status}): ${errorText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'done', content: '' };
          return;
        }

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          
          if (delta?.reasoning_content) {
            yield { type: 'reasoning', content: delta.reasoning_content };
          }
          if (delta?.content) {
            yield { type: 'text', content: delta.content };
          }
          if (chunk.usage) {
            yield { type: 'done', content: '', usage: chunk.usage };
          }
        } catch {
          // 跳过解析失败的chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}