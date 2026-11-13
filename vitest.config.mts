import path from "path";
import { defineConfig } from "vitest/config";

// Stay on Vitest 3: Vitest 5 fails every test file ("Cannot read properties of
// undefined (reading 'config')") when the shell reports the drive in lower case
// (e:\ instead of E:\), as VS Code does here.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // read at import time by app/libs/s3.ts and the auth code
    env: {
      AWS_REGION: "ap-southeast-1",
      AWS_S3_BUCKET: "test-bucket",
      AWS_ACCESS_KEY_ID: "AKIATESTONLY",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      NEXT_PUBLIC_S3_PUBLIC_URL: "",
      NEXTAUTH_SECRET: "test-nextauth-secret",
      REDIS_URL: "",
    },
    // socket tests open real servers and connections
    testTimeout: 15_000,
    // next-intl's ESM imports "next/server" without an extension, which Node can't
    // resolve (next has no exports map); let Vite transform and resolve it instead
    server: { deps: { inline: ["next-intl"] } },
  },
});
