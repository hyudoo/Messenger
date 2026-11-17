import { create } from "zustand";

import { FullMessageType } from "@/app/types";

// What the composer is doing besides writing a new message: replying to a message (shown as a
// bar above the input, sent as replyToId) or editing one of the user's own (the input holds its
// text, sending PATCHes it). Set from MessageBox's actions, read by Form; one at a time.
interface ComposerStore {
  conversationId: string | null;
  replyTo: FullMessageType | null;
  editing: FullMessageType | null;
  startReply: (message: FullMessageType) => void;
  startEdit: (message: FullMessageType) => void;
  cancel: () => void;
}

const useComposer = create<ComposerStore>((set) => ({
  conversationId: null,
  replyTo: null,
  editing: null,
  startReply: (message) =>
    set({ conversationId: message.conversationId, replyTo: message, editing: null }),
  startEdit: (message) =>
    set({ conversationId: message.conversationId, editing: message, replyTo: null }),
  cancel: () => set({ conversationId: null, replyTo: null, editing: null }),
}));

export default useComposer;
