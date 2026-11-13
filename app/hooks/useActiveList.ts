import { create } from "zustand";

interface ActiveListStore {
  members: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  set: (ids: string[]) => void;
}

// Online users, by email (fed by useActiveChannel)
const useActiveList = create<ActiveListStore>((set) => ({
  members: [],
  add: (id) =>
    set((state) =>
      state.members.includes(id) ? state : { members: [...state.members, id] }
    ),
  remove: (id) =>
    set((state) => ({
      members: state.members.filter((memberId) => memberId !== id),
    })),
  set: (ids) => set({ members: ids }),
}));

// Re-renders only when this user's online state flips, not on every presence event.
export const useIsActive = (email?: string | null) =>
  useActiveList((state) => !!email && state.members.includes(email));

export default useActiveList;
