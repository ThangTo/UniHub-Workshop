/**
 * Extract text từ PDF buffer dùng pdfjs-dist legacy build (CommonJS).
 *
 * Tránh `pdf-parse@1.1.4` vì pdfjs nhúng (2017) báo `bad XRef entry` với
 * nhiều PDF hợp lệ sinh từ pdfkit/word/...; pdfjs-dist v3 ổn định hơn nhiều.
 *
 * Trả raw text. Caller chịu trách nhiệm cleanText + word-count check.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean; isEvalSupported?: boolean }) => {
    promise: Promise<PdfDocument>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}
interface PdfPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
  cleanup: () => void;
}

// Disable worker — chạy main thread (Nest backend không có worker_threads pool).
pdfjs.GlobalWorkerOptions.workerSrc = '';

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdfjs cần Uint8Array (không phải Node Buffer) — copy view.
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str ?? '').join(' ');
      pageTexts.push(text);
      page.cleanup();
    }
    return pageTexts.join('\n');
  } finally {
    await doc.destroy().catch(() => {});
  }
}
