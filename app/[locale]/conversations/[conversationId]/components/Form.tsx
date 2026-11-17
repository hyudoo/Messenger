"use client";

import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { HiCheck, HiPaperAirplane, HiPhoto, HiXMark } from "react-icons/hi2";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import MessageInput from "./MessageInput";
import { MessageSnippet } from "./MessageReply";
import ImageUploadButton from "@/app/components/ImageUploadButton";
import EmojiPicker from "@/app/components/EmojiPicker";
import useComposer from "@/app/hooks/useComposer";
import useConversation from "@/app/hooks/useConversation";
import useOutbox from "@/app/hooks/useOutbox";
import { QUICK_EMOJI } from "@/app/libs/emoji";
import { getSocket } from "@/app/libs/socket-client";
import { UploadError, uploadImage } from "@/app/libs/upload";
import { FullMessageType, ReplyPreview } from "@/app/types";

const INPUT_ID = "message";
// while typing, "typing" is re-sent this often (the others stop showing it after a few seconds)
const TYPING_REFRESH_MS = 3000;

const toPreview = (message: FullMessageType): ReplyPreview => ({
  id: message.id,
  body: message.body,
  image: message.image,
  isCall: message.isCall,
  deletedAt: message.deletedAt,
  sender: { name: message.sender?.name ?? null, email: message.sender?.email ?? null },
});

