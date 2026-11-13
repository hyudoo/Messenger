import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

// True for URLs produced by /api/uploads, so clients can't store arbitrary image URLs.
export const isUploadedFileUrl = (url: unknown): url is string =>
  typeof url === "string" && url.startsWith(`${publicBaseUrl()}/uploads/`);

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
