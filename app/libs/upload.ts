import axios from "axios";

// Rules shared by the client, /api/uploads and the routes that store upload URLs.
// What can be uploaded, by what it is for: a content type maps to the key's extension.
export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// Documents and archives sent as a file message. Nothing a browser would run (HTML, SVG, JS):
// the files are served from the bucket's host as they are.
export const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// Voice messages, as MediaRecorder writes them (Chrome / Firefox: webm or ogg, Safari: mp4).
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};
export const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_VOICE_MS = 5 * 60 * 1000; // a voice message is at most 5 minutes

export type UploadKind = "image" | "file" | "voice";

export const UPLOAD_RULES: Record<UploadKind, { types: Record<string, string>; maxSize: number }> = {
  image: { types: IMAGE_TYPES, maxSize: MAX_IMAGE_SIZE },
  file: { types: FILE_TYPES, maxSize: MAX_FILE_SIZE },
  voice: { types: AUDIO_TYPES, maxSize: MAX_AUDIO_SIZE },
};

// "audio/webm;codecs=opus" -> "audio/webm"
export const baseContentType = (type: string) => type.split(";")[0].trim().toLowerCase();

// the extensions a kind's keys may end with
export const extensionsOf = (kind: UploadKind) =>
  Array.from(new Set(Object.values(UPLOAD_RULES[kind].types)));

interface PresignedUpload {
  uploadUrl: string;
  // signed into the URL (content type, pending tag): must be sent as-is
  headers: Record<string, string>;
  fileUrl: string;
}

// Why an upload failed; the UI shows it through the upload.<code> message
export type UploadErrorCode = "unsupported_type" | "too_large" | "too_many" | "failed";

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
  }
}

// Uploads a file straight from the browser to S3 with a presigned PUT URL and returns its
// public URL. Throws UploadError.
export const uploadFile = async (file: Blob, kind: UploadKind) => {
  const contentType = baseContentType(file.type);
  const rules = UPLOAD_RULES[kind];
  if (!rules.types[contentType]) {
    throw new UploadError("unsupported_type");
  }
  if (file.size > rules.maxSize) {
    throw new UploadError("too_large");
  }

  const { data } = await axios
    .post<PresignedUpload>("/api/uploads", { contentType, size: file.size, kind })
    .catch((error) => {
      throw new UploadError(error?.response?.status === 429 ? "too_many" : "failed");
    });

  const response = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: data.headers,
    body: file,
  });
  if (!response.ok) {
    throw new UploadError("failed");
  }

  return data.fileUrl;
};

export const uploadImage = (file: File) => uploadFile(file, "image");

// "1.2 MB"; sizes are shown in the file card
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};
