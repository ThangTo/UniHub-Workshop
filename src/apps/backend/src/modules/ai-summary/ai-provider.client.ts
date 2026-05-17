import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../common/config/app-config.service';

export interface AiSummaryResult {
  summary: string;
  highlights: string[];
  model: string;
  tokens?: number;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

interface GeminiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiSummaryJson {
  summary?: unknown;
  highlights?: unknown;
}

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'STRING',
      description: 'A Vietnamese workshop summary in 180 to 280 words.',
    },
    highlights: {
      type: 'ARRAY',
      description: 'Five concise Vietnamese bullet highlights for students.',
      items: { type: 'STRING' },
      minItems: 5,
      maxItems: 5,
    },
  },
  required: ['summary', 'highlights'],
  propertyOrdering: ['summary', 'highlights'],
} as const;

/**
 * Client gọi Gemini API để sinh AI summary từ text đã extract từ PDF.
 *
 * - Model mặc định: gemini-2.5-flash.
 * - Timeout 30s mỗi request.
 * - Tắt thinking cho Gemini 2.5 Flash để tránh burn output tokens làm JSON bị cắt.
 * - Retry exponential-ish backoff: 10s -> 30s -> 90s.
 * - 4xx từ Gemini là lỗi không retry; 5xx / timeout / network sẽ retry.
 */
@Injectable()
export class AiProviderClient {
  private readonly logger = new Logger(AiProviderClient.name);
  private static readonly RETRY_BACKOFFS_MS = [10_000, 30_000, 90_000];
  private static readonly TIMEOUT_MS = 30_000;

  constructor(private readonly cfg: AppConfigService) {}

  async summarize(text: string, maxWords = 280): Promise<AiSummaryResult> {
    const gemini = this.cfg.gemini;
    if (!gemini.apiKey) {
      throw new AiProviderError('gemini_api_key_missing', false);
    }

    const model = gemini.model;
    const url = `${gemini.baseUrl.replace(/\/$/, '')}/models/${model}:generateContent`;
    const payload = this.buildPayload(text.slice(0, 50_000), maxWords, model);
    const totalAttempts = 1 + AiProviderClient.RETRY_BACKOFFS_MS.length;

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = AiProviderClient.RETRY_BACKOFFS_MS[attempt - 1];
        this.logger.debug(`Gemini retry ${attempt} after ${backoff}ms backoff`);
        await sleep(backoff);
      }

      try {
        const res = await axios.post<GeminiGenerateContentResponse | GeminiErrorResponse>(
          url,
          payload,
          {
            timeout: AiProviderClient.TIMEOUT_MS,
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': gemini.apiKey,
            },
            validateStatus: () => true,
          },
        );

        if (res.status === 200) {
          return this.parseResponse(res.data as GeminiGenerateContentResponse, model);
        }

        const code = this.extractGeminiError(res.data) ?? `gemini_${res.status}`;
        if (res.status >= 400 && res.status < 500) {
          throw new AiProviderError(code, false);
        }

        lastErr = new AiProviderError(code, true);
        this.logger.warn(
          `Gemini attempt ${attempt + 1}/${totalAttempts} failed (${res.status}): ${code}`,
        );
      } catch (e) {
        if (e instanceof AiProviderError) {
          if (!e.retryable) throw e;
          lastErr = e;
        } else {
          const ax = e as AxiosError;
          const code = ax.code ?? ax.message ?? 'gemini_network_error';
          lastErr = new AiProviderError(code, true);
          this.logger.warn(
            `Gemini attempt ${attempt + 1}/${totalAttempts} network error: ${code}`,
          );
        }
      }
    }

    throw new AiProviderError(lastErr?.message ?? 'gemini_unavailable', false);
  }

  private buildPayload(text: string, maxWords: number, model: string) {
    const prompt = [
      'Bạn là trợ lý học thuật của UniHub Workshop.',
      'Hãy tóm tắt nội dung tài liệu workshop bằng tiếng Việt, súc tích và hữu ích cho sinh viên.',
      '',
      'Yêu cầu nội dung:',
      `- summary: một đoạn văn tiếng Việt từ 180 đến ${maxWords} từ.`,
      '- highlights: đúng 5 ý chính, mỗi ý tối đa 22 từ.',
      '- Không bịa thông tin ngoài tài liệu.',
      '- Nếu tài liệu thiếu chi tiết, chỉ tóm tắt phần có bằng chứng trong tài liệu.',
      '',
      'Format trả về bắt buộc:',
      '{',
      '  "summary": "đoạn tóm tắt tiếng Việt",',
      '  "highlights": ["ý chính 1", "ý chính 2", "ý chính 3", "ý chính 4", "ý chính 5"]',
      '}',
      '',
      'Nội dung tài liệu:',
      '---',
      text,
      '---',
    ].join('\n');

    return {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        ...this.buildThinkingConfig(model),
      },
    };
  }

  private parseResponse(
    data: GeminiGenerateContentResponse,
    fallbackModel: string,
  ): AiSummaryResult {
    const raw = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!raw) {
      throw new AiProviderError('empty_gemini_response', false);
    }

    let parsed: GeminiSummaryJson;
    try {
      parsed = JSON.parse(this.stripJsonFence(raw)) as GeminiSummaryJson;
    } catch {
      if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        const thoughts = data.usageMetadata?.thoughtsTokenCount ?? 0;
        throw new AiProviderError(`gemini_max_tokens thoughts=${thoughts}`, false);
      }
      throw new AiProviderError('invalid_gemini_json', false);
    }

    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.highlights)) {
      throw new AiProviderError('invalid_gemini_summary_shape', false);
    }

    const highlights = parsed.highlights
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (!parsed.summary.trim() || highlights.length === 0) {
      throw new AiProviderError('invalid_gemini_summary_content', false);
    }

    return {
      summary: parsed.summary.trim(),
      highlights,
      model: data.modelVersion ?? fallbackModel,
      tokens: data.usageMetadata?.totalTokenCount,
    };
  }

  private stripJsonFence(raw: string): string {
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  private extractGeminiError(data: unknown): string | null {
    const err = (data as GeminiErrorResponse | undefined)?.error;
    if (!err) return null;
    const code = err.status ?? (err.code ? `gemini_${err.code}` : null);
    if (code && err.message) return `${code}: ${err.message}`;
    return code ?? err.message ?? null;
  }

  private buildThinkingConfig(model: string) {
    const normalized = model.toLowerCase();
    if (
      normalized.includes('gemini-2.5-flash') ||
      normalized.includes('gemini-2.5-flash-lite')
    ) {
      return { thinkingConfig: { thinkingBudget: 0 } };
    }
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
