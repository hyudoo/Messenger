/** @type {import('next').NextConfig} */

// Host serving uploads: NEXT_PUBLIC_S3_PUBLIC_URL (e.g. CloudFront) or the bucket's
// own S3 host. Only this host is allowed, not every *.amazonaws.com bucket.
const s3PublicHost = process.env.NEXT_PUBLIC_S3_PUBLIC_URL
  ? new URL(process.env.NEXT_PUBLIC_S3_PUBLIC_URL).hostname
  : process.env.AWS_S3_BUCKET && process.env.AWS_REGION
  ? `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
  : null;

const nextConfig = {
  experimental: {
    appDir: true,
    swcPlugins: [["next-superjson-plugin", {}]],
  },
  images: {
    domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"],
    remotePatterns: s3PublicHost
      ? [{ protocol: "https", hostname: s3PublicHost }]
      : [],
  },
  webpack: (config) => {
    config.externals = [...config.externals, "bcrypt"];
    return config;
  },
};

module.exports = nextConfig;
