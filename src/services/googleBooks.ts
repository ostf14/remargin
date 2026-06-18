export interface BookMetadata {
  title?: string;
  author?: string;
  coverUrl?: string;
}

interface GoogleVolumeInfo {
  title?: string;
  authors?: string[];
  imageLinks?: {
    smallThumbnail?: string;
    thumbnail?: string;
    small?: string;
    medium?: string;
    large?: string;
    extraLarge?: string;
  };
}

interface GoogleBooksResponse {
  items?: { volumeInfo?: GoogleVolumeInfo }[];
}

// PDF metadata titles often carry a trailing series / edition / subtitle in parens
// ("Aesthetic Theory (Athlone Contemporary European Thinkers)"), which makes both
// Google's intitle: and Open Library's title= miss the lookup. Strip it before
// querying — the parens are noise, not part of the actual book title.
export function normalizeLookupTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Look up a book on the Google Books API. Returns {} on no match / any error —
// never throws, so it can never break an import.
export async function fetchBookMetadata(title: string, author?: string): Promise<BookMetadata> {
  try {
    const t = normalizeLookupTitle(title);
    // Both query forms need a real title (intitle:). Nothing to search otherwise.
    if (!t || t.toLowerCase() === 'untitled') return {};
    console.log('[gbooks] query:', { title: t, author });

    const parts = [`intitle:${encodeURIComponent(t)}`];
    const a = author?.trim();
    if (a) parts.push(`inauthor:${encodeURIComponent(a)}`);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${parts.join('+')}&maxResults=1`;

    const res = await fetch(url);
    if (!res.ok) {
      console.log('[gbooks] HTTP error:', res.status, res.statusText);
      return {};
    }
    const json = (await res.json()) as GoogleBooksResponse;
    const info = json.items?.[0]?.volumeInfo;
    console.log('[gbooks] items:', json.items?.length ?? 0, 'imageLinks:', info?.imageLinks);
    if (!info) return {};

    // Prefer the largest image available; otherwise fall back to the thumbnail with its
    // zoom bumped (Google's thumbnail URLs default to a tiny &zoom=1) and the page-curl
    // effect stripped.
    const links = info.imageLinks;
    const raw = links?.extraLarge || links?.large || links?.medium || links?.thumbnail;
    let coverUrl: string | undefined;
    if (raw) {
      coverUrl = raw
        .replace('http://', 'https://')
        .replace('&edge=curl', '')
        .replace(/&zoom=\d+/, '&zoom=3');
    }

    const result = { title: info.title, author: info.authors?.[0], coverUrl };
    console.log('[gbooks] result:', result);
    return result;
  } catch (e) {
    console.log('[gbooks] error:', e);
    return {};
  }
}
