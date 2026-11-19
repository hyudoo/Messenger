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
import PrivacySettings from "./PrivacySettings";
import SecuritySettings from "./SecuritySettings";
import DeleteAccount from "./DeleteAccount";
import Input from "../inputs/Input";
import Modal from "../modals/Modal";
import Button from "../Button";
import { Theme, useTheme } from "../providers/ThemeProvider";
import { getNotificationState, setNotificationsEnabled } from "@/app/libs/notifications";

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

// Profile (saved to the server), the theme (applies at once in this browser, like the portfolio
// CMS settings page) and the language (applied on Save, see selectedLocale).
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
  // Chosen here, applied on Save: switching the locale navigates to /<locale>/..., which remounts
  // everything under app/[locale] and would close the modal mid-edit
  const [selectedLocale, setSelectedLocale] = useState(locale);
  // Notifications apply at once, like the theme. Read from the browser while the modal is open
  // (never on the server, where the modal is closed); bumped to re-read after a change.
  const [, setNotificationVersion] = useState(0);
  const notificationState = isOpen ? getNotificationState() : "unsupported";
  const toggleNotifications = async () => {
    const next = await setNotificationsEnabled(notificationState !== "on", locale);
    setNotificationVersion((version) => version + 1);
    if (next === "denied") {
      toast.error(t("settings.notifications_denied"));
    }
  };

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isDirty },
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
      shouldDirty: true,
    });
  };

  // a language picked but not saved is dropped
  const handleClose = () => {
    setSelectedLocale(locale);
    onClose();
  };

  const applyLocale = () => {
    onClose();
    // the navigation renders the new locale from the server, so no refresh is needed
    router.replace(pathname, { locale: selectedLocale });
  };

  const onSubmit: SubmitHandler<FieldValues> = (data) => {
    const localeChanged = selectedLocale !== locale;
    // only the language changed: nothing to send to the server
    if (!isDirty) {
      if (localeChanged) {
        applyLocale();
      } else {
        onClose();
      }
      return;
    }

    setIsLoading(true);
    axios
      .post("/api/settings", data)
      .then(() => {
        if (localeChanged) {
          applyLocale();
        } else {
          router.refresh();
          onClose();
        }
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setIsLoading(false));
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
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
                      aria-checked={selectedLocale === value}
                      onClick={() => setSelectedLocale(value)}
                      className={choiceClass(selectedLocale === value)}>
                      {t(`language.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-border pb-12">
            <h2 className="text-base font-semibold leading-7 text-foreground">
              {t("settings.notifications_title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("settings.notifications_description")}
            </p>
            <div className="mt-6">
              {notificationState === "unsupported" || notificationState === "denied" ? (
                <p className="text-sm text-muted-foreground">
                  {notificationState === "denied"
                    ? t("settings.notifications_denied")
                    : t("settings.notifications_unsupported")}
                </p>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={notificationState === "on"}
                  onClick={toggleNotifications}
                  className="flex items-center gap-3 text-sm font-medium text-foreground">
                  <span
                    className={clsx(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full transition",
                      notificationState === "on" ? "bg-sky-500" : "bg-muted"
                    )}>
                    <span
                      className={clsx(
                        "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
                        notificationState === "on" ? "left-[22px]" : "left-0.5"
                      )}
                    />
                  </span>
                  {t("settings.notifications_toggle")}
                </button>
              )}
            </div>
          </div>

          {isOpen && <PrivacySettings />}

          {isOpen && <SecuritySettings />}

          {isOpen && <DeleteAccount />}
        </div>

        <div
          className="
        mt-6
        flex
        items-center
        justify-end
        gap-x-6
        ">
          <Button disabled={isLoading} secondary onClick={handleClose}>
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
