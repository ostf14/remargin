import { useEffect, useRef, useState } from 'react';
import { Upload, ImageDown, FileDown, Trash2 } from 'lucide-react';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { fetchBookMetadata } from '../../services/googleBooks';
import { fetchOpenLibraryCover } from '../../services/openLibrary';
import { loadAnnotations } from '../../services/storage';
import { exportAllAnnotations } from '../../services/exportMarkdown';
import styles from './BookContextMenu.module.css';

interface Props {
  book: Book;
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
}

// Downscale a chosen image to a compact JPEG data URL — covers live in localStorage, so
// a full-resolution upload would blow the quota.
function fileToCoverDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        const scale = Math.min(1, 512 / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas context'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Right-click menu for a library book: set its cover (upload / auto-find), export its
// annotations, or delete it. Closes on outside click or Escape.
export function BookContextMenu({ book, x, y, onClose, onDelete }: Props) {
  const { patchBook } = useLibrary();
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [hasNotes, setHasNotes] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Only offer "Export annotations" when the book actually has some.
  useEffect(() => {
    let cancelled = false;
    loadAnnotations(book.id).then((a) => {
      if (!cancelled) setHasNotes(a.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      patchBook(book.id, { coverUrl: await fileToCoverDataUrl(file) });
    } catch {
      /* ignore an unreadable image */
    }
    onClose();
  };

  const findCover = async () => {
    setFinding(true);
    try {
      const meta = await fetchBookMetadata(book.title, book.author);
      const url = meta.coverUrl || (await fetchOpenLibraryCover(book.title, book.author));
      if (url) patchBook(book.id, { coverUrl: url });
    } finally {
      setFinding(false);
      onClose();
    }
  };

  const exportAnnotations = async () => {
    const anns = await loadAnnotations(book.id);
    if (anns.length) await exportAllAnnotations(book, anns);
    onClose();
  };

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 196);
  const top = Math.min(y, window.innerHeight - 200);

  return (
    <div ref={ref} className={styles.menu} style={{ left, top }} role="menu">
      <button className={styles.item} onClick={() => fileRef.current?.click()} role="menuitem">
        <Upload size={14} aria-hidden="true" />
        Upload cover
      </button>
      <button className={styles.item} onClick={findCover} disabled={finding} role="menuitem">
        {finding ? <span className={styles.spinner} /> : <ImageDown size={14} aria-hidden="true" />}
        {finding ? 'Searching…' : 'Find cover'}
      </button>
      {hasNotes && (
        <button className={styles.item} onClick={() => void exportAnnotations()} role="menuitem">
          <FileDown size={14} aria-hidden="true" />
          Export annotations
        </button>
      )}
      <div className={styles.divider} />
      <button className={`${styles.item} ${styles.danger}`} onClick={onDelete} role="menuitem">
        <Trash2 size={14} aria-hidden="true" />
        Delete
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickFile(e)} />
    </div>
  );
}