// The composer. Sending goes through the outbox (app/hooks/useOutbox.ts): the message shows at
// once in the chat and offers a retry there if it fails, so the input is cleared straight away.
// Replying and editing are started from a message's actions (app/hooks/useComposer.ts).
const Form = () => {
  const t = useTranslations("chat");
  const tUpload = useTranslations("upload");
  const { conversationId } = useConversation();
  const send = useOutbox((state) => state.send);
  const composer = useComposer();
  // only for this conversation (a reply started elsewhere doesn't follow the user here)
  const replyTo = composer.conversationId === conversationId ? composer.replyTo : null;
  const editing = composer.conversationId === conversationId ? composer.editing : null;
  const [message, setMessage] = useState("");
  const [isPasting, setIsPasting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // when "typing" was last sent (0: not typing); an object so the unmount cleanup can hold it
  const typing = useRef({ sentAt: 0 });
  const isEmpty = message.trim().length === 0;

  // starting an edit puts the message's text in the input; a reply just focuses it
  useEffect(
    () =>
      useComposer.subscribe((state, previous) => {
        if (state.editing && state.editing !== previous.editing) {
          setMessage(state.editing.body ?? "");
        } else if (!state.editing && previous.editing) {
          setMessage("");
        }
        if (state.editing !== previous.editing || state.replyTo !== previous.replyTo) {
          inputRef.current?.focus();
        }
      }),
    []
  );

  const stopTyping = () => {
    if (typing.current.sentAt) {
      getSocket().emit("typing", conversationId, false);
      typing.current.sentAt = 0;
    }
  };

  // leaving the chat (or the page) while typing
  useEffect(() => {
    const state = typing.current;
    return () => {
      if (state.sentAt) {
        getSocket().emit("typing", conversationId, false);
        state.sentAt = 0;
      }
    };
  }, [conversationId]);

  const changeMessage = (value: string) => {
    setMessage(value);
    if (editing) {
      return; // editing isn't "typing a new message"
    }
    if (!value.trim()) {
      stopTyping();
    } else if (Date.now() - typing.current.sentAt > TYPING_REFRESH_MS) {
      getSocket().emit("typing", conversationId, true);
      typing.current.sentAt = Date.now();
    }
  };

  const submitEdit = (target: FullMessageType) => {
    const text = message.trim();
    composer.cancel();
    if (text === (target.body ?? "").trim()) {
      return; // unchanged
    }
    // the chat shows the edit when the conversation room sends it back (messages:update)
    axios.patch(`/api/messages/${target.id}`, { message: text }).catch((error) => {
      toast.error(
        error?.response?.status === 403 ? t("edit_expired") : t("edit_failed")
      );
    });
  };

  const submit = () => {
    if (isEmpty) {
      return;
    }
    stopTyping();
    if (editing) {
      submitEdit(editing);
      return;
    }
    send(
      conversationId,
      { message, ...(replyTo && { replyToId: replyTo.id }) },
      replyTo ? toPreview(replyTo) : undefined
    );
    if (replyTo) {
      composer.cancel();
    }
    setMessage("");
    inputRef.current?.focus();
  };

  // empty input: the send button sends a 👍 straight away
  const sendQuickEmoji = () => {
    send(
      conversationId,
      { message: QUICK_EMOJI, ...(replyTo && { replyToId: replyTo.id }) },
      replyTo ? toPreview(replyTo) : undefined
    );
    if (replyTo) {
      composer.cancel();
    }
  };

  const sendImage = (url: string) => send(conversationId, { image: url });

  // inserts at the caret (or replaces the selection), keeping the picker open
  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? message.length;
    const end = input?.selectionEnd ?? message.length;
    changeMessage(message.slice(0, start) + emoji + message.slice(end));
    // after React wrote the new value into the textarea
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      input?.setSelectionRange(caret, caret);
    });
  };

  // a pasted image (screenshot, copied picture) is uploaded and sent like a picked one;
  // pasted text goes into the input as usual
  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith("image/")
    );
    if (!file) {
      return;
    }
    event.preventDefault();
    if (isPasting) {
      return;
    }
    setIsPasting(true);
    const uploading = toast.loading(t("image_uploading"));
    try {
      sendImage(await uploadImage(file));
      toast.dismiss(uploading);
    } catch (error) {
      toast.error(tUpload(error instanceof UploadError ? error.code : "failed"), {
        id: uploading,
      });
    } finally {
      setIsPasting(false);
    }
  };

  return (
    <div className="bg-background border-t w-full">
      {(replyTo || editing) && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {editing
                ? t("editing")
                : t("replying_to", { name: replyTo?.sender?.name ?? "" })}
            </div>
            <div className="truncate text-muted-foreground">
              <MessageSnippet message={(editing ?? replyTo)!} />
            </div>
          </div>
          <button
            type="button"
            onClick={composer.cancel}
            aria-label={t("cancel_compose")}
            title={t("cancel_compose")}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <HiXMark size={18} aria-hidden />
          </button>
        </div>
      )}
      <div
        className="
      py-4
      px-4
      flex
      items-end
      gap-2
      lg:gap-4
      w-full">
        {!editing && (
          <div className="flex h-10 shrink-0 items-center gap-2 lg:gap-4">
            <ImageUploadButton onUpload={sendImage} disabled={isPasting}>
              <HiPhoto size={30} className="text-sky-500" aria-label={t("attach_image")} />
            </ImageUploadButton>
            <EmojiPicker onSelect={insertEmoji} />
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 lg:gap-4 w-full">
          <MessageInput
            id={INPUT_ID}
            ref={inputRef}
            value={message}
            onChange={changeMessage}
            onSubmit={submit}
            onEscape={replyTo || editing ? composer.cancel : undefined}
            onBlur={stopTyping}
            onPaste={editing ? undefined : handlePaste}
            placeholder={t("placeholder")}
          />
          <div className="flex h-10 shrink-0 items-center">
            {isEmpty && !editing ? (
              <button
                type="button"
                onClick={sendQuickEmoji}
                aria-label={t("send_quick", { emoji: QUICK_EMOJI })}
                title={t("send_quick", { emoji: QUICK_EMOJI })}
                className="
                  flex
                  h-[34px]
                  w-[34px]
                  items-center
                  justify-center
                  rounded-full
                  text-2xl
                  leading-none
                  transition
                  hover:scale-110
                  active:scale-95
                  ">
                {QUICK_EMOJI}
              </button>
            ) : (
              <button
                type="submit"
                disabled={isEmpty}
                aria-label={editing ? t("save_edit") : t("send")}
                title={editing ? t("save_edit") : undefined}
                className="
                  rounded-full
                  p-2
                  bg-sky-500
                  cursor-pointer
                  hover:bg-sky-600
                  disabled:opacity-50
                  transition
                  ">
                {editing ? (
                  <HiCheck size={18} className="text-white" />
                ) : (
                  <HiPaperAirplane size={18} className="text-white" />
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default Form;
