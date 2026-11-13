// Custom server: Next.js and socket.io share one HTTP server and one process,
// so route handlers can emit through the io instance (see app/libs/socket-server.ts).
import { createServer } from "http";
import { parse } from "url";
import next from "next";

import { initSocketServer } from "./server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Set TRUST_PROXY=true only behind a proxy that overwrites X-Real-IP (e.g. nginx
// `proxy_set_header X-Real-IP $remote_addr;`); otherwise clients could fake it.
const trustProxy = process.env.TRUST_PROXY === "true";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
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

    initSocketServer(httpServer);

    httpServer.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
