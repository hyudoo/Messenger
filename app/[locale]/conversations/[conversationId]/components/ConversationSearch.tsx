"use client";

import axios from "axios";
import Image from "next/image";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { HiArrowLeft } from "react-icons/hi2";

import SearchInput from "@/app/components/inputs/SearchInput";
import useDateLocale from "@/app/hooks/useDateLocale";
import useMessageJump from "@/app/hooks/useMessageJump";

// wait this long after the last keystroke before asking the server
const SEARCH_DELAY_MS = 300;

interface SearchResult {
  id: string;
  body: string | null;
  createdAt: string;
  sender: { name: string | null; email: string | null; image: string | null };
}

interface ConversationSearchProps {
  conversationId: string;
  onBack: () => void;
  // a result was picked: the drawer closes while the chat goes to the message
  onPick: () => void;
}

// The match in a result, highlighted (case-insensitive, like the server's search).
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || at < 0) {
    return <>{text}</>;
  }
  // a little context before the match, so it shows in a one-line preview
  const start = Math.max(0, at - 30);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark className="rounded bg-sky-500/25 text-foreground">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

// Search in the conversation (the drawer's "Search" action): text messages containing the words,
// newest first; picking one shows it in the chat (loading older pages when needed).
const ConversationSearch: React.FC<ConversationSearchProps> = ({ conversationId, onBack, onPick }) => {
  const t = useTranslations("search");
  const dateLocale = useDateLocale();
  const [query, setQuery] = useState("");
  // the results and the query they are for (results of an older query are not shown)
  const [state, setState] = useState<{ query: string; results: SearchResult[]; failed: boolean }>({
    query: "",
    results: [],
    failed: false,
  });
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      axios
        .get<SearchResult[]>(`/api/conversations/${conversationId}/search`, {
          params: { q: trimmed },
          signal: controller.signal,
        })
        .then(({ data }) => setState({ query: trimmed, results: data, failed: false }))
        .catch((error) => {
          if (!axios.isCancel(error)) {
            setState({ query: trimmed, results: [], failed: true });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, conversationId]);

  const ready = !!trimmed && state.query === trimmed;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          title={t("back")}
          className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <HiArrowLeft size={20} aria-hidden />
        </button>
        <h2 className="font-medium">{t("title")}</h2>
      </div>
      <SearchInput value={query} onChange={setQuery} placeholder={t("placeholder")} />
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {trimmed && !ready && <p className="py-4 text-center text-sm text-muted-foreground">{t("searching")}</p>}
        {ready && state.failed && <p className="py-4 text-center text-sm text-rose-500">{t("failed")}</p>}
        {ready && !state.failed && state.results.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("no_results")}</p>
        )}
        {ready && state.results.length > 0 && (
          <ul className="flex flex-col">
            {state.results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick();
                    useMessageJump.getState().request(result.id);
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted">
                  <Image
                    src={result.sender.image || "/images/placeholder.jpg"}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{result.sender.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(new Date(result.createdAt), "P", { locale: dateLocale })}
                      </span>
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      <Highlight text={result.body ?? ""} query={trimmed} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ConversationSearch;
