import { randomUUID } from "crypto";
import type { Server } from "socket.io";

import { logError } from "../app/libs/log";

// Who is online, without asking the whole cluster on every connection (io.fetchSockets() made a
// mass reconnect after a deploy O(N²)).
//
// Each instance counts its own sockets per user (exact: it sees every connect / disconnect) and
// keeps a view of every instance's users:
// - a user's first socket on an instance / its last one leaving is sent to the other instances
//   (serverSideEmit through the Redis adapter, in order per instance);
// - every HEARTBEAT_MS each instance also sends its full list, which repairs anything missed and
//   lets a new instance learn the others (it asks for one at once on start);
// - an instance not heard from for INSTANCE_TIMEOUT_MS (crashed) is dropped from the view.
// A user is online while any instance has them. Each instance tells its own clients (io.local)
// when that changes in its view, so two instances losing a user's last tabs at the same time
// still both end up announcing "offline". Without Redis there are no other instances and the
// counts are exact.

type AnyServer = Server<any, any, any, any>;

export const HEARTBEAT_MS = 10_000;
export const INSTANCE_TIMEOUT_MS = 35_000;

const isEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 320;

export const createPresence = (io: AnyServer, { clustered }: { clustered: boolean }) => {
  const self = randomUUID();
  // this instance's sockets per user
  const local = new Map<string, number>();
  // the other instances' users
  const others = new Map<string, { emails: Set<string>; seenAt: number }>();
  // user -> how many instances (this one included) have them
  const refs = new Map<string, number>();

  const publish = (event: string, ...args: unknown[]) => {
    if (!clustered) {
      return;
    }
    try {
      io.serverSideEmit(event, ...args);
    } catch (error) {
      logError("presence_publish", error);
    }
  };

  const up = (email: string) => {
    const count = (refs.get(email) ?? 0) + 1;
    refs.set(email, count);
    if (count === 1) {
      io.local.emit("presence:online", email);
    }
  };

  const down = (email: string) => {
    const count = (refs.get(email) ?? 0) - 1;
    if (count > 0) {
      refs.set(email, count);
      return;
    }
    refs.delete(email);
    io.local.emit("presence:offline", email);
  };

  const instance = (id: string) => {
    let entry = others.get(id);
    if (!entry) {
      entry = { emails: new Set(), seenAt: Date.now() };
      others.set(id, entry);
    }
    entry.seenAt = Date.now();
    return entry;
  };

  const drop = (id: string) => {
    const entry = others.get(id);
    if (entry) {
      others.delete(id);
      entry.emails.forEach(down);
    }
  };

  const heartbeat = () => publish("presence:heartbeat", self, Array.from(local.keys()));

  if (clustered) {
    io.on("presence:change", (id: unknown, email: unknown, online: unknown) => {
      if (typeof id !== "string" || id === self || !isEmail(email)) {
        return;
      }
      const entry = instance(id);
      if (online === true && !entry.emails.has(email)) {
        entry.emails.add(email);
        up(email);
      } else if (online === false && entry.emails.delete(email)) {
        down(email);
      }
    });

    // the instance's whole list: replaces what we had for it
    io.on("presence:heartbeat", (id: unknown, emails: unknown) => {
      if (typeof id !== "string" || id === self || !Array.isArray(emails)) {
        return;
      }
      const entry = instance(id);
      const next = new Set(emails.filter(isEmail));
      next.forEach((email) => {
        if (!entry.emails.has(email)) {
          up(email);
        }
      });
      entry.emails.forEach((email) => {
        if (!next.has(email)) {
          down(email);
        }
      });
      entry.emails = next;
    });

    // a new instance wants everyone's list now rather than within a heartbeat
    io.on("presence:hello", (id: unknown) => {
      if (id !== self) {
        heartbeat();
      }
    });

    io.on("presence:gone", (id: unknown) => {
      if (typeof id === "string" && id !== self) {
        drop(id);
      }
    });
  }

  const timer = clustered
    ? setInterval(() => {
        heartbeat();
        const cutoff = Date.now() - INSTANCE_TIMEOUT_MS;
        others.forEach((entry, id) => {
          if (entry.seenAt < cutoff) {
            drop(id);
          }
        });
      }, HEARTBEAT_MS)
    : null;
  timer?.unref();
  publish("presence:hello", self);

  return {
    // a socket of this user connected to this instance
    add(email: string) {
      const count = (local.get(email) ?? 0) + 1;
      local.set(email, count);
      if (count === 1) {
        up(email);
        publish("presence:change", self, email, true);
      }
    },

    // ... and disconnected
    remove(email: string) {
      const count = (local.get(email) ?? 0) - 1;
      if (count > 0) {
        local.set(email, count);
        return;
      }
      if (!local.delete(email)) {
        return;
      }
      down(email);
      publish("presence:change", self, email, false);
    },

    // everyone online, for presence:list
    list: () => Array.from(refs.keys()),

    // shutdown: the others forget this instance at once
    stop() {
      if (timer) {
        clearInterval(timer);
      }
      publish("presence:gone", self);
    },
  };
};

export type Presence = ReturnType<typeof createPresence>;
