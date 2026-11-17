// Splits message text into plain text and http(s) links, for rendering links as <a>. Only
// explicit http:// / https:// URLs: guessing bare domains ("hello.world") misfires in chat.
export type TextSegment = { type: "text" | "link"; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
// punctuation that usually ends the sentence, not the URL ("see https://x.com.")
const TRAILING = /[.,!?;:'"]+$/;

// A closing bracket belongs to the URL only when the URL opened one (wikipedia links).
const trimUrl = (url: string) => {
  let trimmed = url.replace(TRAILING, "");
  for (const [open, close] of [["(", ")"], ["[", "]"]]) {
    while (
      trimmed.endsWith(close) &&
      trimmed.split(close).length > trimmed.split(open).length
    ) {
      trimmed = trimmed.slice(0, -1).replace(TRAILING, "");
    }
  }
  return trimmed;
};

export const splitLinks = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of Array.from(text.matchAll(URL_PATTERN))) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (start > last) {
      segments.push({ type: "text", value: text.slice(last, start) });
    }
    segments.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }
  return segments;
};
