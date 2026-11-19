"use client";

import axios from "axios";
import clsx from "clsx";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiCheck, HiChartBar, HiLockClosed } from "react-icons/hi2";

import { PollView, canClosePoll, nextPicks, tallyPoll } from "@/app/libs/poll-rules";
import { useChatPeople } from "./ChatPeople";

interface PollCardProps {
  poll: PollView;
  isOwn: boolean;
  myEmail?: string | null;
  // who asked it: they may close it, and so may the group's admins
  senderId: string;
}

// A group poll in the chat: the question, each option with its share of the voters (a bar, the
// count, who on hover) and the user's own picks ticked. A click votes: one option (again: takes it
// back) or several, as the poll allows. The new votes show at once and are replaced by the
// server's (messages:update); a failed vote drops them. Closed: results only.
const PollCard: React.FC<PollCardProps> = ({ poll, isOwn, myEmail, senderId }) => {
  const t = useTranslations("poll");
  const { members, nameOfId, roles } = useChatPeople();
  const myId = members.find((member) => !!myEmail && member.email === myEmail)?.id;
  const canClose = !!myId && canClosePoll(roles, { senderId }, myId);
  const [busy, setBusy] = useState(false);
  // optimistic votes, kept only while poll.votes is still the list they were made from
  const [optimistic, setOptimistic] = useState<{
    from: PollView["votes"];
    value: PollView["votes"];
  } | null>(null);
  const shown =
    optimistic && optimistic.from === poll.votes ? { ...poll, votes: optimistic.value } : poll;
  const { counts, voters, mine } = tallyPoll(shown, myId);
  const closed = !!poll.closedAt;
  const nameOf = (id: string) => nameOfId(id) ?? t("someone");

  const vote = (optionId: string) => {
    if (!myId || closed || busy) {
      return;
    }
    const picks = nextPicks(poll, mine, optionId);
    setOptimistic({
      from: poll.votes,
      value: [
        ...poll.votes.filter((item) => item.userId !== myId),
        ...picks.map((id) => ({ optionId: id, userId: myId })),
      ],
    });
    setBusy(true);
    axios
      .post(`/api/polls/${poll.id}/votes`, { optionIds: picks })
      .catch((error) => {
        setOptimistic(null);
        toast.error(
          error?.response?.status === 409
            ? t("closed_error")
            : error?.response?.status === 429
              ? t("too_fast")
              : t("vote_failed")
        );
      })
      .finally(() => setBusy(false));
  };

  const close = () => {
    setBusy(true);
    axios
      .post(`/api/polls/${poll.id}/close`)
      .catch(() => toast.error(t("close_failed")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-1 flex w-64 max-w-full flex-col gap-2 sm:w-72">
      <p className={clsx("flex items-center gap-1.5 text-xs", isOwn ? "text-sky-100" : "text-muted-foreground")}>
        <HiChartBar size={14} aria-hidden />
        {poll.multiple ? t("label_multiple") : t("label_single")}
        {closed && (
          <span className="ml-auto flex items-center gap-1">
            <HiLockClosed size={12} aria-hidden />
            {t("closed")}
          </span>
        )}
      </p>
      <p className="whitespace-pre-wrap font-semibold [overflow-wrap:anywhere]">{poll.question}</p>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((option) => {
          const who = counts.get(option.id) ?? [];
          const share = voters > 0 ? Math.round((who.length / voters) * 100) : 0;
          const picked = mine.has(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={closed || !myId}
                aria-pressed={picked}
                onClick={() => vote(option.id)}
                title={who.length > 0 ? who.map(nameOf).join(", ") : undefined}
                className={clsx(
                  "relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default",
                  isOwn ? "border-white/30" : "border-border",
                  !closed && (isOwn ? "hover:bg-white/10" : "hover:bg-muted")
                )}>
                {/* the option's share of the voters */}
                <span
                  aria-hidden
                  className={clsx("absolute inset-y-0 left-0", isOwn ? "bg-white/20" : "bg-sky-500/15")}
                  style={{ width: `${share}%` }}
                />
                <span className="relative flex items-center gap-2">
                  <span
                    aria-hidden
                    className={clsx(
                      "flex h-4 w-4 shrink-0 items-center justify-center border",
                      poll.multiple ? "rounded" : "rounded-full",
                      picked
                        ? isOwn
                          ? "border-white bg-white text-sky-500"
                          : "border-sky-500 bg-sky-500 text-white"
                        : isOwn
                          ? "border-white/60"
                          : "border-border"
                    )}>
                    {picked && <HiCheck size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.text}</span>
                  <span className="shrink-0 tabular-nums text-xs opacity-80">{who.length}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={clsx("flex items-center justify-between gap-2 text-xs", isOwn ? "text-sky-100" : "text-muted-foreground")}>
        <span>{t("voters", { count: voters })}</span>
        {canClose && !closed && (
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline disabled:opacity-50">
            {t("close")}
          </button>
        )}
      </p>
    </div>
  );
};

export default PollCard;
