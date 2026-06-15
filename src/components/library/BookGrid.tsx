import { useState } from 'react';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import { BookCard } from './BookCard';
import { ImportDropzone } from './ImportDropzone';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './BookGrid.module.css';

export function BookGrid() {
  const { books, removeBook } = useLibrary();
  const { openBook, theme, toggleTheme } = useReader();
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>remargin</h1>
          <p className={styles.subtitle}>{books.length} books in your library</p>
        </div>
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <ImportDropzone />

      {books.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <div className={styles.emptyHint}>Import an EPUB or PDF to get started</div>
        </div>
      ) : (
        <div className={styles.grid}>
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => openBook(book)}
              onRemove={() => setPendingDelete(book)}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete book?"
          message={`"${pendingDelete.title}" and all its annotations will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            removeBook(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
