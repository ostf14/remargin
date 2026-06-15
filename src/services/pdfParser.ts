import * as pdfjsLib from 'pdfjs-dist';
import type { Book } from '../types';
import { v4 as uuid } from 'uuid';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

export async function parsePdf(file: File): Promise<{ book: Book; data: ArrayBuffer }> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;

  let title = file.name.replace(/\.pdf$/i, '');
  let author = 'Unknown Author';

  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, string> | undefined;
    if (info?.Title) title = info.Title;
    if (info?.Author) author = info.Author;
  } catch {
    // metadata unavailable
  }

  let coverUrl = '';
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const canvasContext = canvas.getContext('2d')!;
    await page.render({ canvasContext, viewport }).promise;
    coverUrl = canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    // cover generation failed
  }

  const totalPages = pdf.numPages;
  await pdf.cleanup();

  const book: Book = {
    id: uuid(),
    title,
    author,
    format: 'pdf',
    coverUrl,
    addedAt: new Date().toISOString(),
    lastOpenedAt: '',
    progress: { location: '1', percentage: 0 },
    totalPages,
  };

  return { book, data };
}
