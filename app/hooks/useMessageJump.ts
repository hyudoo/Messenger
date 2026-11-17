import { create } from "zustand";

interface MessageJumpStore {
  // asks the open chat (Body) to show a message: scrolled to and flashed, loading older pages
  // first when it isn't loaded yet
  request: (messageId: string) => void;
  listeners: Set<(messageId: string) => void>;
}

// From a reply's quote or a search result to the message in the chat.
const useMessageJump = create<MessageJumpStore>((_, get) => ({
  listeners: new Set(),
  request: (messageId) => get().listeners.forEach((listener) => listener(messageId)),
}));

// Body registers its handler for as long as it is mounted.
export const onMessageJump = (listener: (messageId: string) => void) => {
  const { listeners } = useMessageJump.getState();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export default useMessageJump;
