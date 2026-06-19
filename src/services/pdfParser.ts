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

  // Last-resort placeholder: render the first page at low res as a data: URL. It's
  // usually a pale title page, but it's better than the empty BookOpen icon when both
  // Google Books and Open Library miss (which happens for non-English / niche titles).
  // useImport's enrich routes still run because they treat a data: cover as upgradeable
  // — when a real publisher cover is found later it replaces this fallback.
  let coverUrl: string | null = null;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      coverUrl = canvas.toDataURL('image/jpeg', 0.8);
    }
  } catch {
    /* first-page render failed — leave null, the card placeholder shows */
  }

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
