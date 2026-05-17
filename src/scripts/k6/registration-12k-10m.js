import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';

const apiBaseUrl = __ENV.API_BASE_URL || 'http://localhost:3000';
const workshopId = __ENV.WORKSHOP_ID;
const singleToken = __ENV.STUDENT_TOKEN;
const tokensFile = __ENV.TOKENS_FILE;
const burstExpectedIterations = Number(__ENV.BURST_EXPECTED_ITERATIONS || 7200);

let tokenPool = [];
if (tokensFile) {
  tokenPool = JSON.parse(open(tokensFile));
}
if (singleToken) tokenPool.push(singleToken);

const handledResponses = new Rate('registration_handled_response');
const unexpectedServerErrors = new Counter('registration_unexpected_5xx');
const success201 = new Counter('registration_201_created');
const queued202 = new Counter('registration_202_queued');
const conflict409 = new Counter('registration_409_conflict');
const rateLimited429 = new Counter('registration_429_rate_limited');
const queueFull503 = new Counter('registration_503_queue_full');

export const options = {
  scenarios: {
    first_3_minutes_burst: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.BURST_RATE || 40),
      timeUnit: '1s',
      duration: __ENV.BURST_DURATION || '3m',
      preAllocatedVUs: Number(__ENV.BURST_PREALLOCATED_VUS || 250),
      maxVUs: Number(__ENV.BURST_MAX_VUS || 1000),
      exec: 'register',
    },
    remaining_7_minutes: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.TAIL_RATE || 80),
      timeUnit: __ENV.TAIL_TIME_UNIT || '7s',
      duration: __ENV.TAIL_DURATION || '7m',
      startTime: __ENV.TAIL_START_TIME || '3m',
      preAllocatedVUs: Number(__ENV.TAIL_PREALLOCATED_VUS || 120),
      maxVUs: Number(__ENV.TAIL_MAX_VUS || 600),
      exec: 'register',
    },
  },
  thresholds: {
    registration_handled_response: ['rate>0.95'],
    registration_unexpected_5xx: ['count<20'],
    http_req_duration: ['p(95)<2000'],
  },
};

export function setup() {
  if (!workshopId) throw new Error('WORKSHOP_ID is required.');
  if (tokenPool.length === 0) {
    throw new Error('Provide STUDENT_TOKEN or TOKENS_FILE containing a JSON array of Bearer tokens.');
  }
  if (tokenPool.length === 1) {
    console.warn(
      'Only one STUDENT_TOKEN was provided. This tests API overload protection, but not fairness between different students. Use TOKENS_FILE for fairness evidence.',
    );
  }
  if (tokenPool.length < 12000) {
    console.warn(`TOKENS_FILE has ${tokenPool.length} tokens. Use 12000 tokens for the 12K fairness demo.`);
  }
  return { tokens: tokenPool };
}

export function register(data) {
  const tokenIndex = tokenIndexForCurrentIteration(data.tokens.length);
  const token = data.tokens[tokenIndex];
  if (__ENV.DEBUG_REGISTRATION === '1' && __ITER < 2) {
    console.error(
      `token index=${tokenIndex} length=${String(token).length} sha256=${crypto.sha256(String(token), 'hex')} prefix=${String(token).slice(0, 24)} suffix=${String(token).slice(-24)}`,
    );
  }
  const idempotencyKey = `k6-12k-${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(
    `${apiBaseUrl}/registrations`,
    JSON.stringify({ workshopId }),
    {
      headers: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      tags: { endpoint: 'registrations_12k_10m' },
    },
  );

  recordStatus(response);

  const handled = isHandledRegistrationResponse(response);
  if (!handled && __ENV.DEBUG_REGISTRATION === '1') {
    console.error(`unhandled registration response: status=${response.status} body=${String(response.body || '').slice(0, 500)}`);
  }
  handledResponses.add(handled);
  if (response.status >= 500 && !isQueueFull(response)) {
    unexpectedServerErrors.add(1);
  }

  check(response, {
    'handled registration response': () => handled,
    'no unexpected server error': (r) => r.status < 500 || isQueueFull(r),
  });

  sleep(0.01);
}

function tokenIndexForCurrentIteration(tokenCount) {
  const iteration = exec.scenario.iterationInTest;
  const offset = exec.scenario.name === 'remaining_7_minutes' ? burstExpectedIterations : 0;
  return (offset + iteration) % tokenCount;
}

function recordStatus(response) {
  if (response.status === 201) success201.add(1);
  else if (response.status === 202) queued202.add(1);
  else if (response.status === 409) conflict409.add(1);
  else if (response.status === 429) rateLimited429.add(1);
  else if (isQueueFull(response)) queueFull503.add(1);
}

function isHandledRegistrationResponse(response) {
  return [200, 201, 202, 409, 429].includes(response.status) || isQueueFull(response);
}

function isQueueFull(response) {
  return response.status === 503 && String(response.body || '').includes('registration_queue_full');
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs?.values?.count ?? 0;
  return {
    stdout:
      `\n12K/10m registration load finished.\n` +
      `Target shape: 7,200 requests in first 3 minutes, 4,800 requests in next 7 minutes.\n` +
      `Observed total HTTP requests: ${totalRequests}\n\n` +
      `Expected protection signals:\n` +
      `- 201: registration accepted immediately\n` +
      `- 202: queued fairly under global overload\n` +
      `- 409: sold_out or already_registered, handled business conflict\n` +
      `- 429: per-user/per-client rate limiting\n` +
      `- 503 registration_queue_full: controlled capacity signal, not backend crash\n\n`,
  };
}
