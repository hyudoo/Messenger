import { create } from "zustand";

interface DraftStore {
  // conversation id -> the text typed but not sent
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
}

// Unsent text per conversation, so switching chats doesn't lose it (Form reads it when it mounts
// and keeps it up to date). Kept for the tab's lifetime only: a reload starts empty, which also
// keeps the server-rendered composer and the client's first render the same.
const useDrafts = create<DraftStore>((set) => ({
  drafts: {},
  setDraft: (conversationId, text) =>
    set((state) => {
      if ((state.drafts[conversationId] ?? "") === text) {
        return state;
      }
      const drafts = { ...state.drafts };
      if (text) {
        drafts[conversationId] = text;
      } else {
        delete drafts[conversationId];
      }
      return { drafts };
    }),
}));

export default useDrafts;
