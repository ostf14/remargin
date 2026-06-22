import ePub from 'epubjs';
import type { Book } from '../types';
import { v4 as uuid } from 'uuid';
import { parseFilename } from './parseFilename';

export async function parseEpub(file: File): Promise<{ book: Book; data: ArrayBuffer }> {
  const data = await file.arrayBuffer();
  const epub = ePub(data.slice(0));
  await epub.ready;

  const meta = epub.packaging.metadata;
  const fromName = parseFilename(file.name);
  const metaTitle = (meta.title || '').trim();
  const metaAuthor = (meta.creator || '').trim();
  const title = metaTitle && metaTitle.toLowerCase() !== 'untitled' ? metaTitle : fromName.title;
  const author = metaAuthor || fromName.author || '';

  let coverUrl: string | null = null;
  try {
    const coverId = epub.packaging.metadata.cover;
    if (coverId) {
      const coverItem = epub.packaging.manifest[coverId];
      if (coverItem) {
        const coverHref = coverItem.href;
        const archive = epub.archive as { zip?: { files?: Record<string, unknown> } };
        const zip = archive?.zip;
        if (zip?.files) {
          const possiblePaths = [coverHref, `OEBPS/${coverHref}`, `OPS/${coverHref}`];
          for (const p of possiblePaths) {
            if (zip.files[p]) {
              const blob = await epub.archive.getBlob(p, 'image/jpeg');
              if (blob.size > 0) {
                coverUrl = await blobToDataUrl(blob);
                break;
              }
            }
          }
        }
      }
    }
    if (!coverUrl) {
      const cover = await epub.coverUrl();
      if (cover) {
        if (cover.startsWith('blob:')) {
          const resp = await fetch(cover);
          const blob = await resp.blob();
          coverUrl = await blobToDataUrl(blob);
        } else {
          coverUrl = cover;
        }
      }
    }
  } catch {
    // cover extraction failed — leave empty
  }

  epub.destroy();

  const book: Book = {
    id: uuid(),
    title,
    author,
    coverUrl,
    format: 'epub',
    tags: [],
    progress: 0,
    lastPosition: null,
    lastOpened: null,
    addedAt: new Date().toISOString(),
  };

  return { book, data };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
