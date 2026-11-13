import axios from "axios";

// Rules shared by the client and /api/uploads
export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

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

// Uploads an image straight from the browser to S3 with a presigned PUT URL
// and returns its public URL. Throws UploadError.
export const uploadImage = async (file: File) => {
  if (!IMAGE_TYPES[file.type]) {
    throw new UploadError("unsupported_type");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new UploadError("too_large");
  }

  const { data } = await axios
    .post<PresignedUpload>("/api/uploads", {
      contentType: file.type,
      size: file.size,
    })
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
