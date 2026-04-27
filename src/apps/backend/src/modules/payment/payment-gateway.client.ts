import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import CircuitBreaker = require('opossum');
import { AppConfigService } from '../../common/config/app-config.service';

export interface ChargeRequest {
  regId: string;
  amount: number;
  idempotencyKey: string;
  method?: string;
}
export interface ChargeResponse {
  id: string;
  regId: string;
  amount: number;
  idempotencyKey: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  failureReason?: string;
  createdAt: string;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * HTTP client gọi Mock Payment Gateway, bọc qua opossum CircuitBreaker
 * (specs/circuit-breaker.md §B).
 */
@Injectable()
export class PaymentGatewayClient implements OnModuleInit {
  private readonly logger = new Logger(PaymentGatewayClient.name);
  private chargeBreaker!: CircuitBreaker<[ChargeRequest], ChargeResponse>;
  private getChargeBreaker!: CircuitBreaker<[string], ChargeResponse>;
  private refundBreaker!: CircuitBreaker<
    [{ chargeId: string; amount: number }],
    { id: string; status: string }
  >;

  private state: CircuitState = 'closed';
  private since: Date = new Date();
  private lastError?: string;
  private stats = { successes: 0, failures: 0, timeouts: 0 };

  constructor(private readonly cfg: AppConfigService) {}

  onModuleInit(): void {
    const opts: CircuitBreaker.Options = {
      timeout: this.cfg.payment.timeoutMs,
      errorThresholdPercentage: this.cfg.payment.cbErrorThreshold,
      resetTimeout: this.cfg.payment.cbResetTimeoutMs,
      rollingCountTimeout: this.cfg.payment.cbRollingWindowMs,
      rollingCountBuckets: 10,
      volumeThreshold: this.cfg.payment.cbVolumeThreshold,
      name: 'payment-gateway',
    };

    this.chargeBreaker = new CircuitBreaker((req: ChargeRequest) => this.doCharge(req), opts);
    this.getChargeBreaker = new CircuitBreaker((id: string) => this.doGetCharge(id), opts);
    this.refundBreaker = new CircuitBreaker(
      (req: { chargeId: string; amount: number }) => this.doRefund(req),
      opts,
    );

    for (const b of [this.chargeBreaker, this.getChargeBreaker, this.refundBreaker]) {
      const bb = b as unknown as {
        on(event: string, fn: (...args: unknown[]) => void): void;
        name: string;
      };
      bb.on('open', () => {
        this.state = 'open';
        this.since = new Date();
        this.logger.warn(`Circuit OPEN (${bb.name})`);
      });
      bb.on('halfOpen', () => {
        this.state = 'half_open';
        this.since = new Date();
        this.logger.log(`Circuit HALF_OPEN (${bb.name})`);
      });
      bb.on('close', () => {
        this.state = 'closed';
        this.since = new Date();
        this.logger.log(`Circuit CLOSED (${bb.name})`);
      });
      bb.on('success', () => this.stats.successes++);
      bb.on('failure', (...args: unknown[]) => {
        this.stats.failures++;
        const err = args[0] as Error | undefined;
        this.lastError = err?.message;
      });
      bb.on('timeout', () => {
        this.stats.timeouts++;
        this.lastError = 'timeout';
      });
    }
  }

  // --- Public API ---
  async charge(req: ChargeRequest): Promise<ChargeResponse> {
    return this.chargeBreaker.fire(req);
  }
  async getCharge(id: string): Promise<ChargeResponse> {
    return this.getChargeBreaker.fire(id);
  }
  async refund(req: { chargeId: string; amount: number }): Promise<{ id: string; status: string }> {
    return this.refundBreaker.fire(req);
  }

  isOpen(): boolean {
    return this.state === 'open';
  }
  getHealth() {
    return { circuit: this.state, since: this.since, lastError: this.lastError, stats: this.stats };
  }

  // --- Raw HTTP ---
  private doCharge(req: ChargeRequest): Promise<ChargeResponse> {
    return this.httpJson<ChargeResponse>('POST', '/charge', req);
  }
  private doGetCharge(id: string): Promise<ChargeResponse> {
    return this.httpJson<ChargeResponse>('GET', `/charge/${encodeURIComponent(id)}`);
  }
  private doRefund(req: {
    chargeId: string;
    amount: number;
  }): Promise<{ id: string; status: string }> {
    return this.httpJson<{ id: string; status: string }>('POST', '/refund', req);
  }

  private httpJson<T>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<T> {
    const u = new URL(this.cfg.payment.gatewayUrl);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;

    return new Promise<T>((resolve, reject) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname.replace(/\/$/, '') + pathname,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(data ? { 'Content-Length': data.length } : {}),
          },
          timeout: this.cfg.payment.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: T | { error?: string } = {} as T;
            try {
              parsed = text ? JSON.parse(text) : ({} as T);
            } catch {
              return reject(new Error(`invalid_response: ${text.slice(0, 100)}`));
            }
            if (res.statusCode != null && res.statusCode >= 500) {
              return reject(
                new Error(
                  `gateway_${res.statusCode}: ${(parsed as { error?: string }).error ?? ''}`,
                ),
              );
            }
            // 4xx (như 402 declined) trả thành công về CB; PaymentService phân biệt theo body.status
            resolve(parsed as T);
          });
        },
      );
      req.on('error', (e) => reject(e));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (data) req.write(data);
      req.end();
    });
  }
}
