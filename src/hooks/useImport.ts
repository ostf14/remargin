import { useCallback, useState } from 'react';
import type { Book } from '../types';
import { parseEpub } from '../services/epubParser';
import { parsePdf } from '../services/pdfParser';
import { fetchBookMetadata } from '../services/googleBooks';
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

// Shared import pipeline: parse → persist → add to library → enrich metadata async.
// Used by the header "+" / empty-state buttons and the global drag-and-drop.
export function useImport() {
  const { addBook, patchBook, setEnriching } = useLibrary();
  const [importing, setImporting] = useState(false);

  // Fill missing author/cover from Google Books — never blocks, never throws.
  const enrich = useCallback(
    async (book: Book) => {
      if (titleIsBad(book) || (!authorIsBad(book) && book.coverUrl)) return;
      setEnriching(book.id, true);
      try {
        const meta = await fetchBookMetadata(book.title, authorIsBad(book) ? undefined : book.author);
        const updates: Partial<Book> = {};
        if (authorIsBad(book) && meta.author) updates.author = meta.author;
        if (!book.coverUrl && meta.coverUrl) updates.coverUrl = meta.coverUrl;
        console.log('[gbooks] enrich', book.title, '→', updates, '(had cover:', !!book.coverUrl, ')');
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
          await saveBookFile(parsed.book.id, parsed.data);
          addBook(parsed.book);
          // Book is in the library now; enrich metadata + count words in the background.
          if (titleIsBad(parsed.book) || authorIsBad(parsed.book) || !parsed.book.coverUrl) {
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
    [addBook, enrich, countWords],
  );

  return { importFiles, importing };
}
