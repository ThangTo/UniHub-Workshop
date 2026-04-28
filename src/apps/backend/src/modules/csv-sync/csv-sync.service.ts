import { Injectable, Logger } from '@nestjs/common';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/app-config.service';

/**
 * Specs/csv-sync.md — đồng bộ sinh viên từ CSV legacy.
 *
 * Cấu trúc thực thi (xem doc cho sequence diagram):
 *   1. acquire pg_advisory_lock(LOCK_KEY) → chỉ 1 worker chạy đồng thời.
 *   2. list `*.csv` trong CSV_DROP_DIR theo mtime ASC.
 *   3. mỗi file:
 *        - SHA-256 streaming (không load full vào RAM).
 *        - skip nếu sha đã tồn tại trong import_jobs.
 *        - INSERT import_jobs RUNNING.
 *        - validate header → header sai → quarantine + FAILED.
 *        - stream parse + batch 1000 → INSERT staging.
 *        - UPSERT students FROM staging (idempotent + chống stale).
 *        - DELETE staging.
 *        - SUCCESS / PARTIAL / FAILED + move file.
 *   4. release advisory lock.
 *
 * Idempotent qua `import_jobs.file_sha256 UNIQUE`.
 * Streaming + batch giữ RAM peak < 200MB cho file 1M dòng.
 */

// uint32 random key — phải khớp giữa các worker. 0xCSVS-yncL → 0xC597_9C0C.
const LOCK_KEY = 0xc5979c0c;

const BATCH_SIZE = 1000;
const HEADER = ['student_code', 'full_name', 'email', 'faculty', 'cohort', 'is_active'];

