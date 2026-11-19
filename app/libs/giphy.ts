// GIFs and stickers from GIPHY (GIPHY_API_KEY, read at run time; without it the picker is hidden
// and sending one is refused). The API key stays on the server: the picker searches through
// GET /api/gifs, and a GIF is sent by its id only, which the server looks up again here, so a
// message never carries a URL the client chose. Its media load straight from GIPHY's hosts
// (allowed in next.config.js).

import { logError } from "./log";

const API = "https://api.giphy.com/v1";
const TIMEOUT_MS = 4000;
export const GIF_PAGE_SIZE = 24;
// GIPHY's own content rating: nothing beyond PG-13
const RATING = "pg-13";
// GIPHY ids: letters and digits
const GIF_ID = /^[A-Za-z0-9]{1,64}$/;
// where GIPHY serves the files (media, media0..media4, i; the same hosts as next.config.js)
const MEDIA_HOST = /^(media[0-4]?|i)\.giphy\.com$/;

export type GifKind = "gif" | "sticker";

// what a message stores (Message.gif)
export type GifData = {
  id: string;
  kind: GifKind;
  url: string;
  width: number;
  height: number;
  title: string | null;
};

// a search result: the same, with a smaller rendition for the picker's grid
export type GifResult = GifData & { preview: string };

export const isGifKind = (value: unknown): value is GifKind => value === "gif" || value === "sticker";

export const isGifId = (value: unknown): value is string => typeof value === "string" && GIF_ID.test(value);

export const giphyEnabled = () => !!process.env.GIPHY_API_KEY;

export const isGiphyMediaUrl = (value: unknown) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
};

type Rendition = { url?: string; webp?: string; width?: string; height?: string };
type GiphyItem = {
  id?: string;
  title?: string;
  images?: { fixed_width?: Rendition; fixed_width_small?: Rendition };
};

// the animated WebP (smaller) when there is one, else the GIF; only on GIPHY's hosts
const fileOf = (rendition?: Rendition) =>
  [rendition?.webp, rendition?.url].find((url) => isGiphyMediaUrl(url)) ?? null;

export const toGifResult = (item: GiphyItem, kind: GifKind): GifResult | null => {
  const main = item.images?.fixed_width;
  const url = fileOf(main);
  const width = Number(main?.width);
  const height = Number(main?.height);
  if (!isGifId(item.id) || !url || !(width > 0) || !(height > 0)) {
    return null;
  }
  return {
    id: item.id,
    kind,
    url,
    width: Math.round(width),
    height: Math.round(height),
    title: item.title?.trim().slice(0, 200) || null,
    preview: fileOf(item.images?.fixed_width_small) ?? url,
  };
};

const call = async (path: string, query: Record<string, string>) => {
  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    throw new Error("GIPHY_API_KEY is not set");
  }
  const params = new URLSearchParams({ ...query, api_key: key });
  const response = await fetch(`${API}${path}?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GIPHY answered ${response.status}`);
  }
  return response.json();
};

// One page of GIFs or stickers: matching the query, or trending without one.
export const searchGiphy = async ({
  query,
  kind,
  offset = 0,
  locale,
}: {
  query: string;
  kind: GifKind;
  offset?: number;
  locale: string;
}) => {
  const base = kind === "sticker" ? "/stickers" : "/gifs";
  const common = { limit: String(GIF_PAGE_SIZE), offset: String(offset), rating: RATING };
  const data = query
    ? await call(`${base}/search`, { ...common, q: query, lang: locale })
    : await call(`${base}/trending`, common);
  const items: GiphyItem[] = Array.isArray(data?.data) ? data.data : [];
  const results = items
    .map((item) => toGifResult(item, kind))
    .filter((item): item is GifResult => !!item);
  const total = Number(data?.pagination?.total_count);
  const next = offset + items.length;
  return { results, next: items.length === GIF_PAGE_SIZE && (!(total > 0) || next < total) ? next : null };
};

// A GIF / sticker by its id, as a message stores it; null when GIPHY doesn't have it (or fails).
export const findGiphy = async (id: string, kind: GifKind): Promise<GifData | null> => {
  if (!isGifId(id)) {
    return null;
  }
  try {
    // stickers are GIPHY GIFs too: one endpoint for both
    const data = await call(`/gifs/${id}`, {});
    const found = data?.data && toGifResult(data.data, kind);
    if (!found || found.id !== id) {
      return null;
    }
    const { preview, ...gif } = found;
    return gif;
  } catch (error) {
    logError("giphy_find", error);
    return null;
  }
};
