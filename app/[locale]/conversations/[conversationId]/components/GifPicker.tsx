"use client";

import axios from "axios";
import clsx from "clsx";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useLocale, useTranslations } from "next-intl";

import SearchInput from "@/app/components/inputs/SearchInput";
import type { GifData, GifKind, GifResult } from "@/app/libs/giphy";

// wait this long after the last keystroke before searching
const SEARCH_DELAY_MS = 350;

type GifShown = Pick<GifData, "kind" | "url" | "width" | "height" | "title">;

// A GIF / sticker message, straight from GIPHY (unoptimized: Next's optimizer would not keep it
// animated). Stickers are smaller and see-through.
export const GifImage: React.FC<{ gif: GifShown }> = ({ gif }) => {
  const t = useTranslations("gif");
  return (
    <Image
      unoptimized
      src={gif.url}
      width={gif.width}
      height={gif.height}
      alt={gif.title || t("untitled")}
      className={clsx("block h-auto", gif.kind === "sticker" ? "w-32" : "w-[200px] max-w-full")}
    />
  );
};

type Page = { results: GifResult[]; next: number | null };

// The picker's body (mounted while it is open): GIFs / stickers tabs, a search (trending while
// empty), a grid of results and "Load more".
const GifPanel: React.FC<{ onPick: (gif: GifData) => void }> = ({ onPick }) => {
  const t = useTranslations("gif");
  const locale = useLocale();
  const [kind, setKind] = useState<GifKind>("gif");
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const key = `${kind}:${trimmed}`;
  const [state, setState] = useState<{ key: string; page: Page; error: string | null }>({
    key: "",
    page: { results: [], next: null },
    error: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = (offset: number, signal?: AbortSignal) =>
    axios
      .get<Page>("/api/gifs", { params: { q: trimmed, kind, offset, lang: locale }, signal })
      .then(({ data }) => data);
  const errorOf = (error: unknown) =>
    axios.isAxiosError(error) && error.response?.status === 429 ? t("too_fast") : t("failed");

  useEffect(() => {
    const controller = new AbortController();
    // trending shows at once, a search after the user stops typing
    const timer = setTimeout(
      () => {
        fetchPage(0, controller.signal)
          .then((page) => setState({ key, page, error: null }))
          .catch((error) => {
            if (!axios.isCancel(error)) {
              setState({ key, page: { results: [], next: null }, error: errorOf(error) });
            }
          });
      },
      trimmed ? SEARCH_DELAY_MS : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // fetchPage / errorOf only read kind / trimmed / locale / t, all covered by key and locale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale]);

  const ready = state.key === key;
  const loadMore = async () => {
    if (state.page.next === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchPage(state.page.next);
      setState((current) =>
        current.key === key
          ? {
              ...current,
              page: {
                // GIPHY pages can overlap when trending changes meanwhile
                results: [
                  ...current.page.results,
                  ...page.results.filter((item) => !current.page.results.some((known) => known.id === item.id)),
                ],
                next: page.next,
              },
            }
          : current
      );
    } catch (error) {
      setState((current) => (current.key === key ? { ...current, error: errorOf(error) } : current));
    } finally {
      setLoadingMore(false);
    }
  };

  const tab = (value: GifKind, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === value}
      onClick={() => setKind(value)}
      className={clsx(
        "flex-1 rounded-md px-2 py-1 text-sm font-medium transition",
        kind === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
      )}>
      {label}
    </button>
  );

  return (
    <div className="flex h-[420px] w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-background p-2 shadow-xl">
      <div role="tablist" className="flex gap-1">
        {tab("gif", t("tab_gifs"))}
        {tab("sticker", t("tab_stickers"))}
      </div>
      <SearchInput value={query} onChange={setQuery} placeholder={t("search")} />
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={!ready}>
        {!ready && <p className="py-6 text-center text-sm text-muted-foreground">…</p>}
        {ready && state.page.results.length === 0 && (
          <p className={clsx("py-6 text-center text-sm", state.error ? "text-rose-500" : "text-muted-foreground")}>
            {state.error ?? t("no_results")}
          </p>
        )}
        {ready && state.page.results.length > 0 && (
          <>
            <div className="columns-2 gap-1">
              {state.page.results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const { preview, ...gif } = item;
                    onPick(gif);
                  }}
                  aria-label={t("send", { title: item.title || t("untitled") })}
                  title={item.title ?? undefined}
                  className={clsx(
                    "mb-1 block w-full overflow-hidden rounded-md transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-chat",
                    item.kind === "sticker" && "bg-muted/50"
                  )}>
                  <Image
                    unoptimized
                    src={item.preview}
                    width={item.width}
                    height={item.height}
                    alt=""
                    loading="lazy"
                    className="block h-auto w-full"
                  />
                </button>
              ))}
            </div>
            {state.error && <p className="py-2 text-center text-xs text-rose-500">{state.error}</p>}
            {state.page.next !== null && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={loadMore}
                className="my-1 w-full rounded-md py-1.5 text-sm text-chat transition hover:bg-muted disabled:opacity-50">
                {t("load_more")}
              </button>
            )}
          </>
        )}
      </div>
      {/* GIPHY's terms ask for its attribution next to its content */}
      <p className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("powered")}
      </p>
    </div>
  );
};

// The composer's "GIF" button: a picker above it; a pick sends at once and closes it.
const GifPicker: React.FC<{ onPick: (gif: GifData) => void }> = ({ onPick }) => {
  const t = useTranslations("chat");
  return (
    <Popover className="relative flex">
      <PopoverButton
        aria-label={t("open_gifs")}
        title={t("open_gifs")}
        className="rounded-md border-2 border-chat px-1 text-[11px] font-bold leading-4 text-chat transition hover:bg-chat/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-chat">
        GIF
      </PopoverButton>
      <PopoverPanel anchor={{ to: "top start", gap: 12 }} className="z-50">
        {({ close }) => (
          <GifPanel
            onPick={(gif) => {
              close();
              onPick(gif);
            }}
          />
        )}
      </PopoverPanel>
    </Popover>
  );
};

export default GifPicker;
