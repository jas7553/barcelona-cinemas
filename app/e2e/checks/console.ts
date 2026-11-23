import type { Page } from "@playwright/test";

export interface ConsoleWatch {
  /** Throws if the console logged an error or a script threw. */
  check(): void;
}

/** Records console errors and uncaught exceptions from now on. Warnings pass. */
export function watchConsole(page: Page): ConsoleWatch {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const { url, lineNumber } = message.location();
    errors.push(`${message.text()} (${url}:${lineNumber})`);
  });
  page.on("pageerror", (error) => {
    errors.push(`uncaught: ${error.message}`);
  });
  return {
    check() {
      if (errors.length > 0) throw new Error(`console errors:\n  ${errors.join("\n  ")}`);
    },
  };
}
