import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Book } from '../types';
import { v4 as uuid } from 'uuid';
import { parseFilename } from './parseFilename';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function parsePdf(file: File): Promise<{ book: Book; data: ArrayBuffer }> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;

  // Filename is the fallback; embedded metadata wins when it's actually present.
  const fromName = parseFilename(file.name);
  let title = fromName.title;
  let author = fromName.author || 'Unknown Author';

  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, string> | undefined;
    const metaTitle = info?.Title?.trim();
    const metaAuthor = info?.Author?.trim();
    if (metaTitle && metaTitle.toLowerCase() !== 'untitled') title = metaTitle;
    if (metaAuthor) author = metaAuthor;
  } catch {
    // metadata unavailable
  }

  // No cover from the PDF itself: the first page rendered as a thumbnail is almost
  // always a pale, near-blank page that doesn't look like a book cover — but it would
  // pass the !coverUrl check and stop the metadata enrich from ever fetching a real
  // one from Google / Open Library. Leave it null; enrich fills it in. If nothing
  // matches, the card placeholder is honest, and right-click → Find cover is manual.
  const coverUrl: string | null = null;

  const totalPages = pdf.numPages;
  await pdf.cleanup();

  const book: Book = {
    id: uuid(),
    title,
    author,
    coverUrl,
    format: 'pdf',
    tags: [],
    progress: 0,
    lastPosition: '1',
    lastOpened: null,
    addedAt: new Date().toISOString(),
    totalPages,
  };

  return { book, data };
}
