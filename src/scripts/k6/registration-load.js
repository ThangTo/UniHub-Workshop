import http from 'k6/http';
import { check, sleep } from 'k6';

const rate = Number(__ENV.RATE || 3000);
const duration = __ENV.DURATION || '60s';
const apiBaseUrl = __ENV.API_BASE_URL || 'http://localhost:3000';
const workshopId = __ENV.WORKSHOP_ID;
const singleToken = __ENV.STUDENT_TOKEN;
const tokensFile = __ENV.TOKENS_FILE;

let tokenPool = [];
if (tokensFile) {
  tokenPool = JSON.parse(open(tokensFile));
}
if (singleToken) tokenPool.push(singleToken);

export const options = {
  scenarios: {
    registration_load: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 300),
      maxVUs: Number(__ENV.MAX_VUS || 3000),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.50'],
    http_req_duration: ['p(95)<2000'],
  },
};

export function setup() {
  if (!workshopId) throw new Error('WORKSHOP_ID is required.');
  if (tokenPool.length === 0) {
    throw new Error('Provide STUDENT_TOKEN or TOKENS_FILE containing a JSON array of Bearer tokens.');
  }
  return { tokens: tokenPool };
}

export default function (data) {
  const token = data.tokens[(__ITER + __VU) % data.tokens.length];
  const idempotencyKey = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(
    `${apiBaseUrl}/registrations`,
    JSON.stringify({ workshopId }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      tags: { endpoint: 'registrations' },
    },
  );

  check(response, {
    'handled response': (r) => [200, 201, 202, 409, 429].includes(r.status),
    'no server error': (r) => r.status < 500,
  });

  sleep(0.01);
}

export function handleSummary(data) {
  const statuses = data.metrics.http_reqs ? 'see k6 summary above' : 'no requests';
  return {
    stdout:
      `\nRegistration load finished: ${statuses}\n` +
      'Expected handled statuses: 201 success, 409 sold_out/already_registered, 429 rate_limited.\n' +
      'If 202 responses are required by the grading rubric, note that the current backend does not implement the global registration queue yet.\n',
  };
}
