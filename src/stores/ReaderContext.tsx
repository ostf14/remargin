import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AnchorData, Book, ReaderMode, ReadingSurface, ViewMode } from '../types';
import { useLibrary } from '../hooks/useLibrary';
import { loadAppState, saveAppState } from '../services/storage';

// Tag we attach to pushed history entries so popstate can tell our reader entries
// apart from anything else on the back stack.
const READER_HISTORY_TAG = 'remarginReader';

type Theme = 'dark' | 'light';

interface ReaderState {
  currentBook: Book | null;
  viewMode: ViewMode;
  // Optional anchor jumps straight to a highlight (from the Notes view); omit to open
  // at the saved reading position. Consumed once by the reader at mount.
  openBook: (book: Book, anchor?: AnchorData) => void;
  pendingAnchor: AnchorData | null;
  closeBook: () => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
  theme: Theme;
  toggleTheme: () => void;
  readingSurface: ReadingSurface;
  setReadingSurface: (s: ReadingSurface) => void;
  readerMode: ReaderMode;
  setReaderMode: (m: ReaderMode) => void;
}

export const ReaderContext = createContext<ReaderState>({
  currentBook: null,
  viewMode: 'library',
  openBook: () => {},
  pendingAnchor: null,
  closeBook: () => {},
  showAnnotations: false,
  setShowAnnotations: () => {},
  theme: 'dark',
  toggleTheme: () => {},
  readingSurface: 'light',
  setReadingSurface: () => {},
  readerMode: 'pages',
  setReaderMode: () => {},
});

// Resolve the persisted view: reopen the last book if it still exists.
function restoreState(books: Book[]): { book: Book | null; view: ViewMode } {
  const s = loadAppState();
  if (s.lastView === 'reader' && s.lastBookId) {
    const book = books.find((b) => b.id === s.lastBookId) ?? null;
    return { book, view: book ? 'reader' : 'library' };
  }
  return { book: null, view: 'library' };
}

export function ReaderProvider({ children }: { children: ReactNode }) {
  const { books } = useLibrary();
  const [currentBook, setCurrentBook] = useState<Book | null>(() => restoreState(books).book);
  const [viewMode, setViewMode] = useState<ViewMode>(() => restoreState(books).view);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadAppState().theme);
  const [readingSurface, setReadingSurfaceState] = useState<ReadingSurface>(
    () => loadAppState().readingSurface,
  );
  const [readerMode, setReaderModeState] = useState<ReaderMode>(() => loadAppState().readerMode);
  const [pendingAnchor, setPendingAnchor] = useState<AnchorData | null>(null);
  // Stable ref so the popstate listener stays installed once but reads current state.
  const currentBookRef = useRef<Book | null>(null);
  currentBookRef.current = currentBook;

  // Reflect the theme onto <html> so CSS custom properties switch app-wide.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Reflect the reading surface onto <html> so the reader's --reader-page / --reader-ink
  // switch independently of the app chrome theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-surface', readingSurface);
  }, [readingSurface]);

  // Android system-back / browser-back: pop pushed history entries so the user lands on
  // the library instead of exiting the PWA / browser tab. Installed once; reads current
  // state via currentBookRef.
  useEffect(() => {
    const onPop = () => {
      if (currentBookRef.current) {
        setCurrentBook(null);
        setViewMode('library');
        setShowAnnotations(false);
        saveAppState({ ...loadAppState(), lastView: 'library', lastBookId: null });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // If the last session was inside a book, restoreState put us straight into reader
  // mode without anyone calling openBook → no history entry was pushed. Push one now
  // so Android back / browser back still closes the book first instead of exiting.
  useEffect(() => {
    if (currentBookRef.current) {
      try {
        window.history.pushState({ [READER_HISTORY_TAG]: true, bookId: currentBookRef.current.id }, '');
      } catch { /* ignore — non-fatal */ }
    }
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistView = (view: ViewMode, bookId: string | null) => {
    saveAppState({ ...loadAppState(), lastView: view, lastBookId: bookId });
  };

  const toggleTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      saveAppState({ ...loadAppState(), theme: next });
      return next;
    });
  };

  const setReadingSurface = (s: ReadingSurface) => {
    setReadingSurfaceState(s);
    saveAppState({ ...loadAppState(), readingSurface: s });
  };

  const setReaderMode = (m: ReaderMode) => {
    setReaderModeState(m);
    saveAppState({ ...loadAppState(), readerMode: m });
  };

  const openBook = (book: Book, anchor?: AnchorData) => {
    // PDF reading is paused — refuse to enter reader mode for PDFs no matter where the
    // call came from (BookGrid card click, NotesView jump-to-highlight, last-position
    // restore). Library stays the active view.
    if (book.format === 'pdf') {
      alert('PDF reading is paused. EPUB only for now.');
      return;
    }
    setCurrentBook(book);
    setViewMode('reader');
    setShowAnnotations(false);
    setPendingAnchor(anchor ?? null); // reset every open; the reader reads it once at mount
    persistView('reader', book.id);
    // Push a history entry tagged for our popstate listener so Android system-back (and
    // browser back) closes the book first instead of exiting the app / tab.
    try {
      window.history.pushState({ [READER_HISTORY_TAG]: true, bookId: book.id }, '');
    } catch { /* ignore — non-fatal */ }
  };

  const closeBook = () => {
    // If we pushed a history entry on open, pop it — popstate then does the actual
    // teardown so manual close and Android back follow the same code path. If we never
    // pushed (rare; restore failed or pushState threw), tear down directly.
    const state = window.history.state as Record<string, unknown> | null;
    if (state && state[READER_HISTORY_TAG]) {
      window.history.back();
      return;
    }
    setCurrentBook(null);
    setViewMode('library');
    setShowAnnotations(false);
    persistView('library', null);
  };

  return (
    <ReaderContext.Provider
      value={{
        currentBook,
        viewMode,
        openBook,
        pendingAnchor,
        closeBook,
        showAnnotations,
        setShowAnnotations,
        theme,
        toggleTheme,
        readingSurface,
        setReadingSurface,
        readerMode,
        setReaderMode,
      }}
    >
      {children}
    </ReaderContext.Provider>
  );
}
