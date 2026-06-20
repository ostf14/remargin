import ePub, { type Book as EpubBook } from 'epubjs';
import type { BookFormat } from '../types';

const WORDS_PER_MINUTE = 250;

function wordsIn(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
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

// Open a freshly-imported file just long enough to count its words. PDF imports are
// blocked upstream, so this only sees EPUBs — but the `format` argument stays so
// useImport can keep its single-entry-point shape.
export async function countWordsFromData(format: BookFormat, data: ArrayBuffer): Promise<number> {
  if (format !== 'epub') return 0;
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
