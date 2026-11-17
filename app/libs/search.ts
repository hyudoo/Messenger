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

// True when every word of the query appears in one of the fields (an empty query matches all).
export const matchesSearch = (query: string, ...fields: (string | null | undefined)[]) => {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = fields.map(normalizeSearch).join(" ");
  return words.every((word) => haystack.includes(word));
};
