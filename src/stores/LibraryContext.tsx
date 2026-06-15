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
}

export const LibraryContext = createContext<LibraryState>({
  books: [],
  addBook: () => {},
  removeBook: () => {},
  updateBook: () => {},
  getBook: () => undefined,
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

  return (
    <LibraryContext.Provider value={{ books, addBook, removeBook, updateBook, getBook }}>
      {children}
    </LibraryContext.Provider>
  );
}
