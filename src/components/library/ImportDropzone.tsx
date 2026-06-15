import { useCallback, useRef, useState } from 'react';
import { parseEpub } from '../../services/epubParser';
import { parsePdf } from '../../services/pdfParser';
import { saveBookFile } from '../../services/storage';
import { useLibrary } from '../../hooks/useLibrary';
import styles from './ImportDropzone.module.css';

export function ImportDropzone() {
  const { addBook } = useLibrary();
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      console.log('[import] handleFiles count=', files.length);
      setLoading(true);
      try {
        for (const file of Array.from(files)) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          console.log('[import] file', file.name, 'ext=', ext, 'size=', file.size);
          if (ext !== 'epub' && ext !== 'pdf') {
            console.log('[import] skip — unsupported ext');
            continue;
          }
          const parsed = ext === 'epub' ? await parseEpub(file) : await parsePdf(file);
          console.log('[import] parsed', { id: parsed.book.id, title: parsed.book.title, dataBytes: parsed.data?.byteLength, dataType: parsed.data?.constructor?.name });
          await saveBookFile(parsed.book.id, parsed.data);
          console.log('[import] saveBookFile done for', parsed.book.id);
          addBook(parsed.book);
          console.log('[import] addBook called');
        }
      } catch (err) {
        console.error('[import] Import failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [addBook],
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
