"use client";

import axios from "axios";
import Image from "next/image";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import SearchHighlight from "@/app/components/SearchHighlight";
import useDateLocale from "@/app/hooks/useDateLocale";
import { Link } from "@/i18n/navigation";

// wait this long after the last keystroke before asking the server
const SEARCH_DELAY_MS = 300;
// shorter queries match too much to be useful (and the server scans every conversation)
export const MIN_MESSAGE_QUERY = 2;

interface SearchResult {
  id: string;
  body: string | null;
  createdAt: string;
  sender: { name: string | null; email: string | null; image: string | null };
  conversation: { id: string; isGroup: boolean; title: string };
}

// The inbox search's "Messages" part (GET /api/search): text messages containing the words in all
// of the user's conversations, newest first. A result opens its chat at that message
// (?message=<id>, Body jumps to it).
const MessageSearchResults: React.FC<{ query: string }> = ({ query }) => {
  const t = useTranslations("search");
  const tInbox = useTranslations("conversations");
  const dateLocale = useDateLocale();
  // the results and the query they are for (results of an older query are not shown)
  const [state, setState] = useState<{ query: string; results: SearchResult[]; failed: boolean }>({
    query: "",
    results: [],
    failed: false,
  });

  useEffect(() => {
    if (query.length < MIN_MESSAGE_QUERY) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      axios
        .get<SearchResult[]>("/api/search", { params: { q: query }, signal: controller.signal })
        .then(({ data }) => setState({ query, results: data, failed: false }))
        .catch((error) => {
          if (!axios.isCancel(error)) {
            setState({ query, results: [], failed: true });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (query.length < MIN_MESSAGE_QUERY) {
    return null;
  }
  const ready = state.query === query;

  return (
    <section aria-live="polite" className="mt-4">
      <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tInbox("messages_heading")}
      </h3>
      {!ready && <p className="py-4 text-center text-sm text-muted-foreground">{t("searching")}</p>}
      {ready && state.failed && <p className="py-4 text-center text-sm text-rose-500">{t("failed")}</p>}
      {ready && !state.failed && state.results.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("no_results")}</p>
      )}
      {ready && state.results.length > 0 && (
        <ul className="flex flex-col">
          {state.results.map((result) => (
            <li key={result.id}>
              <Link
                href={`/conversations/${result.conversation.id}?message=${result.id}`}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-muted">
                <Image
                  src={result.sender.image || "/images/placeholder.jpg"}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {result.conversation.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(new Date(result.createdAt), "P", { locale: dateLocale })}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {result.conversation.isGroup && result.sender.name && `${result.sender.name}: `}
                    <SearchHighlight text={result.body ?? ""} query={query} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default MessageSearchResults;
