"use client";

import axios from "axios";
import Image from "next/image";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import type { FriendRequestItem } from "@/app/actions/getFriendRequests";
import { useRouter } from "@/i18n/navigation";

import CollapsibleSection from "./CollapsibleSection";

interface FriendRequestsProps {
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
}

// Friend requests on the contacts page: the ones waiting for the user (Accept / Decline) and the
// ones they sent (Cancel). The page reloads after each answer, and when the other side changes
// something (contacts:update, UserList).
const FriendRequests: React.FC<FriendRequestsProps> = ({ incoming, outgoing }) => {
  const t = useTranslations("users");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, request: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await request();
      router.refresh();
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // 404: answered or cancelled meanwhile; the reload shows how it stands
      if (status === 404) {
        router.refresh();
      } else {
        toast.error(status === 429 ? t("too_fast") : t("failed"));
      }
    } finally {
      setBusy(null);
    }
  };

  if (incoming.length === 0 && outgoing.length === 0) {
    return null;
  }

  const row = (request: FriendRequestItem, actions: React.ReactNode) => (
    <li key={request.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
      <Image
        src={request.user.image || "/images/placeholder.jpg"}
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {request.user.name}
      </span>
      {actions}
    </li>
  );

  return (
    <>
      {incoming.length > 0 && (
        <CollapsibleSection storageKey="incoming" className="mb-2" title={t("requests_heading", { count: incoming.length })}>
          <ul className="flex flex-col">
            {incoming.map((request) =>
              row(
                request,
                <>
                  <button
                    type="button"
                    disabled={busy === request.id}
                    onClick={() =>
                      run(request.id, () =>
                        axios.post(`/api/friends/requests/${request.id}`, { accept: true })
                      )
                    }
                    className="shrink-0 rounded-md bg-sky-500 px-2 py-1 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    disabled={busy === request.id}
                    onClick={() =>
                      run(request.id, () =>
                        axios.post(`/api/friends/requests/${request.id}`, { accept: false })
                      )
                    }
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                    {t("decline")}
                  </button>
                </>
              )
            )}
          </ul>
        </CollapsibleSection>
      )}
      {outgoing.length > 0 && (
        <CollapsibleSection storageKey="outgoing" className="mb-2" title={t("sent_heading", { count: outgoing.length })}>
          <ul className="flex flex-col">
            {outgoing.map((request) =>
              row(
                request,
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() =>
                    run(request.id, () => axios.delete(`/api/friends/requests/${request.id}`))
                  }
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                  {t("cancel")}
                </button>
              )
            )}
          </ul>
        </CollapsibleSection>
      )}
    </>
  );
};

export default FriendRequests;
