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

// Uploads an image straight from the browser to S3 with a presigned PUT URL
// and returns its public URL.
export const uploadImage = async (file: File) => {
  if (!IMAGE_TYPES[file.type]) {
    throw new Error("Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WEBP");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Ảnh tối đa 10MB");
  }

  const { data } = await axios
    .post<PresignedUpload>("/api/uploads", {
      contentType: file.type,
      size: file.size,
    })
    .catch((error) => {
      throw new Error(
        error?.response?.status === 429
          ? "Bạn tải ảnh lên quá nhiều, thử lại sau ít phút"
          : "Tải ảnh lên thất bại"
      );
    });

  const response = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: data.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error("Tải ảnh lên thất bại");
  }

  return data.fileUrl;
};
