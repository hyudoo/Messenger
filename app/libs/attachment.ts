import { AttachmentKind } from "@prisma/client";

import { isUploadedFileUrl } from "./s3";
import { MAX_VOICE_MS, UPLOAD_RULES } from "./upload";

const MAX_NAME_LENGTH = 200;
// MediaRecorder stops a little after the limit; a voice message may run this much longer
const DURATION_SLACK_MS = 5000;

export type AttachmentInput = {
  kind: AttachmentKind;
  url: string;
  name: string;
  size: number;
  type: string;
  duration?: number;
};

const isPositiveInt = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= max;

// A message's attachment as the client sent it, checked: the caller's own upload of that kind,
// an allowed type within the size limit, a name (files) and a length (voice). null when invalid.
export const parseAttachment = (value: unknown, ownerId: string): AttachmentInput | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { kind, url, name, size, type, duration } = value as Record<string, unknown>;
  if (kind !== "file" && kind !== "voice") {
    return null;
  }
  const rules = UPLOAD_RULES[kind];
  if (
    !isUploadedFileUrl(url, ownerId, kind) ||
    typeof type !== "string" ||
    !rules.types[type] ||
    !isPositiveInt(size, rules.maxSize)
  ) {
    return null;
  }
  const cleanName = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
  if (kind === "file" && !cleanName) {
    return null;
  }
  if (kind === "voice" && !isPositiveInt(duration, MAX_VOICE_MS + DURATION_SLACK_MS)) {
    return null;
  }
  return {
    kind,
    url,
    name: cleanName || "voice",
    size,
    type,
    ...(kind === "voice" && { duration: duration as number }),
  };
};
