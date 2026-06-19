import { useCallback, useState } from 'react';
import type { Book } from '../types';
import { parseEpub } from '../services/epubParser';
import { parsePdf } from '../services/pdfParser';
import { fetchBookMetadata } from '../services/googleBooks';
import { fetchOpenLibraryCover } from '../services/openLibrary';
import { countWordsFromData } from '../services/wordCount';
import { saveBookFile } from '../services/storage';
import { useLibrary } from './useLibrary';

const titleIsBad = (b: Book) => {
  const t = b.title.trim().toLowerCase();
  return !t || t === 'untitled';
};
const authorIsBad = (b: Book) => {
  const a = b.author.trim();
  return !a || a === 'Unknown Author';
};
// A `data:` cover is the PDF parser's first-page placeholder — upgradeable to a real
// publisher cover. An EPUB embedded cover is also a data URL but counts as real (its
// format is 'epub'), so we only treat PDF data covers as placeholders.
const isPlaceholderCover = (b: Book) =>
  b.format === 'pdf' && !!b.coverUrl && b.coverUrl.startsWith('data:');
const needsCover = (b: Book) => !b.coverUrl || isPlaceholderCover(b);

// Same title + author (case-insensitive) counts as the same book already in the library.
const sameBook = (a: Book, b: Book) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.author.trim().toLowerCase() === b.author.trim().toLowerCase();

// Shared import pipeline: parse → persist → add to library → enrich metadata async.
// Used by the header "+" / empty-state buttons and the global drag-and-drop.
export function useImport() {
  const { books, addBook, patchBook, setEnriching } = useLibrary();
  const [importing, setImporting] = useState(false);

  // Fill missing author/cover from Google Books → Open Library. Never blocks, never
  // throws. A PDF parser placeholder cover (data: URL) counts as "needs upgrade" so we
  // still query — the placeholder stays in place if the network finds nothing better.
  const enrich = useCallback(
    async (book: Book) => {
      if (titleIsBad(book) || (!authorIsBad(book) && !needsCover(book))) return;
      setEnriching(book.id, true);
      try {
        const meta = await fetchBookMetadata(book.title, authorIsBad(book) ? undefined : book.author);
        const updates: Partial<Book> = {};
        if (authorIsBad(book) && meta.author) updates.author = meta.author;

        let cover = needsCover(book) ? meta.coverUrl : undefined;
        // Google's keyless quota 429s easily and not every volume has imageLinks —
        // fall back to Open Library (keyless, far more lenient) for a cover.
        if (needsCover(book) && !cover) {
          const bestAuthor = authorIsBad(book) ? meta.author : book.author;
          cover = await fetchOpenLibraryCover(book.title, bestAuthor);
        }
        if (cover) updates.coverUrl = cover;
        if (Object.keys(updates).length) patchBook(book.id, updates);
      } finally {
        setEnriching(book.id, false);
      }
    },
    [patchBook, setEnriching],
  );

  // Count words for the reading-time estimate — async, never blocks the import.
  const countWords = useCallback(
    async (book: Book, data: ArrayBuffer) => {
      try {
        const words = await countWordsFromData(book.format, data);
        if (words > 0) patchBook(book.id, { wordCount: words });
      } catch {
        /* leave wordCount undefined — computed on first open instead */
      }
    },
    [patchBook],
  );

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      setImporting(true);
      try {
        for (const file of Array.from(files)) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext !== 'epub' && ext !== 'pdf') continue;
          const parsed = ext === 'epub' ? await parseEpub(file) : await parsePdf(file);
          // Skip if the same title+author is already shelved, unless the user insists.
          if (books.some((b) => sameBook(b, parsed.book))) {
            if (!window.confirm('This book already exists. Import anyway?')) continue;
          }
          await saveBookFile(parsed.book.id, parsed.data);
          addBook(parsed.book);
          // Book is in the library now; enrich metadata + count words in the background.
          // A PDF placeholder cover (data: URL) still calls enrich so it can be upgraded.
          if (titleIsBad(parsed.book) || authorIsBad(parsed.book) || needsCover(parsed.book)) {
            void enrich(parsed.book);
          }
          void countWords(parsed.book, parsed.data);
        }
      } catch (err) {
        console.error('Import failed:', err);
      } finally {
        setImporting(false);
      }
    },
    [books, addBook, enrich, countWords],
  );

  return { importFiles, importing };
}
