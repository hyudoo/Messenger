"use client";

import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { HiChartBar, HiCheck, HiPaperAirplane, HiPaperClip, HiPhoto, HiXMark } from "react-icons/hi2";
import PollComposer from "./PollComposer";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import MessageInput from "./MessageInput";
import { MessageSnippet } from "./MessageReply";
import AttachmentTray, { useAttachmentTray } from "./AttachmentTray";
import { MicButton, RecordingBar, VoiceRecording, useVoiceRecorder } from "./VoiceRecorder";
import EmojiPicker from "@/app/components/EmojiPicker";
import useComposer from "@/app/hooks/useComposer";
import useConversation from "@/app/hooks/useConversation";
import useOutbox, { OutboxPayload } from "@/app/hooks/useOutbox";
import useDrafts from "@/app/hooks/useDrafts";
import { getSocket } from "@/app/libs/socket-client";
import {
  AUDIO_TYPES,
  FILE_TYPES,
  IMAGE_TYPES,
  UploadError,
  baseContentType,
  uploadFile,
} from "@/app/libs/upload";
import { FullMessageType, ReplyPreview, SafeUser } from "@/app/types";
import MentionPicker, { mentionSuggestions } from "./MentionPicker";
import { useSession } from "next-auth/react";

const INPUT_ID = "message";
// while typing, "typing" is re-sent this often (the others stop showing it after a few seconds)
const TYPING_REFRESH_MS = 3000;

const toPreview = (message: FullMessageType): ReplyPreview => ({
  id: message.id,
  body: message.body,
  image: message.image,
  attachment: message.attachment,
  isCall: message.isCall,
  deletedAt: message.deletedAt,
  sender: { name: message.sender?.name ?? null, email: message.sender?.email ?? null },
});

// what the file picker offers (the same types /api/uploads accepts)
const FILE_ACCEPT = Object.keys(FILE_TYPES).join(",");
const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(",");

// The composer. Sending goes through the outbox (app/hooks/useOutbox.ts): the message shows at
// once in the chat and offers a retry there if it fails, so the input is cleared straight away.
// Replying and editing are started from a message's actions (app/hooks/useComposer.ts).
// Images and files (picked, pasted or dropped) wait in the tray, uploaded, until sent; each
// becomes its own message, before the text. A voice message is recorded, uploaded and sent.
interface FormProps {
  // the conversation's members (a group's "@" picker)
  members: SafeUser[];
  isGroup: boolean;
  // what the quick button sends here (Conversation.quickEmoji, else 👍)
  quickEmoji: string;
}

