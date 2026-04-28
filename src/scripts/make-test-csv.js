/**
 * Sinh CSV mẫu cho smoke test Phase 5.
 *
 * Dùng:
 *   node scripts/make-test-csv.js                       # 100 dòng đẹp
 *   node scripts/make-test-csv.js --rows=10000          # 10K dòng
 *   node scripts/make-test-csv.js --bad-header          # header sai
 *   node scripts/make-test-csv.js --partial             # 5% dòng lỗi
 *   node scripts/make-test-csv.js --out=path/file.csv   # đường dẫn out
 *
 * Mặc định out = `apps/backend/data/csv-drop/students_<NOW>.csv`.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).reduce((acc, raw) => {
  const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] ?? true;
  return acc;
}, {});

const rows = Number(args.rows ?? 100);
const partial = Boolean(args.partial);
const badHeader = Boolean(args['bad-header']);
const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .replace(/\..+/, '')
  .slice(0, 15); // YYYYMMDD_HHMMSS-ish; service regex yêu cầu YYYYMMDD_HHMMSS
const tag = stamp.slice(0, 8) + '_' + stamp.slice(8, 14);
const defaultOut = path.join(
  __dirname,
  '..',
  'apps',
  'backend',
  'data',
  'csv-drop',
  `students_${tag}.csv`,
);
const outPath = args.out ? path.resolve(args.out) : defaultOut;

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const header = badHeader
  ? 'student_code,full_name,WRONG,faculty,cohort,is_active'
  : 'student_code,full_name,email,faculty,cohort,is_active';

const lines = [header];
for (let i = 0; i < rows; i++) {
  const code = (21120000 + i + 1).toString().padStart(8, '0');
  const name = `Sinh viên ${i + 1}`;
  const isPartialErr = partial && i % 20 === 0;
  const email = isPartialErr ? 'not-an-email' : `sv${i + 1}@student.edu.vn`;
  const faculty = ['CNTT', 'KTPM', 'KHMT'][i % 3];
  const cohort = 2020 + (i % 5);
  const active = i % 7 === 0 ? 'false' : 'true';
  lines.push(`${code},"${name}",${email},${faculty},${cohort},${active}`);
}

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${rows} rows → ${outPath}`);
console.log(`Header valid: ${!badHeader}; partial errors: ${partial}`);
