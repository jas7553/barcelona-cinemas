export type LogFields = Readonly<Record<string, unknown>>;

/** Structured events: a snake_case event name plus fields. */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Writes each event as one JSON line, with `context` (e.g. the run id) on every line. */
export function consoleLogger(context: LogFields = {}): Logger {
  const line = (level: string, event: string, fields: LogFields): string =>
    JSON.stringify({ level, event, ...context, ...fields });
  return {
    info: (event, fields = {}) => {
      console.log(line("info", event, fields));
    },
    warn: (event, fields = {}) => {
      console.warn(line("warn", event, fields));
    },
    error: (event, fields = {}) => {
      console.error(line("error", event, fields));
    },
  };
}
