import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { Book, ViewMode } from '../types';
import { useLibrary } from '../hooks/useLibrary';
import { loadAppState, saveAppState } from '../services/storage';

type Theme = 'dark' | 'light';

interface ReaderState {
  currentBook: Book | null;
  viewMode: ViewMode;
  openBook: (book: Book) => void;
  closeBook: () => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
  theme: Theme;
  toggleTheme: () => void;
}

export const ReaderContext = createContext<ReaderState>({
  currentBook: null,
  viewMode: 'library',
  openBook: () => {},
  closeBook: () => {},
  showAnnotations: false,
  setShowAnnotations: () => {},
  theme: 'dark',
  toggleTheme: () => {},
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

  // Reflect the theme onto <html> so CSS custom properties switch app-wide.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

  const openBook = (book: Book) => {
    setCurrentBook(book);
    setViewMode('reader');
    setShowAnnotations(false);
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
        closeBook,
        showAnnotations,
        setShowAnnotations,
        theme,
        toggleTheme,
      }}
    >
      {children}
    </ReaderContext.Provider>
  );
}
