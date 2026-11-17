// A message made only of a few emoji (spaces between them allowed) is shown large,
// without a bubble, like other messengers do.
export const JUMBO_EMOJI_MAX = 3;

// RegExp constructor: tsconfig targets ES5, where TS rejects the u flag in literals
const STARTS_PICTOGRAPHIC = new RegExp(
  "^(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})",
  "u"
);
// rendered as emoji, not as a text symbol such as © or ™ on their own
// (U+FE0F = emoji variation selector, U+20E3 = keycap)
const EMOJI_PRESENTATION = new RegExp(
  "\\p{Emoji_Presentation}|\\u{FE0F}|\\u{20E3}|\\p{Regional_Indicator}",
  "u"
);
const KEYCAP = new RegExp("^[#*0-9]\\u{FE0F}?\\u{20E3}$", "u");

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const isEmojiGrapheme = (segment: string) =>
  KEYCAP.test(segment) ||
  (STARTS_PICTOGRAPHIC.test(segment) && EMOJI_PRESENTATION.test(segment));

// Number of emoji when the text holds nothing else, else 0. A family or flag
// (several code points joined into one grapheme) counts as one.
export const countEmojiOnly = (text: string): number => {
  const compact = text.replace(/\s+/g, "");
  if (!compact || !segmenter) {
    return 0;
  }
  const graphemes = Array.from(segmenter.segment(compact), (part) => part.segment);
  return graphemes.every(isEmojiGrapheme) ? graphemes.length : 0;
};

// sent by the quick-send button when the input is empty
export const QUICK_EMOJI = "👍";
