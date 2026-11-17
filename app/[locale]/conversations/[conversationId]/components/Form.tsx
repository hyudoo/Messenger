"use client";

import { useRef, useState } from "react";
import { HiPaperAirplane, HiPhoto } from "react-icons/hi2";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";

import MessageInput from "./MessageInput";
import ImageUploadButton from "@/app/components/ImageUploadButton";
import EmojiPicker from "@/app/components/EmojiPicker";
import useConversation from "@/app/hooks/useConversation";
import useOutbox from "@/app/hooks/useOutbox";
import { QUICK_EMOJI } from "@/app/libs/emoji";
import { UploadError, uploadImage } from "@/app/libs/upload";

const INPUT_ID = "message";

// The composer. Sending goes through the outbox (app/hooks/useOutbox.ts): the message shows at
// once in the chat and offers a retry there if it fails, so the input is cleared straight away.
const Form = () => {
  const t = useTranslations("chat");
  const tUpload = useTranslations("upload");
  const { conversationId } = useConversation();
  const send = useOutbox((state) => state.send);
  const [message, setMessage] = useState("");
  const [isPasting, setIsPasting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isEmpty = message.trim().length === 0;

  const submit = () => {
    if (isEmpty) {
      return;
    }
    send(conversationId, { message });
    setMessage("");
    inputRef.current?.focus();
  };

  // empty input: the send button sends a 👍 straight away
  const sendQuickEmoji = () => send(conversationId, { message: QUICK_EMOJI });

  const sendImage = (url: string) => send(conversationId, { image: url });

  // inserts at the caret (or replaces the selection), keeping the picker open
  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? message.length;
    const end = input?.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + emoji + message.slice(end));
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
    <div
      className="
    py-4
    px-4
    bg-background
    border-t
    flex
    items-end
    gap-2
    lg:gap-4
    w-full">
      <div className="flex h-10 shrink-0 items-center gap-2 lg:gap-4">
        <ImageUploadButton onUpload={sendImage} disabled={isPasting}>
          <HiPhoto size={30} className="text-sky-500" aria-label={t("attach_image")} />
        </ImageUploadButton>
        <EmojiPicker onSelect={insertEmoji} />
      </div>

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
          onChange={setMessage}
          onSubmit={submit}
          onPaste={handlePaste}
          placeholder={t("placeholder")}
        />
        <div className="flex h-10 shrink-0 items-center">
          {isEmpty ? (
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
              aria-label={t("send")}
              className="
                rounded-full
                p-2
                bg-sky-500
                cursor-pointer
                hover:bg-sky-600
                transition
                ">
              <HiPaperAirplane size={18} className="text-white" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default Form;
