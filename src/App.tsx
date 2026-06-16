import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReader } from './hooks/useReader';
import { useImport } from './hooks/useImport';
import { BookGrid } from './components/library/BookGrid';
import { DropOverlay } from './components/library/DropOverlay';
import { EpubReader } from './components/reader/EpubReader';
import { PdfReader } from './components/reader/PdfReader';

const hasFiles = (e: DragEvent) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

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

  let content: ReactNode = <BookGrid />;
  if (viewMode === 'reader' && currentBook) {
    if (currentBook.format === 'epub') content = <EpubReader book={currentBook} />;
    else if (currentBook.format === 'pdf') content = <PdfReader book={currentBook} />;
  }

  return (
    <>
      {content}
      {dragging && <DropOverlay />}
    </>
  );
}
