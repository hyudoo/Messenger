"use client";

import axios from "axios";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import { MIN_NAME_QUERY } from "@/app/libs/search";
import { useRouter } from "@/i18n/navigation";

// wait this long after the last keystroke before asking the server
const SEARCH_DELAY_MS = 300;

type Relation = "friend" | "incoming" | "outgoing" | "none";

interface Person {
  id: string;
  name: string | null;
  image: string | null;
  relation: Relation;
}

// Whether the query is worth a server search: an email, or a name of MIN_NAME_QUERY characters.
export const searchesPeople = (query: string) =>
  query.includes("@") ? query.length >= 3 : query.length >= MIN_NAME_QUERY;

// The contacts page's "Find people" part (GET /api/users/search): people by exact email or by name,
// without their email. Add friend / accept their request / already asked; a click on the person
// opens a chat with them (chatting needs no friendship). Friends are left out: the friends list
// above shows them.
const PeopleSearch: React.FC<{ query: string }> = ({ query }) => {
  const t = useTranslations("users");
  const router = useRouter();
  const [state, setState] = useState<{ query: string; people: Person[]; failed: boolean }>({
    query: "",
    people: [],
    failed: false,
  });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!searchesPeople(query)) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      axios
        .get<Person[]>("/api/users/search", { params: { q: query }, signal: controller.signal })
        .then(({ data }) => setState({ query, people: data, failed: false }))
        .catch((error) => {
          if (!axios.isCancel(error)) {
            setState({ query, people: [], failed: true });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (!searchesPeople(query)) {
    return null;
  }
  const ready = state.query === query;
  const people = state.people.filter((person) => person.relation !== "friend");

  // "Add friend", or "Accept" when they asked first (the same request: it accepts theirs)
  const addFriend = async (person: Person) => {
    setBusy(person.id);
    try {
      const { data } = await axios.post<{ status: string }>("/api/friends/requests", {
        userId: person.id,
      });
      const relation: Relation =
        data.status === "accepted" || data.status === "friends" ? "friend" : "outgoing";
      setState((current) => ({
        ...current,
        people: current.people.map((item) => (item.id === person.id ? { ...item, relation } : item)),
      }));
      if (relation === "friend") {
        toast.success(t("now_friends", { name: person.name ?? "" }));
      }
      router.refresh();
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      toast.error(
        status === 403 ? t("cannot_add") : status === 409 ? t("too_many") : status === 429 ? t("too_fast") : t("failed")
      );
    } finally {
      setBusy(null);
    }
  };

  const openChat = (person: Person) => {
    setBusy(person.id);
    axios
      .post<{ id: string }>("/api/conversations", { userId: person.id })
      .then(({ data }) => router.push(`/conversations/${data.id}`))
      .catch(() => toast.error(t("failed")))
      .finally(() => setBusy(null));
  };

  return (
    <section aria-live="polite" className="mt-4">
      <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("people_heading")}
      </h3>
      {!ready && <p className="py-4 text-center text-sm text-muted-foreground">{t("searching")}</p>}
      {ready && state.failed && <p className="py-4 text-center text-sm text-rose-500">{t("failed")}</p>}
      {ready && !state.failed && people.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("no_people")}</p>
      )}
      {ready && people.length > 0 && (
        <ul className="flex flex-col">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted">
              <button
                type="button"
                disabled={busy === person.id}
                onClick={() => openChat(person)}
                title={t("open_chat")}
                className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Image
                  src={person.image || "/images/placeholder.jpg"}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
                <span className="truncate text-sm font-medium text-foreground">{person.name}</span>
              </button>
              {person.relation === "outgoing" ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t("requested")}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy === person.id}
                  onClick={() => addFriend(person)}
                  className="shrink-0 rounded-md bg-sky-500 px-2 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
                  {person.relation === "incoming" ? t("accept") : t("add_friend")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default PeopleSearch;
