import { afterEach, expect, it, vi } from "vitest";
import { consoleLogger } from "./log.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("writes one JSON line per event, with the context on each", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  consoleLogger({ run: "r1" }).warn("provider_partial_failure", { provider: "verdi" });
  expect(warn).toHaveBeenCalledOnce();
  expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
    level: "warn",
    event: "provider_partial_failure",
    run: "r1",
    provider: "verdi",
  });
});

it("sends each level to its console method", () => {
  const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const log = consoleLogger();
  log.info("a");
  log.error("b");
  expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({ level: "info", event: "a" });
  expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({ level: "error", event: "b" });
});
