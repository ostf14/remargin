import { useReader } from './hooks/useReader';
import { BookGrid } from './components/library/BookGrid';
import { EpubReader } from './components/reader/EpubReader';
import { PdfReader } from './components/reader/PdfReader';

export default function App() {
  const { viewMode, currentBook } = useReader();

  if (viewMode === 'reader' && currentBook) {
    if (currentBook.format === 'epub') return <EpubReader book={currentBook} />;
    if (currentBook.format === 'pdf') return <PdfReader book={currentBook} />;
  }

  return <BookGrid />;
}
