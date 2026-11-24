import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fetcher, FetchResponse } from "./http.ts";
import {
  recordingFetcher,
  replayFetcher,
  stripCredentials,
  UnrecordedRequestError,
} from "./recordings.ts";

const options = { timeoutMs: 1000 };
const tempDir = (): string => mkdtempSync(join(tmpdir(), "recordings-"));

function writeRecording(entries: unknown[], files: Record<string, string>): string {
  const dir = tempDir();
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(entries));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const entry = (url: string, file: string, extra: Record<string, unknown> = {}) => ({
  method: "GET",
  url,
  status: 200,
  contentType: "text/html",
  file,
  ...extra,
});

describe("stripCredentials", () => {
  it("drops api_key and keeps everything else", () => {
    expect(
      stripCredentials("https://api.themoviedb.org/3/search/movie?api_key=s3cret&query=Alien"),
    ).toBe("https://api.themoviedb.org/3/search/movie?query=Alien");
  });

  it("drops every credential param, whatever its case", () => {
    expect(
      stripCredentials(
        "https://a.test/p?apikey=1&TOKEN=2&access_token=3&key=4&Api_Key=5&page=2&keyword=x",
      ),
    ).toBe("https://a.test/p?page=2&keyword=x");
  });

  it("leaves a URL without credentials byte for byte", () => {
    const url = "https://www.sensacine.com/_/showtimes/theater-E0608/d-2026-11-24/?q=a%20b";
    expect(stripCredentials(url)).toBe(url);
  });
});

describe("replayFetcher", () => {
  it("serves a recorded response", async () => {
    const dir = writeRecording([entry("https://a.test/page", "page.html")], {
      "page.html": "<p>hi</p>",
    });
    await expect(replayFetcher(dir).get("https://a.test/page", options)).resolves.toEqual({
      url: "https://a.test/page",
      status: 200,
      contentType: "text/html",
      text: "<p>hi</p>",
    });
  });

  it("throws on an unrecorded URL, without its credentials in the message", async () => {
    const dir = writeRecording([entry("https://a.test/page", "page.html")], { "page.html": "" });
    const error = await replayFetcher(dir)
      .get("https://a.test/other?api_key=s3cret", options)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnrecordedRequestError);
    expect(String(error)).toContain("https://a.test/other");
    expect(String(error)).not.toContain("s3cret");
  });

  it("matches whatever the key, param order or encoding", async () => {
    const dir = writeRecording(
      [entry("https://api.test/search?language=en-US&query=The+Thing", "s.json")],
      { "s.json": "{}" },
    );
    const replay = replayFetcher(dir);
    for (const url of [
      "https://api.test/search?api_key=any&language=en-US&query=The%20Thing",
      "https://api.test/search?query=The+Thing&language=en-US",
    ]) {
      await expect(replay.get(url, options)).resolves.toMatchObject({ text: "{}" });
    }
  });

  it("plays a URL recorded twice in order, then keeps the last", async () => {
    const dir = writeRecording(
      [entry("https://a.test/", "1.html", { status: 503 }), entry("https://a.test/", "2.html")],
      { "1.html": "busy", "2.html": "ok" },
    );
    const replay = replayFetcher(dir);
    const texts: string[] = [];
    for (let i = 0; i < 3; i++) texts.push((await replay.get("https://a.test/", options)).text);
    expect(texts).toEqual(["busy", "ok", "ok"]);
  });

  it("answers at the redirect's end when one was recorded", async () => {
    const dir = writeRecording(
      [entry("https://a.test/old", "p.html", { finalUrl: "https://a.test/new/" })],
      { "p.html": "" },
    );
    await expect(replayFetcher(dir).get("https://a.test/old", options)).resolves.toMatchObject({
      url: "https://a.test/new/",
    });
  });

  it("reads a missing content type as empty", async () => {
    const dir = writeRecording([entry("https://a.test/", "p", { contentType: null })], { p: "" });
    await expect(replayFetcher(dir).get("https://a.test/", options)).resolves.toMatchObject({
      contentType: "",
    });
  });

  it.each([
    ["an unknown field", [entry("https://a.test/", "p", { note: "x" })]],
    ["a POST", [entry("https://a.test/", "p", { method: "POST" })]],
    ["a non-URL", [entry("a.test", "p")]],
    ["not an array", { entries: [] }],
  ])("rejects a manifest with %s", (_, manifest) => {
    const dir = writeRecording(Array.isArray(manifest) ? manifest : [], { p: "" });
    if (!Array.isArray(manifest))
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    expect(() => replayFetcher(dir)).toThrow();
  });

  it("rejects a body file outside the recording, or missing", () => {
    expect(() => replayFetcher(writeRecording([entry("https://a.test/", "../p")], {}))).toThrow(
      /outside/,
    );
    expect(() => replayFetcher(writeRecording([entry("https://a.test/", "gone")], {}))).toThrow(
      /ENOENT/,
    );
  });
});

describe("recordingFetcher", () => {
  const pages: Record<string, FetchResponse> = {
    "https://api.test/movie/1?api_key=s3cret&language=en-US": {
      url: "https://api.test/movie/1?api_key=s3cret&language=en-US",
      status: 200,
      contentType: "application/json; charset=utf-8",
      text: '{"id":1}',
    },
    "https://a.test/old": {
      url: "https://a.test/new/",
      status: 200,
      contentType: "text/html",
      text: "<p>Maldà</p>",
    },
    "https://a.test/gone": { url: "https://a.test/gone", status: 404, contentType: "", text: "" },
  };
  const inner: Fetcher = {
    get: (url) => {
      const page = pages[url];
      return page ? Promise.resolve(page) : Promise.reject(new Error("offline"));
    },
  };

  it("writes a recording that replays the same responses", async () => {
    const recorder = recordingFetcher(inner);
    for (const url of Object.keys(pages)) await recorder.fetcher.get(url, options);
    await expect(recorder.fetcher.get("https://a.test/down", options)).rejects.toThrow();
    const dir = tempDir();
    recorder.save(dir);

    expect(readdirSync(dir).sort()).toEqual([
      "0001-api.test.json",
      "0002-a.test.html",
      "0003-a.test.txt",
      "manifest.json",
    ]);
    const replay = replayFetcher(dir);
    for (const [url, page] of Object.entries(pages)) {
      await expect(replay.get(url, options)).resolves.toEqual({
        ...page,
        url: stripCredentials(page.url),
      });
    }
  });

  it("keeps credentials out of every file", async () => {
    const recorder = recordingFetcher(inner);
    await recorder.fetcher.get("https://api.test/movie/1?api_key=s3cret&language=en-US", options);
    const dir = tempDir();
    recorder.save(dir);
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8")).not.toContain("s3cret");
    }
  });
});
