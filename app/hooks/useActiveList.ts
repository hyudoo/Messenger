import { create } from "zustand";

interface ActiveListStore {
  members: string[];
  // email -> when this tab saw them go offline (ms); fresher than the page's User.lastSeenAt
  lastSeen: Record<string, number>;
  add: (id: string) => void;
  remove: (id: string) => void;
  set: (ids: string[]) => void;
}

// Online users, by email (fed by useActiveChannel)
const useActiveList = create<ActiveListStore>((set) => ({
  members: [],
  lastSeen: {},
  add: (id) =>
    set((state) =>
      state.members.includes(id) ? state : { members: [...state.members, id] }
    ),
  remove: (id) =>
    set((state) => ({
      members: state.members.filter((memberId) => memberId !== id),
      lastSeen: { ...state.lastSeen, [id]: Date.now() },
    })),
  set: (ids) => set({ members: ids }),
}));

// Re-renders only when this user's online state flips, not on every presence event.
export const useIsActive = (email?: string | null) =>
  useActiveList((state) => !!email && state.members.includes(email));

// When the user was last online, as far as this tab knows (ms), or null.
export const useLastSeen = (user?: { email?: string | null; lastSeenAt?: Date | string | null }) => {
  const live = useActiveList((state) => (user?.email ? state.lastSeen[user.email] : undefined));
  const stored = user?.lastSeenAt ? new Date(user.lastSeenAt).getTime() : undefined;
  return Math.max(live ?? 0, stored ?? 0) || null;
};

export default useActiveList;
