import type { Logger } from "./log.ts";

/** A response with an error status. */
export class HttpError extends Error {
  override readonly name = "HttpError";
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
    this.url = url;
  }
}

/** No response at all. */
export class FetchError extends Error {
  override readonly name = "FetchError";
  readonly kind: "timeout" | "network";
  readonly url: string;

  constructor(kind: "timeout" | "network", url: string, options?: ErrorOptions) {
    super(`${kind === "timeout" ? "timed out" : "network error"} fetching ${url}`, options);
    this.kind = kind;
    this.url = url;
  }
}

/**
 * `error`'s message. With `hideUrl`, an `HttpError` or `FetchError` says what happened without the
 * URL it names: some sources' URLs are secrets.
 */
export function errorMessage(error: unknown, hideUrl = false): string {
  if (hideUrl && error instanceof HttpError) return `HTTP ${error.status}`;
  if (hideUrl && error instanceof FetchError) {
    return error.kind === "timeout" ? "timed out" : "network error";
  }
  return error instanceof Error ? error.message : String(error);
}

/** A provider's entry page answered but too many of the requests behind it did not. */
export class PartialFetchError extends Error {
  override readonly name = "PartialFetchError";
}

/** Past this share of a fetch lost, the provider's last good snapshot is the better answer. */
export const MAX_FAILED_SHARE = 0.25;

/**
 * Logs the part of a fetch a provider had to leave out: `failed` of `total` `kind` (a plural,
 * "pages"). Throws `PartialFetchError` past `MAX_FAILED_SHARE`.
 */
export function reportPartialFailure(
  log: Logger,
  provider: string,
  kind: string,
  { failed, total }: { failed: number; total: number },
): void {
  if (failed === 0) return;
  log.warn("provider_partial_failure", {
    provider,
    kind,
    failed_count: failed,
    total_count: total,
  });
  if (failed > total * MAX_FAILED_SHARE) {
    throw new PartialFetchError(`${provider} lost ${failed} of ${total} ${kind}`);
  }
}

/**
 * Worth one retry: no response, or a status an overloaded or blocking host answers with (bot
 * filters answer 403). Parse errors fail the same way twice.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof FetchError || error instanceof PartialFetchError) return true;
  if (error instanceof HttpError) {
    return error.status === 403 || error.status === 429 || error.status >= 500;
  }
  return false;
}

/** A provider whose source needs config the run doesn't have. */
export class NotConfiguredError extends Error {
  override readonly name = "NotConfiguredError";
}
