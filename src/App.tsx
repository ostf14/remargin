import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReader } from './hooks/useReader';
import { useImport } from './hooks/useImport';
import { BookGrid } from './components/library/BookGrid';
import { DropOverlay } from './components/library/DropOverlay';
import { EpubReader } from './components/reader/EpubReader';

const hasFiles = (e: DragEvent) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

// First-visit seed. Three public-domain EPUBs ship in /public so a brand-new user
// lands on a populated shelf instead of the empty-state import prompt. Honours the
// localStorage flag: once seeding actually succeeds (or the user already has any
// book), we never re-seed — deleting demos doesn't bring them back.
// Key bumped to _v3: two previous variants (no suffix, then _v2) both had a bug
// where the flag could be set on an empty seed (sync-before-fetch in v1; silently-
// swallowed-importFiles error in v2), leaving users locked out without books. The
// post-import library check below now guards against re-occurrence, and _v3 forces
// stuck users through the retry path one more time.
const SEED_KEY = 'remargin_seeded_v3';
const SEED_FILES = [
  '/The Prince.epub',
  '/Beyond Good and Evil.epub',
];
// Module-level guard: React 19 StrictMode mounts twice in dev. Without this both
// mounts would race the same fetches and call importFiles in parallel.
let seedInFlight = false;

export default function App() {
  const { viewMode, currentBook } = useReader();
  const { importFiles } = useImport();
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

  // Seed-on-first-visit. The flag is set ONLY after at least one file successfully
  // imports — if every fetch 404s (files not deployed yet), no flag, retry next
  // mount. Module-level `seedInFlight` guards against StrictMode's double-mount
  // racing the same fetches. Hits localStorage directly for the books check so we
  // don't depend on useLibrary's render-time state being populated yet.
  useEffect(() => {
    if (seedInFlight) return;
    if (localStorage.getItem(SEED_KEY)) return;
    const stored = localStorage.getItem('remargin_books');
    const hasBooks = !!(stored && stored !== '[]' && JSON.parse(stored).length > 0);
    if (hasBooks) {
      localStorage.setItem(SEED_KEY, '1');
      return;
    }
    seedInFlight = true;
    (async () => {
      try {
        const files: File[] = [];
        for (const url of SEED_FILES) {
          try {
            const res = await fetch(encodeURI(url));
            if (!res.ok) {
              console.error('[seed] fetch not OK:', url, res.status);
              continue;
            }
            const blob = await res.blob();
            const name = url.split('/').pop() ?? 'book.epub';
            files.push(new File([blob], name, { type: 'application/epub+zip' }));
          } catch (e) {
            console.error('[seed] fetch error:', url, e);
          }
        }
        if (files.length === 0) {
          // Nothing reachable — leave the flag absent so the next mount retries.
          seedInFlight = false;
          return;
        }
        await importFiles(files);
        // importFiles has its own internal try/catch that swallows errors and
        // resolves cleanly even when no book was actually added. Verify the
        // library actually got something before locking out future retries.
        const after = localStorage.getItem('remargin_books');
        const addedCount =
          after && after !== '[]' ? (JSON.parse(after) as unknown[]).length : 0;
        if (addedCount > 0) {
          localStorage.setItem(SEED_KEY, '1');
        } else {
          console.error('[seed] importFiles resolved but library is empty — will retry');
          seedInFlight = false;
        }
      } catch (e) {
        console.error('[seed] crashed:', e);
        seedInFlight = false;
      }
    })();
    // Mount-only.
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
