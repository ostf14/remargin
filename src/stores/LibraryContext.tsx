import { createContext, useCallback, useState, type ReactNode } from 'react';
import type { Book } from '../types';
import {
  loadBooks,
  saveBooks,
  deleteBookFile,
  deleteAnnotationsForBook,
} from '../services/storage';

interface LibraryState {
  books: Book[];
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (book: Book) => void;
  getBook: (id: string) => Book | undefined;
  enrichingIds: Set<string>;
  setEnriching: (id: string, on: boolean) => void;
}

export const LibraryContext = createContext<LibraryState>({
  books: [],
  addBook: () => {},
  removeBook: () => {},
  updateBook: () => {},
  getBook: () => undefined,
  enrichingIds: new Set<string>(),
  setEnriching: () => {},
});

export function LibraryProvider({ children }: { children: ReactNode }) {
  // Lazy init so books are available on the first render — lets the reader
  // restore the last-open book synchronously, with no library flash.
  const [books, setBooks] = useState<Book[]>(() => loadBooks());

  const addBook = useCallback((book: Book) => {
    setBooks((prev) => {
      const next = [book, ...prev];
      saveBooks(next);
      return next;
    });
  }, []);

  const removeBook = useCallback((id: string) => {
    setBooks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBooks(next);
      return next;
    });
    deleteBookFile(id).catch((err) => console.error('Failed to delete book file:', err));
    deleteAnnotationsForBook(id).catch((err) =>
      console.error('Failed to delete book annotations:', err),
    );
  }, []);

  const updateBook = useCallback((book: Book) => {
    setBooks((prev) => {
      const next = prev.map((b) => (b.id === book.id ? book : b));
      saveBooks(next);
      return next;
    });
  }, []);

  const getBook = useCallback(
    (id: string) => books.find((b) => b.id === id),
    [books],
  );

  // Ids of books whose metadata is being fetched async (drives a card spinner).
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(() => new Set());
  const setEnriching = useCallback((id: string, on: boolean) => {
    setEnrichingIds((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <LibraryContext.Provider
      value={{ books, addBook, removeBook, updateBook, getBook, enrichingIds, setEnriching }}
    >
      {children}
    </LibraryContext.Provider>
  );
}
