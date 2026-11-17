// @mentions in group messages. The server finds them in the body ("@" + a member's name), so
// the client only has to write the name (the composer's picker does); they are stored on the
// message as they were (Message.mentions) and drawn highlighted.

export const MAX_MENTIONS = 20;

type Member = { id: string; name: string | null; email: string | null };
export type Mention = { id: string; name: string; email: string | null };

// what may follow a name for it to count as mentioned (not "@Annabelle" for "Ann")
const BOUNDARY = /^($|[\s.,!?;:)\]}'"…])/;

// The members named in the text as "@Name" (case-sensitive, as the picker writes them),
// longest names first so "@Huy Do" isn't taken for "@Huy". Excludes `exceptId` (the sender).
export const findMentions = (text: string, members: Member[], exceptId?: string): Mention[] => {
  if (!text.includes("@")) {
    return [];
  }
  const candidates = members
    .filter((member) => member.id !== exceptId && member.name)
    .sort((a, b) => b.name!.length - a.name!.length);
  const found: Mention[] = [];
  candidates.forEach((member) => {
    const needle = `@${member.name}`;
    let at = text.indexOf(needle);
    while (at >= 0) {
      const before = at === 0 ? " " : text[at - 1];
      if (/\s|\(|\[/.test(before) && BOUNDARY.test(text.slice(at + needle.length))) {
        found.push({ id: member.id, name: member.name!, email: member.email });
        return;
      }
      at = text.indexOf(needle, at + 1);
    }
  });
  return found.slice(0, MAX_MENTIONS);
};

export type MentionSegment = { type: "text" | "mention"; value: string; mention?: Mention };

// The text cut around its mentions, for drawing them highlighted.
export const splitMentions = (text: string, mentions: Mention[]): MentionSegment[] => {
  if (mentions.length === 0) {
    return [{ type: "text", value: text }];
  }
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const segments: MentionSegment[] = [];
  let rest = text;
  while (rest) {
    let best: { at: number; mention: Mention } | null = null;
    for (const mention of sorted) {
      const at = rest.indexOf(`@${mention.name}`);
      if (at >= 0 && (!best || at < best.at)) {
        best = { at, mention };
      }
    }
    if (!best) {
      segments.push({ type: "text", value: rest });
      break;
    }
    if (best.at > 0) {
      segments.push({ type: "text", value: rest.slice(0, best.at) });
    }
    const value = `@${best.mention.name}`;
    segments.push({ type: "mention", value, mention: best.mention });
    rest = rest.slice(best.at + value.length);
  }
  return segments;
};

// The "@word" being typed right before the caret, for the composer's picker: where it starts
// and what follows the "@" (one word at most), or null.
export const mentionQueryAt = (text: string, caret: number) => {
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null;
};
