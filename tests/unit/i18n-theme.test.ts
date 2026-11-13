import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import vi from "@/i18n/messages/vi.json";
import { THEME_INIT_SCRIPT } from "@/app/components/providers/ThemeProvider";

// "a.b.c" -> message, for every leaf
const flatten = (obj: Record<string, unknown>, prefix = ""): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null
      ? { ...acc, ...flatten(value as Record<string, unknown>, path) }
      : { ...acc, [path]: String(value) };
  }, {});

// top-level ICU arguments: {count}, {names}, {count, plural, ...} -> count, names
const argumentsOf = (message: string) => {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === "{") {
      if (depth === 0) names.add(/^\{\s*(\w+)/.exec(message.slice(i))![1]);
      depth++;
    } else if (message[i] === "}") {
      depth--;
    }
  }
  return Array.from(names).sort();
};

describe("message files", () => {
  const viMessages = flatten(vi);
  const enMessages = flatten(en);

  it("have the same keys in vi and en", () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(viMessages).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(viMessages)) {
      expect(argumentsOf(enMessages[key]), key).toEqual(argumentsOf(viMessages[key]));
    }
  });

  it("have no empty messages", () => {
    for (const [key, value] of Object.entries({ ...viMessages, ...enMessages })) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});

describe("theme init script", () => {
  // runs the inline <head> script against a fake browser
  const run = (stored: string | null, systemDark: boolean, storageThrows = false) => {
    const classes = new Set<string>();
    const env = {
      localStorage: {
        getItem: () => {
          if (storageThrows) throw new Error("blocked");
          return stored;
        },
      },
      matchMedia: () => ({ matches: systemDark }),
      document: {
        documentElement: {
          classList: {
            toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
          },
        },
      },
    };
    new Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(
      env.localStorage,
      env.matchMedia,
      env.document
    );
    return classes.has("dark");
  };

  it.each([
    ["stored dark", "dark", false, true],
    ["stored light on a dark OS", "light", true, false],
    ["stored system, dark OS", "system", true, true],
    ["stored system, light OS", "system", false, false],
    ["nothing stored (default system), dark OS", null, true, true],
    ["nothing stored (default system), light OS", null, false, false],
  ])("%s", (_, stored, systemDark, dark) => {
    expect(run(stored, systemDark)).toBe(dark);
  });

  it("does not throw when storage is blocked", () => {
    expect(() => run(null, true, true)).not.toThrow();
  });
});
