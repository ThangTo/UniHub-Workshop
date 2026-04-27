/**
 * Mock AI Provider — mô phỏng nhà cung cấp AI cho UniHub Workshop.
 *
 * Endpoints:
 *   POST /summarize    — sinh tóm tắt + highlights từ text
 *   GET  /health       — health check
 *
 * Hành vi mô phỏng (specs/ai-summary.md §Kịch bản lỗi):
 *   - Latency: random 300-1500ms
 *   - 8% failure (model_overloaded)
 *   - 4% timeout (sleep > 30s, làm worker timeout)
 *   - MOCK_AI_DOWN=true → trả 503 hết
 *   - MOCK_AI_FAIL_ALWAYS=true → trả 500 hết
 *
 * Output: summary 200-300 từ + 5 highlights bullet points,
 *   sinh deterministic theo nội dung input để dễ test.
 */
import express, { Request, Response } from 'express';
import * as crypto from 'crypto';

const PORT = Number(process.env.PORT ?? 4100);
const MODEL = process.env.MODEL_NAME ?? 'mock-ai-v1';

const app = express();
app.use(express.json({ limit: '4mb' }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDown = () => process.env.MOCK_AI_DOWN === 'true';
const failAlways = () => process.env.MOCK_AI_FAIL_ALWAYS === 'true';

app.get('/health', (_req, res) => {
  res.json({ ok: !isDown() && !failAlways(), down: isDown(), failAlways: failAlways(), model: MODEL });
});

/**
 * POST /summarize
 * body: { text: string, maxWords?: number, language?: string }
 * resp: { summary, highlights[5], model, tokens }
 */
app.post('/summarize', async (req: Request, res: Response) => {
  if (isDown()) {
    res.status(503).json({ error: 'ai_unavailable' });
    return;
  }
  if (failAlways()) {
    res.status(500).json({ error: 'model_overloaded' });
    return;
  }

  const { text, maxWords } = req.body ?? {};
  if (typeof text !== 'string' || text.length < 50) {
    res.status(400).json({ error: 'text_too_short' });
    return;
  }

  // Latency simulation
  const latencyMs = 300 + Math.floor(Math.random() * 1200);
  await sleep(latencyMs);

  // 4% timeout — sleep dài để worker bị timeout
  if (Math.random() < 0.04) {
    await sleep(35000);
  }

  // 8% transient failure
  if (Math.random() < 0.08) {
    res.status(500).json({ error: 'model_overloaded' });
    return;
  }

  const summary = generateSummary(text, maxWords ?? 280);
  const highlights = generateHighlights(text);

  res.json({
    summary,
    highlights,
    model: MODEL,
    tokens: Math.ceil(text.length / 4),
    latencyMs,
  });
});

/** Generate deterministic mock summary. Lấy 3 câu đầu + đệm cho đủ 200-300 từ. */
function generateSummary(text: string, maxWords: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 50000);
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, 6);

  const opener = 'Workshop này tập trung vào các chủ đề thực hành, mang lại giá trị thiết thực cho sinh viên.';
  const closer =
    'Nội dung được thiết kế kết hợp lý thuyết và thực hành, phù hợp cho sinh viên muốn nâng cao kỹ năng và mở rộng cơ hội nghề nghiệp.';

  let body = sentences.join(' ');
  if (body.length === 0) body = 'Workshop cung cấp kiến thức tổng quan và thực hành theo chủ đề chuyên sâu.';

  const combined = `${opener} ${body} ${closer}`;
  const words = combined.split(/\s+/);
  const minWords = Math.max(200, Math.min(220, maxWords - 60));
  const targetWords = Math.min(maxWords, Math.max(minWords, words.length));
  const truncated = words.slice(0, targetWords).join(' ');

  // Đảm bảo tối thiểu 200 từ bằng padding mô tả chung
  if (truncated.split(/\s+/).length < 200) {
    const padding =
      ' Sinh viên tham dự sẽ được hướng dẫn bởi diễn giả có kinh nghiệm thực tế trong ngành, có cơ hội thực hành trực tiếp với các bài tập tình huống và nhận feedback ngay tại buổi học. Đây là cơ hội tốt để mở rộng mạng lưới chuyên môn, kết nối cùng các bạn cùng quan tâm đến lĩnh vực và xây dựng portfolio cá nhân thông qua các sản phẩm thực tế ngay sau buổi workshop.';
    return (truncated + padding).split(/\s+/).slice(0, maxWords).join(' ');
  }
  return truncated;
}

/** Generate 5 deterministic highlights from text content using SHA hash for variety. */
function generateHighlights(text: string): string[] {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const seed = parseInt(hash.slice(0, 8), 16);
  const pool = [
    'Tổng quan kiến thức nền tảng và xu hướng mới nhất trong lĩnh vực',
    'Demo trực tiếp công cụ và quy trình làm việc thực tế của ngành',
    'Bài tập tình huống có hướng dẫn từ diễn giả',
    'Q&A trực tiếp với chuyên gia về roadmap nghề nghiệp',
    'Kết nối networking với cộng đồng cùng chuyên ngành',
    'Tài liệu tham khảo và mẫu source code được chia sẻ sau buổi học',
    'Chứng chỉ tham dự ghi nhận giờ học cộng đồng',
    'Case study từ doanh nghiệp đối tác',
  ];
  // Deterministic shuffle dựa trên hash
  const shuffled = [...pool].sort((a, b) => {
    const ha = parseInt(crypto.createHash('md5').update(a + seed).digest('hex').slice(0, 8), 16);
    const hb = parseInt(crypto.createHash('md5').update(b + seed).digest('hex').slice(0, 8), 16);
    return ha - hb;
  });
  return shuffled.slice(0, 5);
}

app.listen(PORT, () => {
  console.log(`[mock-ai] listening on :${PORT}, model=${MODEL}`);
});
