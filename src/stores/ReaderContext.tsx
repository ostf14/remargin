import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { AnchorData, Book, ReaderMode, ReadingSurface, ViewMode } from '../types';
import { useLibrary } from '../hooks/useLibrary';
import { loadAppState, saveAppState } from '../services/storage';

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

  // Reflect the theme onto <html> so CSS custom properties switch app-wide.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Reflect the reading surface onto <html> so the reader's --reader-page / --reader-ink
  // switch independently of the app chrome theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-surface', readingSurface);
  }, [readingSurface]);

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
    setCurrentBook(book);
    setViewMode('reader');
    setShowAnnotations(false);
    setPendingAnchor(anchor ?? null); // reset every open; the reader reads it once at mount
    persistView('reader', book.id);
  };

  const closeBook = () => {
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
