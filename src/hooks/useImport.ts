import { useCallback, useState } from 'react';
import type { Book } from '../types';
import { parseEpub } from '../services/epubParser';
import { fetchBookMetadata } from '../services/googleBooks';
import { fetchOpenLibraryCover } from '../services/openLibrary';
import { countWordsFromData } from '../services/wordCount';
import { saveBookFile } from '../services/storage';
import { useLibrary } from './useLibrary';

const titleIsBad = (b: Book) => {
  const t = b.title.trim().toLowerCase();
  return !t || t === 'untitled';
};
const authorIsBad = (b: Book) => !b.author.trim();
const needsCover = (b: Book) => !b.coverUrl;

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
  // throws. Only EPUBs reach this path now (PDF imports are blocked at the file gate).
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
        // Surface a single PDF-blocked warning per batch, regardless of how many PDFs
        // the user dropped — avoids stacking N alerts on a folder drop.
        let warnedPdf = false;
        for (const file of Array.from(files)) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext === 'pdf') {
            if (!warnedPdf) {
              alert('PDF support is paused. Import EPUB files for now.');
              warnedPdf = true;
            }
            continue;
          }
          if (ext !== 'epub') continue;
          const parsed = await parseEpub(file);
          // Skip if the same title+author is already shelved, unless the user insists.
          if (books.some((b) => sameBook(b, parsed.book))) {
            if (!window.confirm('This book already exists. Import anyway?')) continue;
          }
          await saveBookFile(parsed.book.id, parsed.data);
          addBook(parsed.book);
          // Book is in the library now; enrich metadata + count words in the background.
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
