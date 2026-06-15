import { createContext, useState, type ReactNode } from 'react';
import type { Book, ViewMode } from '../types';

interface ReaderState {
  currentBook: Book | null;
  viewMode: ViewMode;
  openBook: (book: Book) => void;
  closeBook: () => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
}

export const ReaderContext = createContext<ReaderState>({
  currentBook: null,
  viewMode: 'library',
  openBook: () => {},
  closeBook: () => {},
  showAnnotations: false,
  setShowAnnotations: () => {},
});

export function ReaderProvider({ children }: { children: ReactNode }) {
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('library');
  const [showAnnotations, setShowAnnotations] = useState(false);

  const openBook = (book: Book) => {
    setCurrentBook(book);
    setViewMode('reader');
    setShowAnnotations(false);
  };

  const closeBook = () => {
    setCurrentBook(null);
    setViewMode('library');
    setShowAnnotations(false);
  };

  return (
    <ReaderContext.Provider
      value={{ currentBook, viewMode, openBook, closeBook, showAnnotations, setShowAnnotations }}
    >
      {children}
    </ReaderContext.Provider>
  );
}
