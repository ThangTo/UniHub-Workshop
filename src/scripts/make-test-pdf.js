/**
 * Generate a small valid PDF (~150 từ tiếng Anh) để smoke test AI summary worker.
 * Chạy: node src/scripts/make-test-pdf.js [outFile]
 *
 * Yêu cầu: pdfkit cài ở apps/backend/node_modules (đã add devDep).
 */
const path = require('path');
const fs = require('fs');

// Reuse pdfkit từ backend devDeps
const PDFDocument = require(path.resolve(__dirname, '../apps/backend/node_modules/pdfkit'));

const out = process.argv[2] || path.join(__dirname, 'test-workshop.pdf');

const lines = [
  'Workshop on Distributed Systems Architecture',
  'This session covers core principles of CAP theorem in depth.',
  'Topics include consistency models, eventual consistency, and quorum systems.',
  'Students explore replication strategies for high availability and fault tolerance.',
  'Microservices architecture patterns are demonstrated with live coding examples.',
  'Event-driven systems with message queues such as RabbitMQ and Kafka are explained.',
  'Hands-on labs use Docker Compose to spin up Redis, Postgres, and a sample API.',
  'Participants build a small distributed counter system using optimistic concurrency control.',
  'Failure modes such as network partitions and split brain are simulated and analyzed.',
  'Circuit breakers, retries, and exponential backoff are implemented from scratch.',
  'Observability with metrics, distributed traces, and structured logs is covered thoroughly.',
  'OpenTelemetry instrumentation is added to sample services to expose internal behavior.',
  'Database sharding strategies for read and write scaling are reviewed with case studies.',
  'Consensus protocols Raft and Paxos receive an overview with focus on leader election.',
  'Deployment strategies blue-green, canary, and shadow traffic are reviewed in real scenarios.',
  'Performance tuning techniques for low latency endpoints are discussed using profilers.',
  'A live question-and-answer segment with the speaker closes the session interactively.',
  'Bring your laptop with Docker Desktop installed and at least eight gigabytes of RAM.',
  'Prior knowledge of HTTP semantics and TCP networking is helpful but not strictly required.',
  'Reading list, slides, and source code repository are shared via email after the workshop.',
  'A certificate of attendance is issued to participants upon completion of all exercises.',
];

const doc = new PDFDocument({ size: 'A4', margin: 60 });
doc.pipe(fs.createWriteStream(out));
doc.fontSize(18).text('UniHub Workshop — Distributed Systems', { align: 'center' });
doc.moveDown();
doc.fontSize(11);
for (const line of lines) {
  doc.text(line);
  doc.moveDown(0.3);
}
doc.end();

doc.on('end', () => {});
setTimeout(() => {
  const stat = fs.statSync(out);
  const text = lines.join(' ');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  console.log(`PDF written: ${out} (${stat.size} bytes, ~${wordCount} words)`);
}, 200);
