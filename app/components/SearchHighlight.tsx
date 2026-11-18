import { findFoldedMatch } from "@/app/libs/search";

// The match in a search result, highlighted (ignoring case and diacritics, like the server's
// search), with a little context before it so it shows in a one-line preview.
const SearchHighlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const match = findFoldedMatch(text, query);
  if (!match) {
    return <>{text}</>;
  }
  const [at, end] = match;
  const start = Math.max(0, at - 30);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark className="rounded bg-sky-500/25 text-foreground">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  );
};

export default SearchHighlight;
