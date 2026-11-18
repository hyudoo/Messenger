// Client-side search in the inbox and the contacts list. Case and Vietnamese diacritics are
// ignored ("huy" finds "Huỳnh", "dung" finds "Dũng" and "Đức" is found by "duc").
export const normalizeSearch = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    // combining marks (accents, tones) that NFD splits off
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();

// What a message's body is searched by (Message.searchText): the same folding as the inbox
// search, so "chao" finds "Chào". undefined for no text.
export const searchTextOf = (body: string | null | undefined) => normalizeSearch(body) || undefined;

// Where the (folded) query occurs in the original text, as [start, end) in the original, or
// null: for highlighting a match that ignored case and diacritics.
export const findFoldedMatch = (text: string, query: string): [number, number] | null => {
  const needle = normalizeSearch(query);
  if (!needle) {
    return null;
  }
  // the folded text, and for each of its characters the original index it came from
  let folded = "";
  const origin: number[] = [];
  Array.from(text).reduce((index, char) => {
    const part = char
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
    for (let i = 0; i < part.length; i++) {
      folded += part[i];
      origin.push(index);
    }
    return index + char.length;
  }, 0);
  const at = folded.indexOf(needle);
  if (at < 0) {
    return null;
  }
  const last = origin[at + needle.length - 1];
  // through the whole original character the match ends in (e.g. a surrogate pair)
  const end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
  return [origin[at], end];
};

// True when every word of the query appears in one of the fields (an empty query matches all).
export const matchesSearch = (query: string, ...fields: (string | null | undefined)[]) => {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = fields.map(normalizeSearch).join(" ");
  return words.every((word) => haystack.includes(word));
};

// "Find people" (GET /api/users/search): a name query needs this many characters (an email is
// matched whole)
export const MIN_NAME_QUERY = 2;
