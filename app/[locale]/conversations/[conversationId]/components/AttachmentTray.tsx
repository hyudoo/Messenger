"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { HiArrowPath, HiOutlineDocument, HiXMark } from "react-icons/hi2";

import {
  FILE_TYPES,
  IMAGE_TYPES,
  UploadError,
  baseContentType,
  formatFileSize,
  uploadFile,
} from "@/app/libs/upload";

// how many images / files one send may carry
export const MAX_TRAY_ITEMS = 10;

export interface TrayItem {
  id: string;
  kind: "image" | "file";
  file: File;
  // images: a local preview (object URL) until sent
  preview?: string;
  status: "uploading" | "ready" | "failed";
  // while uploading: the share sent (0..1)
  progress?: number;
  // the uploaded file's public URL once ready
  url?: string;
}

let nextId = 0;

// Images and files picked, pasted or dropped into the composer: each uploads at once and waits
// in the tray (with a preview) until the message is sent.
export const useAttachmentTray = () => {
  const t = useTranslations();
  const [items, setItems] = useState<TrayItem[]>([]);
  // for revoking the previews on unmount
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  useEffect(() => () => itemsRef.current.forEach((item) => revoke(item)), []);

  const patch = (id: string, changes: Partial<TrayItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const upload = async (item: TrayItem) => {
    try {
      const url = await uploadFile(item.file, item.kind, (progress) =>
        patch(item.id, { progress })
      );
      patch(item.id, { status: "ready", url });
    } catch (error) {
      patch(item.id, { status: "failed" });
      const code = error instanceof UploadError ? error.code : "failed";
      toast.error(
        item.kind === "file" && (code === "unsupported_type" || code === "too_large")
          ? t(`upload.file_${code}`)
          : t(`upload.${code}`)
      );
    }
  };

  const add = (files: File[]) => {
    const room = MAX_TRAY_ITEMS - itemsRef.current.length;
    if (files.length > room) {
      toast.error(t("chat.attachments_too_many", { max: MAX_TRAY_ITEMS }));
    }
    const added: TrayItem[] = [];
    files.slice(0, Math.max(room, 0)).forEach((file) => {
      const type = baseContentType(file.type);
      const kind = IMAGE_TYPES[type] ? "image" : FILE_TYPES[type] ? "file" : null;
      if (!kind) {
        toast.error(t("upload.file_unsupported_type"));
        return;
      }
      added.push({
        id: `tray-${nextId++}`,
        kind,
        file,
        preview: kind === "image" ? URL.createObjectURL(file) : undefined,
        status: "uploading",
      });
    });
    if (added.length === 0) {
      return;
    }
    setItems((current) => [...current, ...added]);
    added.forEach(upload);
  };

  const remove = (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item) {
      revoke(item);
    }
    setItems((current) => current.filter((entry) => entry.id !== id));
  };

  const retry = (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item?.status === "failed") {
      patch(id, { status: "uploading", progress: 0 });
      upload(item);
    }
  };

  // drops the ready ones (after sending them); failed ones stay for a retry
  const takeReady = () => {
    const ready = itemsRef.current.filter((item) => item.status === "ready");
    ready.forEach(revoke);
    setItems((current) => current.filter((item) => item.status !== "ready"));
    return ready;
  };

  return {
    items,
    add,
    remove,
    retry,
    takeReady,
    uploading: items.some((item) => item.status === "uploading"),
    readyCount: items.filter((item) => item.status === "ready").length,
  };
};

const revoke = (item: TrayItem) => {
  if (item.preview) {
    URL.revokeObjectURL(item.preview);
  }
};

interface AttachmentTrayProps {
  items: TrayItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

// The tray above the composer: image thumbnails and file chips, each with its upload state.
const AttachmentTray: React.FC<AttachmentTrayProps> = ({ items, onRemove, onRetry }) => {
  const t = useTranslations("chat");
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="flex gap-2 overflow-x-auto border-b px-4 py-3">
      {items.map((item) => (
        <li key={item.id} className="relative shrink-0">
          {item.kind === "image" ? (
            // a local object URL: next/image can't optimize it
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.preview}
              alt={item.file.name}
              className={clsx(
                "h-16 w-16 rounded-lg object-cover",
                item.status !== "ready" && "opacity-60"
              )}
            />
          ) : (
            <div
              className={clsx(
                "flex h-16 w-44 items-center gap-2 rounded-lg bg-muted px-2",
                item.status !== "ready" && "opacity-60"
              )}>
              <HiOutlineDocument size={24} aria-hidden className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium text-foreground">{item.file.name}</div>
                <div className="text-muted-foreground">{formatFileSize(item.file.size)}</div>
              </div>
            </div>
          )}
          {item.status === "uploading" && (
            <div
              className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-background/80"
              role="progressbar"
              aria-label={t("attachment_uploading")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((item.progress ?? 0) * 100)}>
              <div
                className="h-full rounded-full bg-sky-500 transition-[width]"
                style={{ width: `${Math.max((item.progress ?? 0) * 100, 4)}%` }}
              />
            </div>
          )}
          {item.status === "failed" && (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              aria-label={t("attachment_failed")}
              title={t("attachment_failed")}
              className="absolute inset-0 flex items-center justify-center rounded-lg ring-2 ring-rose-500">
              <HiArrowPath size={20} aria-hidden className="text-rose-500" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={t("remove_attachment", { name: item.file.name })}
            title={t("remove_attachment", { name: item.file.name })}
            className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-foreground">
            <HiXMark size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
};

export default AttachmentTray;
