import { describe, expect, it, vi } from "vitest";
import {
  FetchError,
  HttpError,
  isRetryable,
  MAX_FAILED_SHARE,
  PartialFetchError,
  reportPartialFailure,
} from "./errors.ts";
import type { Logger } from "./log.ts";

const URL = "https://barcelona.cines-verdi.com/cartellera";

describe("isRetryable", () => {
  it.each([
    [new FetchError("network", URL), true],
    [new FetchError("timeout", URL), true],
    [new HttpError(403, URL), true],
    [new HttpError(429, URL), true],
    [new HttpError(500, URL), true],
    [new HttpError(503, URL), true],
    [new HttpError(404, URL), false],
    [new HttpError(400, URL), false],
    [new SyntaxError("bad json"), false],
    [new Error("bad markup"), false],
    [new PartialFetchError("too many pages failed"), true],
    ["a string", false],
  ])("%s → %s", (error, retryable) => {
    expect(isRetryable(error)).toBe(retryable);
  });
});

function fakeLogger() {
  return {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  } satisfies Logger;
}

describe("reportPartialFailure", () => {
  it("says nothing when nothing failed", () => {
    const log = fakeLogger();
    reportPartialFailure(log, "verdi", "film pages", { failed: 0, total: 10 });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs a loss up to a quarter and carries on", () => {
    const log = fakeLogger();
    reportPartialFailure(log, "verdi", "film pages", { failed: 1, total: 4 });
    expect(log.warn).toHaveBeenCalledWith("provider_partial_failure", {
      provider: "verdi",
      kind: "film pages",
      failed_count: 1,
      total_count: 4,
    });
  });

  it("fails the provider past a quarter", () => {
    expect(MAX_FAILED_SHARE).toBe(0.25);
    const log = fakeLogger();
    expect(() => {
      reportPartialFailure(log, "sensacine", "pages", { failed: 2, total: 7 });
    }).toThrow(new PartialFetchError("sensacine lost 2 of 7 pages"));
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
