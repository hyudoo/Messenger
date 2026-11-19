"use client";

import { useId, useSyncExternalStore } from "react";
import { HiChevronDown } from "react-icons/hi2";

// localStorage key per section: "contacts.collapsed.<storageKey>" = "1" while folded
const STORAGE_PREFIX = "contacts.collapsed.";

const listeners = new Set<() => void>();
// used instead of localStorage when it is blocked (private mode, disabled site data)
const memoryCollapsed = new Map<string, boolean>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // other tabs
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(key: string) {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored === null ? memoryCollapsed.get(key) ?? false : stored === "1";
  } catch {
    return memoryCollapsed.get(key) ?? false;
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  memoryCollapsed.set(key, collapsed);
  try {
    if (collapsed) {
      localStorage.setItem(STORAGE_PREFIX + key, "1");
    } else {
      localStorage.removeItem(STORAGE_PREFIX + key);
    }
  } catch {
    // storage blocked: the choice still applies until the page reloads
  }
  listeners.forEach((listener) => listener());
}

interface CollapsibleSectionProps {
  // remembers whether it is folded under this name (localStorage)
  storageKey: string;
  title: React.ReactNode;
  // keep it open whatever the user chose (e.g. while the search box filters it)
  forceOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

// A contacts page section (requests, sent, friends) whose heading folds it away. Open until the
// user folds it; the choice is remembered per section across reloads and tabs.
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  storageKey,
  title,
  forceOpen = false,
  className,
  children,
}) => {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => readCollapsed(storageKey),
    () => false
  );
  const id = useId();
  const expanded = !collapsed || forceOpen;

  return (
    <section className={className}>
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          disabled={forceOpen}
          onClick={() => writeCollapsed(storageKey, !collapsed)}
          className="flex w-full items-center gap-1 rounded-md px-3 pb-1 pt-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground disabled:hover:text-muted-foreground">
          <span className="flex-1 truncate">{title}</span>
          <HiChevronDown
            aria-hidden
            className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </button>
      </h3>
      <div id={id} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
};

export default CollapsibleSection;
