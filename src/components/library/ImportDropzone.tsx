import { useCallback, useRef, useState } from 'react';
import type { Book } from '../../types';
import { parseEpub } from '../../services/epubParser';
import { parsePdf } from '../../services/pdfParser';
import { fetchBookMetadata } from '../../services/googleBooks';
import { saveBookFile } from '../../services/storage';
import { useLibrary } from '../../hooks/useLibrary';
import styles from './ImportDropzone.module.css';

const titleIsBad = (b: Book) => {
  const t = b.title.trim().toLowerCase();
  return !t || t === 'untitled';
};
const authorIsBad = (b: Book) => {
  const a = b.author.trim();
  return !a || a === 'Unknown Author';
};

export function ImportDropzone() {
  const { addBook, updateBook, setEnriching } = useLibrary();
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fill missing author/cover from Google Books, async — never blocks the import.
  const enrich = useCallback(
    async (book: Book) => {
      // Both query forms need a real title, and there's nothing to fill if author
      // and cover are already present.
      if (titleIsBad(book) || (!authorIsBad(book) && book.coverUrl)) return;
      setEnriching(book.id, true);
      try {
        const meta = await fetchBookMetadata(book.title, authorIsBad(book) ? undefined : book.author);
        const updates: Partial<Book> = {};
        if (authorIsBad(book) && meta.author) updates.author = meta.author;
        if (!book.coverUrl && meta.coverUrl) updates.coverUrl = meta.coverUrl;
        if (Object.keys(updates).length) updateBook({ ...book, ...updates });
      } finally {
        setEnriching(book.id, false);
      }
    },
    [updateBook, setEnriching],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setLoading(true);
      try {
        for (const file of Array.from(files)) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext !== 'epub' && ext !== 'pdf') continue;
          const parsed = ext === 'epub' ? await parseEpub(file) : await parsePdf(file);
          await saveBookFile(parsed.book.id, parsed.data);
          addBook(parsed.book);
          // Book is in the library now; enrich its metadata in the background.
          if (titleIsBad(parsed.book) || authorIsBad(parsed.book) || !parsed.book.coverUrl) {
            void enrich(parsed.book);
          }
        }
      } catch (err) {
        console.error('Import failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [addBook, enrich],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onClick = () => inputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div
      className={`${styles.dropzone} ${isDragging ? styles.active : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf"
        multiple
        onChange={onFileChange}
        hidden
      />
      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Importing...
        </div>
      ) : (
        <>
          <div className={styles.icon}>+</div>
          <div className={styles.text}>Drop EPUB or PDF files here</div>
          <div className={styles.hint}>or click to browse</div>
        </>
      )}
    </div>
  );
}
