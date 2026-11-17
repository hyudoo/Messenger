import axios from "axios";
import { create } from "zustand";

import { FullMessageType } from "@/app/types";

// Messages the user sent from this tab, shown at once instead of after the server's round trip.
// `Form` adds them, `Body` renders them after the conversation's messages:
// - sending: greyed out until POST /api/messages answers
// - sent: the server's message, shown until the same message arrives in Body's list (socket or
//   reconnect resync); Body then drops the entry
// - failed: with retry / discard
export interface OutboxPayload {
  message?: string;
  image?: string;
}

export interface OutboxItem {
  clientId: string;
  conversationId: string;
  payload: OutboxPayload;
  createdAt: string;
  status: "sending" | "sent" | "failed";
  // why it failed: 429 (too fast) or anything else
  tooFast?: boolean;
  message?: FullMessageType;
}

interface OutboxStore {
  items: OutboxItem[];
  send: (conversationId: string, payload: OutboxPayload) => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => void;
}

let nextId = 0;
const newClientId = () => `local-${Date.now()}-${nextId++}`;

const useOutbox = create<OutboxStore>((set, get) => {
  const patch = (clientId: string, changes: Partial<OutboxItem>) =>
    set((state) => ({
      items: state.items.map((item) => (item.clientId === clientId ? { ...item, ...changes } : item)),
    }));

  const post = async (item: OutboxItem) => {
    try {
      const { data } = await axios.post<FullMessageType>("/api/messages", {
        ...item.payload,
        conversationId: item.conversationId,
        clientId: item.clientId,
      });
      patch(item.clientId, { status: "sent", message: data });
    } catch (error: any) {
      patch(item.clientId, { status: "failed", tooFast: error?.response?.status === 429 });
    }
  };

  return {
    items: [],
    send: (conversationId, payload) => {
      const item: OutboxItem = {
        clientId: newClientId(),
        conversationId,
        payload,
        createdAt: new Date().toISOString(),
        status: "sending",
      };
      set((state) => ({ items: [...state.items, item] }));
      return post(item);
    },
    retry: (clientId) => {
      const item = get().items.find((entry) => entry.clientId === clientId);
      if (!item || item.status !== "failed") {
        return Promise.resolve();
      }
      patch(clientId, { status: "sending", tooFast: false });
      return post(item);
    },
    discard: (clientId) =>
      set((state) => ({ items: state.items.filter((item) => item.clientId !== clientId) })),
  };
});

export default useOutbox;
