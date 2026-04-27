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

/**
 * Client gọi mock-ai (specs/ai-summary.md):
 *   - Timeout 30s mỗi request.
 *   - Retry với exponential backoff: 10s → 30s → 90s (3 attempts).
 *   - 4xx body invalid → non-retryable.
 *   - 5xx / timeout / network → retryable.
 *
 * MOCK_AI_DOWN=true ở mock-ai → 503 → retryable (3 lần) rồi fail.
 */
@Injectable()
export class AiProviderClient {
  private readonly logger = new Logger(AiProviderClient.name);
  /** Backoff trước retry thứ 1, 2, 3. attempt 0 chạy ngay. */
  private static readonly RETRY_BACKOFFS_MS = [10_000, 30_000, 90_000];
  private static readonly TIMEOUT_MS = 30_000;

  constructor(private readonly cfg: AppConfigService) {}

  /**
   * Gọi POST /summarize với retry.
   * Tổng cộng 4 attempts: initial + 3 retries (backoff 10s / 30s / 90s).
   * Throw AiProviderError(retryable=false) khi out-of-retries hoặc 4xx.
   */
  async summarize(text: string, maxWords = 280): Promise<AiSummaryResult> {
    const url = `${this.cfg.mockAiUrl.replace(/\/$/, '')}/summarize`;
    const payload = { text: text.slice(0, 50_000), maxWords, language: 'vi' };
    const totalAttempts = 1 + AiProviderClient.RETRY_BACKOFFS_MS.length;

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = AiProviderClient.RETRY_BACKOFFS_MS[attempt - 1];
        this.logger.debug(`AI retry ${attempt} after ${backoff}ms backoff`);
        await sleep(backoff);
      }
      try {
        const res = await axios.post<AiSummaryResult>(url, payload, {
          timeout: AiProviderClient.TIMEOUT_MS,
          headers: { 'content-type': 'application/json' },
          validateStatus: () => true,
        });

        if (res.status === 200) {
          const data = res.data;
          if (!data || !data.summary || !Array.isArray(data.highlights)) {
            throw new AiProviderError('invalid_ai_response', false);
          }
          return data;
        }

        // 4xx → non-retryable
        if (res.status >= 400 && res.status < 500) {
          const code = (res.data as { error?: string })?.error ?? 'ai_bad_request';
          throw new AiProviderError(code, false);
        }

        // 5xx → retryable
        const code = (res.data as { error?: string })?.error ?? `ai_${res.status}`;
        lastErr = new AiProviderError(code, true);
        this.logger.warn(
          `AI attempt ${attempt + 1}/${totalAttempts} failed (${res.status}): ${code}`,
        );
      } catch (e) {
        if (e instanceof AiProviderError) {
          if (!e.retryable) throw e;
          lastErr = e;
        } else {
          const ax = e as AxiosError;
          const code = ax.code ?? ax.message ?? 'ai_network_error';
          lastErr = new AiProviderError(code, true);
          this.logger.warn(`AI attempt ${attempt + 1}/${totalAttempts} network error: ${code}`);
        }
      }
    }

    throw new AiProviderError(lastErr?.message ?? 'ai_unavailable', false);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