const Form: React.FC<FormProps> = ({ members, isGroup, quickEmoji }) => {
  // groups: the "New poll" dialog
  const [pollOpen, setPollOpen] = useState(false);
  const t = useTranslations("chat");
  const tUpload = useTranslations("upload");
  const { conversationId } = useConversation();
  const send = useOutbox((state) => state.send);
  const composer = useComposer();
  // only for this conversation (a reply started elsewhere doesn't follow the user here)
  const replyTo = composer.conversationId === conversationId ? composer.replyTo : null;
  const editing = composer.conversationId === conversationId ? composer.editing : null;
  // the text left here before switching chats (useDrafts), kept up to date in changeMessage
  const [message, setMessage] = useState(
    () => useDrafts.getState().drafts[conversationId] ?? ""
  );
  const saveDraft = (text: string) => useDrafts.getState().setDraft(conversationId, text);
  const myEmail = useSession().data?.user?.email;
  // the caret, for the mention picker; the picker closed with Esc at this "@" (its start)
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tray = useAttachmentTray();
  // when "typing" was last sent (0: not typing); an object so the unmount cleanup can hold it
  const typing = useRef({ sentAt: 0 });
  const isEmpty = message.trim().length === 0;
  // something to send: text, or uploaded images / files (none still uploading)
  const canSend = (!isEmpty || tray.readyCount > 0) && !tray.uploading;
  const trayEmpty = tray.items.length === 0;

  // starting an edit puts the message's text in the input; a reply just focuses it
  useEffect(
    () =>
      useComposer.subscribe((state, previous) => {
        if (state.editing && state.editing !== previous.editing) {
          setMessage(state.editing.body ?? "");
        } else if (!state.editing && previous.editing) {
          // back to what was being written before the edit
          setMessage(useDrafts.getState().drafts[previous.editing.conversationId] ?? "");
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

  const changeMessage = (value: string, at = value.length) => {
    setMessage(value);
    setCaret(at);
    setMentionActive(0);
    if (editing) {
      return; // editing isn't "typing a new message" (nor a draft)
    }
    saveDraft(value);
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

  // one message per payload; a reply goes on the text, or on the first one without text
  const sendAll = (payloads: OutboxPayload[]) => {
    const textIndex = payloads.findIndex((payload) => payload.message);
    const replyIndex = textIndex >= 0 ? textIndex : 0;
    payloads.forEach((payload, index) =>
      send(
        conversationId,
        { ...payload, ...(replyTo && index === replyIndex && { replyToId: replyTo.id }) },
        replyTo && index === replyIndex ? toPreview(replyTo) : undefined
      )
    );
    if (replyTo && payloads.length > 0) {
      composer.cancel();
    }
  };

  const submit = () => {
    if (editing) {
      if (!isEmpty) {
        stopTyping();
        submitEdit(editing);
      }
      return;
    }
    if (!canSend) {
      return;
    }
    stopTyping();
    const attachments: OutboxPayload[] = tray.takeReady().map((item) =>
      item.kind === "image"
        ? { image: item.url }
        : {
            attachment: {
              kind: "file",
              url: item.url!,
              name: item.file.name,
              size: item.file.size,
              type: baseContentType(item.file.type),
            },
          }
    );
    sendAll([...attachments, ...(isEmpty ? [] : [{ message }])]);
    setMessage("");
    saveDraft("");
    inputRef.current?.focus();
  };

  // empty input: the send button sends the conversation's quick emoji straight away
  const sendQuickEmoji = () => {
    send(
      conversationId,
      { message: quickEmoji, ...(replyTo && { replyToId: replyTo.id }) },
      replyTo ? toPreview(replyTo) : undefined
    );
    if (replyTo) {
      composer.cancel();
    }
  };

  const recorder = useVoiceRecorder(async ({ blob, type, duration }: VoiceRecording) => {
    const uploading = toast.loading(t("voice_uploading"));
    try {
      const url = await uploadFile(blob, "voice");
      toast.dismiss(uploading);
      sendAll([
        {
          attachment: {
            kind: "voice",
            url,
            name: `voice-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${AUDIO_TYPES[type]}`,
            size: blob.size,
            type,
            duration: Math.round(duration),
          },
        },
      ]);
    } catch (error) {
      const code = error instanceof UploadError ? error.code : "failed";
      toast.error(
        code === "unsupported_type" || code === "too_large"
          ? tUpload(`voice_${code}`)
          : tUpload(code),
        { id: uploading }
      );
    }
  });

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

  // pasted images / files (a screenshot, a copied picture) go to the tray like picked ones;
  // pasted text goes into the input as usual
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    tray.add(files);
  };

  const pickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    tray.add(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  // files dragged onto the composer
  const dropProps = editing
    ? {}
    : {
        onDragOver: (event: React.DragEvent) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        },
        onDragLeave: (event: React.DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          setDragging(false);
          tray.add(Array.from(event.dataTransfer.files));
        },
      };

  // "@…" typed in a group: the members to pick from
  const mention =
    isGroup && !editing ? mentionSuggestions(message, caret, members, myEmail) : null;
  const showMentions = !!mention && mention.start !== mentionDismissed;

  const pickMention = (person: SafeUser) => {
    if (!mention) {
      return;
    }
    const inserted = `@${person.name} `;
    const next = message.slice(0, mention.start) + inserted + message.slice(caret);
    const at = mention.start + inserted.length;
    changeMessage(next, at);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
  };

  const mentionKeys = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentions || !mention) {
      return false;
    }
    const count = mention.people.length;
    if (event.key === "ArrowDown") {
      setMentionActive((index) => (index + 1) % count);
      return true;
    }
    if (event.key === "ArrowUp") {
      setMentionActive((index) => (index - 1 + count) % count);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      pickMention(mention.people[Math.min(mentionActive, count - 1)]);
      return true;
    }
    if (event.key === "Escape") {
      setMentionDismissed(mention.start);
      return true;
    }
    return false;
  };

  if (recorder.recording) {
    return (
      <div className="w-full border-t bg-background">
        <RecordingBar elapsed={recorder.elapsed} onCancel={recorder.cancel} onSend={recorder.send} />
      </div>
    );
  }

  return (
    <div className="relative w-full border-t bg-background" {...dropProps}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-chat bg-background/90 text-sm font-medium text-chat">
          {t("drop_files")}
        </div>
      )}
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
      {!editing && <AttachmentTray items={tray.items} onRemove={tray.remove} onRetry={tray.retry} />}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={pickFiles}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={pickFiles}
      />
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
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label={t("attach_image")}
              title={t("attach_image")}
              className="text-chat transition hover:text-chat/80">
              <HiPhoto size={30} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("attach_file")}
              title={t("attach_file")}
              className="text-chat transition hover:text-chat/80">
              <HiPaperClip size={24} aria-hidden />
            </button>
            <MicButton onClick={recorder.start} />
            {isGroup && (
              <button
                type="button"
                onClick={() => setPollOpen(true)}
                aria-label={t("new_poll")}
                title={t("new_poll")}
                className="text-chat transition hover:text-chat/80">
                <HiChartBar size={24} aria-hidden />
              </button>
            )}
            <EmojiPicker onSelect={insertEmoji} />
          </div>
        )}
        {isGroup && (
          <PollComposer
            conversationId={conversationId}
            isOpen={pollOpen}
            onClose={() => setPollOpen(false)}
          />
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="relative flex items-end gap-2 lg:gap-4 w-full">
          {showMentions && mention && (
            <MentionPicker
              people={mention.people}
              active={Math.min(mentionActive, mention.people.length - 1)}
              onPick={pickMention}
            />
          )}
          <MessageInput
            id={INPUT_ID}
            ref={inputRef}
            value={message}
            onChange={changeMessage}
            onCaret={setCaret}
            onKeyDownFirst={mentionKeys}
            onSubmit={submit}
            onEscape={replyTo || editing ? composer.cancel : undefined}
            onBlur={stopTyping}
            onPaste={editing ? undefined : handlePaste}
            placeholder={t("placeholder")}
          />
          <div className="flex h-10 shrink-0 items-center">
            {isEmpty && trayEmpty && !editing ? (
              <button
                type="button"
                onClick={sendQuickEmoji}
                aria-label={t("send_quick", { emoji: quickEmoji })}
                title={t("send_quick", { emoji: quickEmoji })}
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
                {quickEmoji}
              </button>
            ) : (
              <button
                type="submit"
                disabled={editing ? isEmpty : !canSend}
                aria-label={editing ? t("save_edit") : t("send")}
                title={editing ? t("save_edit") : undefined}
                className="
                  rounded-full
                  p-2
                  bg-chat
                  cursor-pointer
                  hover:bg-chat/90
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
