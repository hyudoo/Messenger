// Custom server: Next.js and socket.io share one HTTP server and one process,
// so route handlers can emit through the io instance (see app/libs/socket-server.ts).
import { createServer } from "http";
import { parse } from "url";
import next from "next";

import prisma from "./app/libs/prismadb";
import { closeSocketServer, initSocketServer } from "./server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Set TRUST_PROXY=true only behind a proxy that overwrites X-Real-IP (e.g. nginx
// `proxy_set_header X-Real-IP $remote_addr;`); otherwise clients could fake it.
const trustProxy = process.env.TRUST_PROXY === "true";

// `docker stop` sends SIGTERM and kills the container 10 s later; finish before that
const SHUTDOWN_TIMEOUT_MS = 8000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    const httpServer = createServer((req, res) => {
      // x-client-ip is what rate limiting keys on (app/libs/rate-limit.ts); any
      // value the client sent is overwritten here.
      const proxiedIp = trustProxy ? req.headers["x-real-ip"] : undefined;
      req.headers["x-client-ip"] =
        (typeof proxiedIp === "string" && proxiedIp) ||
        req.socket.remoteAddress ||
        "unknown";

      handle(req, res, parse(req.url!, true));
    });

    // connects to Redis first when REDIS_URL or REDIS_HOST is set
    const io = await initSocketServer(httpServer);

    httpServer.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });

    // Graceful shutdown (deploys, Ctrl+C, tsx watch restarts): stop taking connections, disconnect
    // the sockets so their handlers run (peer-left, call log, offline) and clients reconnect to the
    // next instance, let running requests finish, then close Redis and the database.
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      console.log(`> ${signal}: shutting down`);
      setTimeout(() => {
        console.log("> shutdown timed out, exiting");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();

      // io.close() also closes httpServer (no new requests; open ones finish)
      closeSocketServer(io)
        .then(() => globalThis.rateLimitRedis?.close().catch(() => {}))
        .then(() => prisma.$disconnect())
        .then(() => process.exit(0))
        .catch((error) => {
          console.error(error);
          process.exit(1);
        });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
