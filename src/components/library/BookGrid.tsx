import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import { BookCard } from './BookCard';
import { ImportDropzone } from './ImportDropzone';
import styles from './BookGrid.module.css';

export function BookGrid() {
  const { books, removeBook } = useLibrary();
  const { openBook } = useReader();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>remargin</h1>
        <p className={styles.subtitle}>{books.length} books in your library</p>
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
              onRemove={() => removeBook(book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
