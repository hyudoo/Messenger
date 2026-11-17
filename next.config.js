const createNextIntlPlugin = require("next-intl/plugin");

// loads i18n/request.ts (locale + messages for each request)
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */

// Host serving uploads: NEXT_PUBLIC_S3_PUBLIC_URL (e.g. CloudFront) or the bucket's
// own S3 host. Only this host is allowed, not every *.amazonaws.com bucket.
const s3PublicHost = process.env.NEXT_PUBLIC_S3_PUBLIC_URL
  ? new URL(process.env.NEXT_PUBLIC_S3_PUBLIC_URL).hostname
  : process.env.AWS_S3_BUCKET && process.env.AWS_REGION
  ? `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
  : null;

// Browsers PUT uploads straight to the bucket (presigned URLs use its own S3 host, even with CloudFront).
const s3UploadHost =
  process.env.AWS_S3_BUCKET && process.env.AWS_REGION
    ? `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
    : null;
const isProd = process.env.NODE_ENV === "production";

const imageSources = [
  "'self'",
  "data:",
  "blob:",
  ...(s3PublicHost ? [`https://${s3PublicHost}`] : []),
  "https://avatars.githubusercontent.com",
  "https://lh3.googleusercontent.com",
  // emoji-picker-react draws its emoji from the emoji-datasource images on jsDelivr
  "https://cdn.jsdelivr.net",
];

// Enforced: only directives that cannot break the app (no framing = no clickjacking, no plugins,
// no <base> hijacking).
const enforcedCsp = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");

// The full policy is report-only for now (violations show in the browser console, nothing is
// blocked): Next's inline scripts (RSC payload, THEME_INIT_SCRIPT) need nonces before script-src can
// drop 'unsafe-inline'. Once the console stays clean in use, move it to Content-Security-Policy.
const reportOnlyCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src ${imageSources.join(" ")}`,
  "font-src 'self' data:",
  // socket.io (same origin, ws in dev / wss behind TLS) and the S3 upload PUT
  `connect-src 'self' ws: wss:${s3UploadHost ? ` https://${s3UploadHost}` : ""}`,
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
  // older browsers that don't know frame-ancestors
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // calls need the camera and microphone of this origin; nothing else
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()",
  },
  // only meaningful over HTTPS (browsers ignore it on plain http, e.g. localhost)
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig = {
  serverExternalPackages: ["bcrypt"],
  // Next's own header is noise and tells attackers the framework
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      ...(s3PublicHost ? [{ protocol: "https", hostname: s3PublicHost }] : []),
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

module.exports = withNextIntl(nextConfig);
