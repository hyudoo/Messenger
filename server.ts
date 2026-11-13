// Custom server: Next.js and socket.io share one HTTP server and one process,
// so route handlers can emit through the io instance (see app/libs/socket-server.ts).
import { createServer } from "http";
import { parse } from "url";
import next from "next";

import { initSocketServer } from "./server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
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
