export interface BookMetadata {
  title?: string;
  author?: string;
  coverUrl?: string;
}

interface GoogleVolumeInfo {
  title?: string;
  authors?: string[];
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
}

interface GoogleBooksResponse {
  items?: { volumeInfo?: GoogleVolumeInfo }[];
}

// Look up a book on the Google Books API. Returns {} on no match / any error —
// never throws, so it can never break an import.
export async function fetchBookMetadata(title: string, author?: string): Promise<BookMetadata> {
  try {
    const t = title.trim();
    // Both query forms need a real title (intitle:). Nothing to search otherwise.
    if (!t || t.toLowerCase() === 'untitled') return {};

    const parts = [`intitle:${encodeURIComponent(t)}`];
    const a = author?.trim();
    if (a) parts.push(`inauthor:${encodeURIComponent(a)}`);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${parts.join('+')}&maxResults=1`;

    const res = await fetch(url);
    if (!res.ok) return {};
    const json = (await res.json()) as GoogleBooksResponse;
    const info = json.items?.[0]?.volumeInfo;
    if (!info) return {};

    let coverUrl: string | undefined;
    const thumb = info.imageLinks?.thumbnail;
    if (thumb) {
      coverUrl = thumb.replace('http://', 'https://').replace('&edge=curl', '');
    }

    return {
      title: info.title,
      author: info.authors?.[0],
      coverUrl,
    };
  } catch {
    return {};
  }
}
