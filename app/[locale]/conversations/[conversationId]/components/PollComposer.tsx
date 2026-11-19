"use client";

import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiPlus, HiXMark } from "react-icons/hi2";

import Modal from "@/app/components/modals/Modal";
import {
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MIN_POLL_OPTIONS,
  parseNewPoll,
} from "@/app/libs/poll-rules";

interface PollComposerProps {
  conversationId: string;
  isOpen: boolean;
  onClose: () => void;
}

const EMPTY = { question: "", options: ["", ""], multiple: false };

// "New poll" (groups): a question, 2–10 options (empty rows are dropped, repeats refused, like the
// server's parseNewPoll), one or several answers. Posted with POST /api/conversations/[id]/polls;
// the chat gets it like any message.
const PollComposer: React.FC<PollComposerProps> = ({ conversationId, isOpen, onClose }) => {
  const t = useTranslations("poll");
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const valid = !!parseNewPoll(draft);

  const setOption = (index: number, text: string) =>
    setDraft((current) => ({
      ...current,
      options: current.options.map((option, i) => (i === index ? text : option)),
    }));

  const close = () => {
    onClose();
    setDraft(EMPTY);
  };

  const submit = async () => {
    if (!valid || busy) {
      return;
    }
    setBusy(true);
    try {
      await axios.post(`/api/conversations/${conversationId}/polls`, draft);
      close();
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.status === 429 ? t("too_fast") : t("create_failed")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">{t("new_title")}</h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {t("question")}
          <input
            value={draft.question}
            maxLength={MAX_POLL_QUESTION}
            onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))}
            placeholder={t("question_placeholder")}
            className="rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">{t("options")}</legend>
          {draft.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={option}
                maxLength={MAX_POLL_OPTION}
                onChange={(event) => setOption(index, event.target.value)}
                aria-label={t("option_label", { number: index + 1 })}
                placeholder={t("option_label", { number: index + 1 })}
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {draft.options.length > MIN_POLL_OPTIONS && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      options: current.options.filter((_, i) => i !== index),
                    }))
                  }
                  aria-label={t("remove_option", { number: index + 1 })}
                  className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <HiXMark size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
          {draft.options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, options: [...current.options, ""] }))}
              className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm font-medium text-sky-500 transition hover:bg-muted">
              <HiPlus size={16} aria-hidden />
              {t("add_option")}
            </button>
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.multiple}
            onChange={(event) => setDraft((current) => ({ ...current, multiple: event.target.checked }))}
            className="h-4 w-4 rounded border-border text-sky-500 focus:ring-sky-500"
          />
          {t("allow_multiple")}
        </label>
        <p className="text-xs text-muted-foreground">{t("hint", { min: MIN_POLL_OPTIONS, max: MAX_POLL_OPTIONS })}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
            {t("create")}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PollComposer;