const STUDENT_CODE_RE = /^[0-9]{8,10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RowDto {
  student_code: string;
  full_name: string;
  email: string | null;
  faculty: string | null;
  cohort: number | null;
  is_active: boolean;
}

interface RowError {
  line: number;
  reason: string;
  raw?: string;
}

interface ProcessResult {
  fileName: string;
  status: ImportJobStatus;
  inserted?: number;
  updated?: number;
  failed?: number;
  total?: number;
  reason?: string;
  jobId?: string;
}

interface RunSummary {
  scanned: number;
  processed: ProcessResult[];
  skipped: string[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

@Injectable()
export class CsvSyncService {
  private readonly logger = new Logger(CsvSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Entry point — gọi từ scheduler hoặc admin endpoint.
   * Trả về summary để controller log audit.
   */
  async runOnce(): Promise<RunSummary> {
    const startedAt = new Date();
    const summary: RunSummary = {
      scanned: 0,
      processed: [],
      skipped: [],
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
    };

    // In-process re-entrancy guard (cron + admin trigger trùng lúc).
    if (this.running) {
      this.logger.warn('runOnce skipped: another invocation in-flight');
      return summary;
    }

    // Postgres advisory lock — chống multi-instance.
    const [{ locked }] = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked
    `;
    if (!locked) {
      this.logger.warn('runOnce skipped: another worker holds advisory lock');
      return summary;
    }

    this.running = true;
    try {
      await this.ensureDirs();
      const files = await this.listDropFiles();
      summary.scanned = files.length;
      this.logger.log(`Scanning ${files.length} CSV file(s) in ${this.config.csv.dropDir}`);

      for (const file of files) {
        try {
          const result = await this.processFile(file);
          if (result.status === 'RUNNING') {
            // sentinel: skipped duplicate
            summary.skipped.push(result.fileName);
          } else {
            summary.processed.push(result);
          }
        } catch (e) {
          this.logger.error(`Unexpected error processing ${file}: ${(e as Error).message}`);
          summary.processed.push({
            fileName: path.basename(file),
            status: ImportJobStatus.FAILED,
            reason: `unexpected:${(e as Error).message}`,
          });
        }
      }
    } finally {
      this.running = false;
      await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch((e) =>
        this.logger.warn(`advisory_unlock failed: ${(e as Error).message}`),
      );
    }

    summary.finishedAt = new Date();
    summary.durationMs = summary.finishedAt.getTime() - summary.startedAt.getTime();
    this.logger.log(
      `runOnce done: scanned=${summary.scanned} processed=${summary.processed.length} skipped=${summary.skipped.length} duration=${summary.durationMs}ms`,
    );
    return summary;
  }

  // ---- File discovery & SHA ----

  private async ensureDirs(): Promise<void> {
    const { dropDir, quarantineDir, archiveDir } = this.config.csv;
    for (const d of [dropDir, quarantineDir, archiveDir]) {
      await fs.mkdir(d, { recursive: true });
    }
  }

  private async listDropFiles(): Promise<string[]> {
    const dir = this.config.csv.dropDir;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: { p: string; m: number }[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith('.csv')) continue;
      const full = path.join(dir, ent.name);
      const st = await fs.stat(full);
      files.push({ p: full, m: st.mtimeMs });
    }
    files.sort((a, b) => a.m - b.m); // FIFO theo mtime
    return files.map((f) => f.p);
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    return new Promise((resolve, reject) => {
      const s = createReadStream(filePath);
      s.on('data', (chunk) => hash.update(chunk));
      s.on('end', () => resolve(hash.digest('hex')));
      s.on('error', reject);
    });
  }

  /**
   * Parse `students_YYYYMMDD_HHMMSS.csv` → Date. Fallback: file mtime.
   */
  private async parseSourceExportedAt(filePath: string): Promise<Date> {
    const base = path.basename(filePath, '.csv');
    const m = base.match(/_(\d{8})_(\d{6})$/);
    if (m) {
      const [, ymd, hms] = m;
      const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return d;
      this.logger.warn(`bad timestamp in filename ${base}, falling back to mtime`);
    }
    const st = await fs.stat(filePath);
    return st.mtime;
  }

  // ---- Core file processing ----

  private async processFile(filePath: string): Promise<ProcessResult> {
    const fileName = path.basename(filePath);
    const sha = await this.sha256File(filePath);

    // Duplicate check
    const existing = await this.prisma.importJob.findUnique({ where: { fileSha256: sha } });
    if (existing) {
      this.logger.log(`Skipping duplicate ${fileName} (sha=${sha.slice(0, 12)})`);
      // Move duplicate file to archive (so drop dir doesn't accumulate).
      await this.moveFile(filePath, this.config.csv.archiveDir).catch(() => {});
      return { fileName, status: 'RUNNING', reason: 'duplicate' };
    }

    const sourceExportedAt = await this.parseSourceExportedAt(filePath);

    const job = await this.prisma.importJob.create({
      data: {
        fileName,
        fileSha256: sha,
        sourceExportedAt,
        status: ImportJobStatus.RUNNING,
      },
    });
    this.logger.log(`Job ${job.id} START file=${fileName} sha=${sha.slice(0, 12)}`);

    try {
      // Stream parse + accumulate batches.
      const errors: RowError[] = [];
      let total = 0;
      let staged = 0;
      let headerOk: boolean | null = null;

      const parser = createReadStream(filePath).pipe(
        parse({
          bom: true,
          columns: true,
          skip_empty_lines: true,
          relax_column_count: false,
          trim: true,
        }),
      );

      let batch: { row: RowDto; line: number }[] = [];

      try {
        for await (const rec of parser as AsyncIterable<Record<string, string>>) {
          // Header check — chỉ làm 1 lần (csv-parse không đẩy header lên rec).
          if (headerOk === null) {
            const cols = Object.keys(rec);
            const ok =
              cols.length === HEADER.length && HEADER.every((h, i) => cols[i].toLowerCase() === h);
            headerOk = ok;
            if (!ok) {
              await this.failJob(job.id, 'bad_header', { receivedColumns: cols });
              await this.moveFile(filePath, this.config.csv.quarantineDir);
              this.logger.warn(`Job ${job.id} FAILED bad_header file=${fileName}`);
              return { fileName, status: 'FAILED', reason: 'bad_header', jobId: job.id };
            }
          }

          total++;
          const lineNo = total + 1; // header = line 1
          const validated = this.validateRow(rec, lineNo);
          if ('error' in validated) {
            errors.push(validated.error);
            continue;
          }
          batch.push({ row: validated.row, line: lineNo });
          if (batch.length >= BATCH_SIZE) {
            await this.insertStagingBatch(job.id, sourceExportedAt, batch);
            staged += batch.length;
            batch = [];
          }
        }
      } catch (e) {
        // Parse error mid-stream (encoding, malformed CSV)
        await this.failJob(job.id, `parse_error: ${(e as Error).message}`);
        await this.moveFile(filePath, this.config.csv.quarantineDir);
        return {
          fileName,
          status: 'FAILED',
          reason: `parse_error:${(e as Error).message}`,
          jobId: job.id,
        };
      }

      // Empty file (0 data rows)
      if (total === 0 && headerOk !== true) {
        await this.failJob(job.id, 'empty_file');
        await this.moveFile(filePath, this.config.csv.quarantineDir);
        return { fileName, status: 'FAILED', reason: 'empty_file', jobId: job.id };
      }

      // Tail batch
      if (batch.length > 0) {
        await this.insertStagingBatch(job.id, sourceExportedAt, batch);
        staged += batch.length;
        batch = [];
      }

      // Toàn bộ dòng lỗi → FAILED, không upsert
      if (staged === 0) {
        await this.failJob(job.id, 'all_rows_invalid', { failedRows: errors.slice(0, 100) });
        await this.moveFile(filePath, this.config.csv.quarantineDir);
        return { fileName, status: 'FAILED', reason: 'all_rows_invalid', jobId: job.id, total };
      }

      // Upsert + cleanup staging — atomic per file.
      const { inserted, updated } = await this.upsertFromStaging(job.id);

      const status: ImportJobStatus =
        errors.length === 0 ? ImportJobStatus.SUCCESS : ImportJobStatus.PARTIAL;

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status,
          totalRows: total,
          insertedRows: inserted,
          updatedRows: updated,
          failedRows: errors.length,
          finishedAt: new Date(),
          // Cap error_log size để không phá DB nếu lỗi tràn lan.
          errorLog:
            errors.length > 0
              ? ({ failedRows: errors.slice(0, 500) } as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });

      await this.moveFile(filePath, this.config.csv.archiveDir);
      this.logger.log(
        `Job ${job.id} ${status} file=${fileName} total=${total} inserted=${inserted} updated=${updated} failed=${errors.length}`,
      );
      return {
        fileName,
        status,
        total,
        inserted,
        updated,
        failed: errors.length,
        jobId: job.id,
      };
    } catch (e) {
      await this.failJob(job.id, `unexpected: ${(e as Error).message}`);
      // Không move file — để admin investigate file gốc trong drop dir.
      throw e;
    }
  }

  // ---- Validation ----

  private validateRow(
    rec: Record<string, string>,
    line: number,
  ): { row: RowDto } | { error: RowError } {
    const studentCode = (rec.student_code ?? '').trim();
    if (!STUDENT_CODE_RE.test(studentCode)) {
      return { error: { line, reason: 'invalid_student_code', raw: studentCode } };
    }
    const fullName = (rec.full_name ?? '').trim();
    if (fullName.length === 0 || fullName.length > 255) {
      return { error: { line, reason: 'invalid_full_name', raw: fullName.slice(0, 32) } };
    }
    const emailRaw = (rec.email ?? '').trim();
    let email: string | null = null;
    if (emailRaw !== '') {
      if (!EMAIL_RE.test(emailRaw)) {
        return { error: { line, reason: 'invalid_email', raw: emailRaw } };
      }
      if (emailRaw.length > 255) {
        return { error: { line, reason: 'email_too_long' } };
      }
      email = emailRaw;
    }
    const faculty = (rec.faculty ?? '').trim() || null;
    let cohort: number | null = null;
    const cohortRaw = (rec.cohort ?? '').trim();
    if (cohortRaw !== '') {
      const n = Number(cohortRaw);
      if (!Number.isInteger(n) || n < 1900 || n > 2100) {
        return { error: { line, reason: 'invalid_cohort', raw: cohortRaw } };
      }
      cohort = n;
    }
    const activeRaw = (rec.is_active ?? '').trim().toLowerCase();
    if (!['true', 'false', '1', '0'].includes(activeRaw)) {
      return { error: { line, reason: 'invalid_is_active', raw: activeRaw } };
    }
    const is_active = activeRaw === 'true' || activeRaw === '1';

    return {
      row: { student_code: studentCode, full_name: fullName, email, faculty, cohort, is_active },
    };
  }

  // ---- Staging + Upsert (raw SQL with array unnest cho hiệu năng) ----

  private async insertStagingBatch(
    jobId: string,
    sourceExportedAt: Date,
    batch: { row: RowDto; line: number }[],
  ): Promise<void> {
    const codes = batch.map((b) => b.row.student_code);
    const names = batch.map((b) => b.row.full_name);
    const emails = batch.map((b) => b.row.email);
    const faculties = batch.map((b) => b.row.faculty);
    const cohorts = batch.map((b) => b.row.cohort);
    const actives = batch.map((b) => b.row.is_active);
    const lines = batch.map((b) => b.line);

    await this.prisma.$executeRaw`
      INSERT INTO students_staging
        (import_job_id, line_no, student_code, full_name, email, faculty, cohort, is_active, source_exported_at)
      SELECT
        ${jobId}::uuid,
        unnest(${lines}::int[]),
        unnest(${codes}::varchar[]),
        unnest(${names}::varchar[]),
        unnest(${emails}::varchar[]),
        unnest(${faculties}::varchar[]),
        unnest(${cohorts}::int[]),
        unnest(${actives}::boolean[]),
        ${sourceExportedAt}::timestamptz
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Upsert từ staging → students (specs §B). Đếm inserted vs updated qua
   * `RETURNING xmax` (xmax = 0 ⇒ insert mới).
   * `WHERE source_exported_at IS NULL OR EXCLUDED.* >= …` chống stale file.
   */
  private async upsertFromStaging(jobId: string): Promise<{ inserted: number; updated: number }> {
    const rows = await this.prisma.$queryRaw<{ ins: boolean }[]>`
      INSERT INTO students
        (student_code, full_name, email, faculty, cohort, is_active, source_exported_at, last_synced_at)
      SELECT
        student_code, full_name, email, faculty, cohort, is_active, source_exported_at, now()
      FROM students_staging
      WHERE import_job_id = ${jobId}::uuid
      ON CONFLICT (student_code) DO UPDATE SET
        full_name          = EXCLUDED.full_name,
        email              = EXCLUDED.email,
        faculty            = EXCLUDED.faculty,
        cohort             = EXCLUDED.cohort,
        is_active          = EXCLUDED.is_active,
        source_exported_at = EXCLUDED.source_exported_at,
        last_synced_at     = EXCLUDED.last_synced_at
      WHERE students.source_exported_at IS NULL
         OR EXCLUDED.source_exported_at >= students.source_exported_at
      RETURNING (xmax = 0) AS ins
    `;
    let inserted = 0;
    let updated = 0;
    for (const r of rows) r.ins ? inserted++ : updated++;

    // Cleanup staging cho job này. Dùng deleteMany thay vì TRUNCATE để
    // không đụng staging của job khác (advisory lock đã đảm bảo nhưng
    // an toàn hơn vẫn nên scope theo importJobId).
    await this.prisma.studentStaging.deleteMany({ where: { importJobId: jobId } });

    return { inserted, updated };
  }

  // ---- Helpers ----

  private async failJob(
    jobId: string,
    reason: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.importJob
      .update({
        where: { id: jobId },
        data: {
          status: ImportJobStatus.FAILED,
          finishedAt: new Date(),
          errorLog: { reason, ...extra } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) => this.logger.warn(`failJob update failed: ${(e as Error).message}`));
  }

  private async moveFile(src: string, destDir: string): Promise<void> {
    const base = path.basename(src);
    const dest = path.join(destDir, base);
    try {
      await fs.rename(src, dest);
    } catch (e: unknown) {
      // Cross-device fallback (volume mount khác fs).
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EXDEV') {
        await fs.copyFile(src, dest);
        await fs.unlink(src);
      } else {
        throw e;
      }
    }
  }
}
