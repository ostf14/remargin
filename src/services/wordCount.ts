import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ePub, { type Book as EpubBook } from 'epubjs';
import type { BookFormat } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const WORDS_PER_MINUTE = 250;

function wordsIn(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// Count words from an already-open PDF document (caller owns its lifecycle).
export async function countPdfWords(pdf: PDFDocumentProxy): Promise<number> {
  let total = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    total += wordsIn(tc.items.map((it) => ('str' in it ? (it as { str: string }).str : '')).join(' '));
  }
  return total;
}

// Count words from an already-open EPUB (caller owns its lifecycle).
export async function countEpubWords(epub: EpubBook): Promise<number> {
  let total = 0;
  for (const item of epub.spine.spineItems) {
    try {
      const contents = await item.load(epub.load.bind(epub));
      total += wordsIn((contents as { textContent?: string | null })?.textContent ?? '');
    } catch {
      /* skip an unreadable section */
    } finally {
      item.unload();
    }
  }
  return total;
}

// Open a freshly-imported file just long enough to count its words.
export async function countWordsFromData(format: BookFormat, data: ArrayBuffer): Promise<number> {
  if (format === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
    const n = await countPdfWords(pdf);
    await pdf.cleanup();
    return n;
  }
  const epub = ePub(data.slice(0));
  await epub.ready;
  const n = await countEpubWords(epub);
  epub.destroy();
  return n;
}

export function readingMinutes(words: number): number {
  return Math.round(words / WORDS_PER_MINUTE);
}

// "3h 20m" / "45m" / "<1m"
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
