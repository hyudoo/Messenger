// Server-side error logging. In production each entry is one JSON line on stderr (time, level,
// tag, message, stack, plus context), which `docker logs` / a log shipper can parse and filter by
// tag; in development it stays human-readable. Context must never carry secrets or message text.
type Context = Record<string, unknown>;

const describe = (error: unknown) =>
  error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: String(error) };

const write = (level: "error" | "warn", tag: string, error: unknown, context?: Context) => {
  if (process.env.NODE_ENV === "production") {
    console[level](
      JSON.stringify({ time: new Date().toISOString(), level, tag, ...describe(error), ...context })
    );
  } else {
    console[level](`[${tag}]`, error, ...(context ? [context] : []));
  }
};

// `tag` names where it happened, e.g. "messages.send" or "socket.call_cancel".
export const logError = (tag: string, error: unknown, context?: Context) =>
  write("error", tag, error, context);

export const logWarn = (tag: string, error: unknown, context?: Context) =>
  write("warn", tag, error, context);
