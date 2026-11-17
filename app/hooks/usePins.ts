import { create } from "zustand";

interface PinStore {
  // the open chat's pinned message ids (PinnedBar keeps it in sync)
  ids: string[];
  set: (ids: string[]) => void;
}

// Which messages of the open chat are pinned, so their menus offer "Unpin".
const usePins = create<PinStore>((set) => ({
  ids: [],
  set: (ids) => set({ ids }),
}));

export default usePins;
