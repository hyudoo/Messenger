"use client";

import { HiPaperAirplane, HiPhoto } from "react-icons/hi2";
import MessageInput from "./MessageInput";
import {
  FieldValues,
  SubmitHandler,
  useForm,
  useWatch,
} from "react-hook-form";
import axios from "axios";
import { toast } from "react-hot-toast";
import ImageUploadButton from "@/app/components/ImageUploadButton";
import EmojiPicker from "@/app/components/EmojiPicker";
import useConversation from "@/app/hooks/useConversation";
import { QUICK_EMOJI } from "@/app/libs/emoji";
import { useTranslations } from "next-intl";

const INPUT_ID = "message";

const Form = () => {
  const t = useTranslations("chat");
  const { conversationId } = useConversation();

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    control,
    formState: { errors },
  } = useForm<FieldValues>({
    defaultValues: {
      message: "",
    },
  });
  const message: string = useWatch({ control, name: "message" }) ?? "";
  const isEmpty = message.trim().length === 0;

  const sendError = (error: any) =>
    toast.error(
      error?.response?.status === 429
        ? t("send_too_fast")
        : t("send_failed")
    );

  const onSubmit: SubmitHandler<FieldValues> = (data) => {
    setValue("message", "", { shouldValidate: true });
    axios
      .post("/api/messages", {
        ...data,
        conversationId,
      })
      .catch((error) => {
        // give the text back so it isn't lost
        setValue("message", data.message);
        sendError(error);
      });
  };

  // empty input: the send button sends a 👍 straight away
  const sendQuickEmoji = () => {
    axios
      .post("/api/messages", { message: QUICK_EMOJI, conversationId })
      .catch(sendError);
  };

  // inserts at the caret (or replaces the selection), keeping the picker open
  const insertEmoji = (emoji: string) => {
    const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
    const value: string = getValues("message") ?? "";
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    setValue("message", value.slice(0, start) + emoji + value.slice(end), {
      shouldDirty: true,
    });
    // after react-hook-form wrote the new value into the input
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      input?.setSelectionRange(caret, caret);
    });
  };

  const handleUpload = (url: string) => {
    axios
      .post("/api/messages", {
        image: url,
        conversationId,
      })
      .catch(sendError);
  };

  return (
    <div
      className="
    py-4
    px-4
    bg-background
    border-t
    flex
    items-center
    gap-2
    lg:gap-4
    w-full">
      <ImageUploadButton onUpload={handleUpload}>
        <HiPhoto size={30} className="text-sky-500" aria-label={t("attach_image")} />
      </ImageUploadButton>
      <EmojiPicker onSelect={insertEmoji} />

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex items-center gap-2 lg:gap-4 w-full">
        <MessageInput
          id={INPUT_ID}
          register={register}
          errors={errors}
          required
          placeholder={t("placeholder")}
        />
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
              shrink-0
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
              shrink-0
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
      </form>
    </div>
  );
};

export default Form;
