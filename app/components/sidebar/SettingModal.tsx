"use client";

import axios from "axios";
import clsx from "clsx";
import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FieldValues, SubmitHandler, useForm, useWatch } from "react-hook-form";
import Image from "next/image";
import { toast } from "react-hot-toast";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { SafeUser } from "@/app/types";
import ImageUploadButton from "../ImageUploadButton";
import Input from "../inputs/Input";
import Modal from "../modals/Modal";
import Button from "../Button";
import { Theme, useTheme } from "../providers/ThemeProvider";

interface SettingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: SafeUser;
}

const THEMES: Theme[] = ["light", "dark", "system"];

const choiceClass = (selected: boolean) =>
  clsx(
    "rounded-md border px-3 py-2 text-sm font-medium transition",
    selected
      ? "border-sky-500 bg-muted text-foreground ring-1 ring-sky-500"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  );

// Profile (saved to the server) plus appearance and language, which apply at once
// in this browser, like the portfolio CMS settings page.
const SettingModal: React.FC<SettingModalProps> = ({
  isOpen,
  onClose,
  currentUser = {},
}) => {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<FieldValues>({
    defaultValues: {
      name: currentUser?.name,
      image: currentUser?.image,
    },
  });

  const image = useWatch({ control, name: "image" });

  const handleUpload = (url: string) => {
    setValue("image", url, {
      shouldValidate: true,
    });
  };

  const onSubmit: SubmitHandler<FieldValues> = (data) => {
    setIsLoading(true);
    axios
      .post("/api/settings", data)
      .then(() => {
        router.refresh();
        onClose();
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setIsLoading(false));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-12">
          <div className="border-b border-border pb-12">
            <h2
              className="
                 text-base
                 font-semibold
                 leading-7
                 text-foreground">
              {t("settings.profile_title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("settings.profile_description")}
            </p>

            <div className="mt-10 flex flex-col gap-y-8">
              <Input
                disabled={isLoading}
                label={t("settings.name")}
                id="name"
                errors={errors}
                required
                register={register}
              />
              <div>
                <label
                  htmlFor="photo"
                  className="
                  block
                  text-sm
                  font-medium
                  leading-6
                  text-foreground">
                  {t("settings.photo")}
                </label>
                <div className="mt-2 flex items-center gap-x-3">
                  <Image
                    width={48}
                    height={48}
                    className="rounded-full"
                    src={
                      image || currentUser?.image || "/images/placeholder.jpg"
                    }
                    alt={t("common.avatar")}
                  />
                  <ImageUploadButton
                    onUpload={handleUpload}
                    disabled={isLoading}>
                    <Button disabled={isLoading} secondary type="button">
                      {t("settings.change_photo")}
                    </Button>
                  </ImageUploadButton>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-border pb-12">
            <h2 className="text-base font-semibold leading-7 text-foreground">
              {t("settings.appearance_title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("settings.appearance_description")}
            </p>

            <div className="mt-6 flex flex-col gap-y-6">
              <div>
                <span className="block text-sm font-medium leading-6 text-foreground">
                  {t("settings.theme")}
                </span>
                <div
                  role="radiogroup"
                  aria-label={t("settings.theme")}
                  className="mt-2 grid grid-cols-3 gap-3">
                  {THEMES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={theme === value}
                      onClick={() => setTheme(value)}
                      className={choiceClass(theme === value)}>
                      {t(`theme.${value}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium leading-6 text-foreground">
                  {t("settings.language")}
                </span>
                <div
                  role="radiogroup"
                  aria-label={t("settings.language")}
                  className="mt-2 grid grid-cols-2 gap-3">
                  {routing.locales.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={locale === value}
                      onClick={() =>
                        value !== locale && router.replace(pathname, { locale: value })
                      }
                      className={choiceClass(locale === value)}>
                      {t(`language.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="
        mt-6
        flex
        items-center
        justify-end
        gap-x-6
        ">
          <Button disabled={isLoading} secondary onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={isLoading} type="submit">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
export default SettingModal;
