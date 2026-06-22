import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReader } from './hooks/useReader';
import { useImport } from './hooks/useImport';
import { useLibrary } from './hooks/useLibrary';
import { BookGrid } from './components/library/BookGrid';
import { DropOverlay } from './components/library/DropOverlay';
import { EpubReader } from './components/reader/EpubReader';

const hasFiles = (e: DragEvent) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

// First-visit seed. Three public-domain EPUBs ship in /public so a brand-new user
// lands on a populated shelf instead of the empty-state import prompt. Honours the
// localStorage flag: if seeding ever completed (or the user already had any book),
// we never re-seed — deleting demos doesn't bring them back.
const SEED_KEY = 'remargin_seeded';
const SEED_FILES = [
  '/The Prince.epub',
  '/The Art Of War.epub',
  '/Beyond Good and Evil.epub',
];

export default function App() {
  const { viewMode, currentBook } = useReader();
  const { importFiles } = useImport();
  const { books } = useLibrary();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire per element; count depth so the overlay only hides
  // once the cursor has actually left the window.
  const dragDepth = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // required to allow the drop
    };
    const onDragLeave = () => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  // Seed-on-first-visit. Set the flag synchronously BEFORE the async fetch so
  // StrictMode's double-mount can't kick off two parallel seeds, and so a tab
  // closed mid-seed doesn't re-trigger on next open. Fires once per browser.
  useEffect(() => {
    if (localStorage.getItem(SEED_KEY)) return;
    if (books.length > 0) {
      // User already has books (manual import in an older session before this
      // feature shipped, or a different seed run) — skip and mark done.
      localStorage.setItem(SEED_KEY, '1');
      return;
    }
    localStorage.setItem(SEED_KEY, '1');
    (async () => {
      const files: File[] = [];
      for (const url of SEED_FILES) {
        try {
          const res = await fetch(encodeURI(url));
          if (!res.ok) continue;
          const blob = await res.blob();
          const name = url.split('/').pop() ?? 'book.epub';
          files.push(new File([blob], name, { type: 'application/epub+zip' }));
        } catch (e) {
          console.error('[seed] fetch failed:', url, e);
        }
      }
      if (files.length > 0) await importFiles(files);
    })();
    // Mount-only — importFiles changes per render but seeding only happens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let content: ReactNode = <BookGrid />;
  // PDF support is frozen — only EPUB renders a reader. Existing PDF books in the
  // library show their card but can't be opened (gated in BookGrid's openBook).
  if (viewMode === 'reader' && currentBook && currentBook.format === 'epub') {
    content = <EpubReader book={currentBook} />;
  }

  return (
    <>
      {content}
      {dragging && <DropOverlay />}
    </>
  );
}
