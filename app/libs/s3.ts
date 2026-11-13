import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION!;
const bucket = process.env.AWS_S3_BUCKET!;

// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY via the SDK's default chain.
const s3 = new S3Client({ region });

const publicBaseUrl = () =>
  (
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL ||
    `https://${bucket}.s3.${region}.amazonaws.com`
  ).replace(/\/$/, "");

export const publicUrlFor = (key: string) => `${publicBaseUrl()}/${key}`;

// Exactly the keys /api/uploads creates: uploads/<userId>/<uuid>.<ext>
const UPLOAD_KEY =
  /^uploads\/([a-f\d]{24})\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.(jpg|png|gif|webp)$/;

const uploadKeyOf = (url: unknown) => {
  const prefix = `${publicBaseUrl()}/`;
  if (typeof url !== "string" || !url.startsWith(prefix)) {
    return null;
  }
  const key = url.slice(prefix.length);
  const match = UPLOAD_KEY.exec(key);
  return match ? { key, ownerId: match[1] } : null;
};

// True for URLs produced by /api/uploads for `ownerId`, so clients can store neither
// arbitrary image URLs nor someone else's upload (which a later cleanup would delete).
export const isUploadedFileUrl = (url: unknown, ownerId: string): url is string =>
  uploadKeyOf(url)?.ownerId === ownerId;

// Deletes the S3 objects behind these URLs; anything not from /api/uploads is ignored.
export const deleteUploadedObjects = async (urls: string[]) => {
  const keys = Array.from(
    new Set(urls.map((url) => uploadKeyOf(url)?.key).filter((key): key is string => !!key))
  );
  // DeleteObjects takes at most 1000 keys per request
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
};

// Presigned PUT URL; content type and length are signed, so the browser must
// upload exactly the file it announced.
export const createPresignedUpload = (
  key: string,
  contentType: string,
  contentLength: number
) =>
  getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    // content-type is not signed by default
    { expiresIn: 60, signableHeaders: new Set(["content-type"]) }
  );
