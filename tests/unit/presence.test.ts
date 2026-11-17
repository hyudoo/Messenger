import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEARTBEAT_MS, INSTANCE_TIMEOUT_MS, createPresence } from "@/server/presence";

// A stand-in for the socket.io server: records what goes to this instance's clients and to the
// other instances, and lets a test deliver events from other instances.
const fakeServer = () => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const io = {
    local: { emit: vi.fn() },
    serverSideEmit: vi.fn(),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    },
  };
  const toClients = () => io.local.emit.mock.calls.map(([event, email]) => `${event} ${email}`);
  const fromInstance = (event: string, ...args: unknown[]) => handlers[event]?.(...args);
  return { io: io as any, raw: io, toClients, fromInstance };
};

const A = "a@x.com";
const B = "b@x.com";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence on one instance", () => {
  it("announces a user's first tab and last tab only", () => {
    const { io, raw, toClients } = fakeServer();
    const presence = createPresence(io, { clustered: false });

    presence.add(A);
    presence.add(A);
    expect(presence.list()).toEqual([A]);
    presence.remove(A);
    expect(presence.list()).toEqual([A]);
    presence.remove(A);
    presence.remove(A); // a stray disconnect changes nothing

    expect(toClients()).toEqual([`presence:online ${A}`, `presence:offline ${A}`]);
    expect(presence.list()).toEqual([]);
    // nobody else to tell
    expect(raw.serverSideEmit).not.toHaveBeenCalled();
  });
});

describe("presence across instances", () => {
  it("tells the other instances about changes, and asks for their lists on start", () => {
    const { io, raw } = fakeServer();
    const presence = createPresence(io, { clustered: true });
    expect(raw.serverSideEmit).toHaveBeenCalledWith("presence:hello", expect.any(String));

    presence.add(A);
    presence.add(A); // a second tab: no news
    presence.remove(A);
    presence.remove(A);
    const changes = raw.serverSideEmit.mock.calls.filter(([event]) => event === "presence:change");
    expect(changes.map(([, , email, online]) => [email, online])).toEqual([
      [A, true],
      [A, false],
    ]);
    presence.stop();
  });

  it("keeps a user online while any instance has them", () => {
    const { io, toClients, fromInstance } = fakeServer();
    const presence = createPresence(io, { clustered: true });

    fromInstance("presence:change", "two", A, true);
    presence.add(A); // and a tab here too
    expect(toClients()).toEqual([`presence:online ${A}`]);

    fromInstance("presence:change", "two", A, false);
    expect(presence.list()).toEqual([A]);
    presence.remove(A);
    expect(toClients()).toEqual([`presence:online ${A}`, `presence:offline ${A}`]);
    presence.stop();
  });

  it("ends offline even when two instances lose the user's last tabs at the same time", () => {
    // each instance removes its own tab before hearing about the other's
    const one = fakeServer();
    const two = fakeServer();
    const p1 = createPresence(one.io, { clustered: true });
    const p2 = createPresence(two.io, { clustered: true });
    p1.add(A);
    p2.add(A);
    two.fromInstance("presence:change", "one", A, true);
    one.fromInstance("presence:change", "two", A, true);

    p1.remove(A);
    p2.remove(A);
    one.fromInstance("presence:change", "two", A, false);
    two.fromInstance("presence:change", "one", A, false);

    expect(one.toClients().at(-1)).toBe(`presence:offline ${A}`);
    expect(two.toClients().at(-1)).toBe(`presence:offline ${A}`);
    p1.stop();
    p2.stop();
  });

  it("takes another instance's heartbeat as its whole list", () => {
    const { io, toClients, fromInstance } = fakeServer();
    const presence = createPresence(io, { clustered: true });

    fromInstance("presence:heartbeat", "two", [A, B]);
    fromInstance("presence:heartbeat", "two", [B, 42]); // A left (its change was missed)

    expect(presence.list()).toEqual([B]);
    expect(toClients()).toEqual([
      `presence:online ${A}`,
      `presence:online ${B}`,
      `presence:offline ${A}`,
    ]);
    presence.stop();
  });

  it("answers a new instance's hello with its list, and sends it every heartbeat", () => {
    const { io, raw, fromInstance } = fakeServer();
    const presence = createPresence(io, { clustered: true });
    presence.add(A);
    raw.serverSideEmit.mockClear();

    fromInstance("presence:hello", "new");
    expect(raw.serverSideEmit).toHaveBeenCalledWith("presence:heartbeat", expect.any(String), [A]);

    raw.serverSideEmit.mockClear();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(raw.serverSideEmit).toHaveBeenCalledWith("presence:heartbeat", expect.any(String), [A]);
    presence.stop();
  });

  it("drops an instance that went quiet (crashed), or that said it is going", () => {
    const { io, toClients, fromInstance } = fakeServer();
    const presence = createPresence(io, { clustered: true });

    fromInstance("presence:change", "crashed", A, true);
    fromInstance("presence:change", "leaving", B, true);
    fromInstance("presence:gone", "leaving");
    expect(presence.list()).toEqual([A]);

    vi.advanceTimersByTime(INSTANCE_TIMEOUT_MS + HEARTBEAT_MS);
    expect(presence.list()).toEqual([]);
    expect(toClients()).toContain(`presence:offline ${A}`);
    presence.stop();
  });

  it("ignores its own echoes and malformed events", () => {
    const { io, raw, toClients, fromInstance } = fakeServer();
    const presence = createPresence(io, { clustered: true });
    const self = raw.serverSideEmit.mock.calls[0][1];

    fromInstance("presence:change", self, A, true);
    fromInstance("presence:change", "two", 42, true);
    fromInstance("presence:heartbeat", "two", "not a list");
    expect(toClients()).toEqual([]);
    presence.stop();
  });
});
