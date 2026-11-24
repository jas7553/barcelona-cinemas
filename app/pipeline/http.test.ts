import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchError, HttpError } from "./errors.ts";
import { DEFAULT_HEADERS, getOk, liveFetcher, type Fetcher } from "./http.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/echo-headers":
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.headers));
        return;
      case "/latin1":
        res.setHeader("content-type", "text/html; charset=ISO-8859-1");
        res.end(Buffer.from("Maldà", "latin1"));
        return;
      case "/utf8-no-charset":
        res.setHeader("content-type", "text/html");
        res.end("Glòries");
        return;
      case "/redirect":
        res.writeHead(302, { location: "/films/" });
        res.end();
        return;
      case "/films/":
        res.end("films");
        return;
      case "/missing":
        res.writeHead(404);
        res.end("not here");
        return;
      case "/hang":
        return;
      default:
        res.writeHead(500);
        res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const fetcher = liveFetcher();
const options = { timeoutMs: 2000 };

describe("liveFetcher", () => {
  it("sends the default headers, overridable per request", async () => {
    const sent = JSON.parse(
      (await fetcher.get(`${base}/echo-headers`, { ...options, headers: { Accept: "text/html" } }))
        .text,
    ) as Record<string, string>;
    expect(sent["user-agent"]).toBe(DEFAULT_HEADERS["User-Agent"]);
    expect(sent["accept"]).toBe("text/html");

    const overridden = JSON.parse(
      (await fetcher.get(`${base}/echo-headers`, { ...options, headers: { "User-Agent": "x" } }))
        .text,
    ) as Record<string, string>;
    expect(overridden["user-agent"]).toBe("x");
  });

  it("decodes the body in the charset the response names, else UTF-8", async () => {
    expect((await fetcher.get(`${base}/latin1`, options)).text).toBe("Maldà");
    expect((await fetcher.get(`${base}/utf8-no-charset`, options)).text).toBe("Glòries");
  });

  it("reports where redirects ended", async () => {
    const response = await fetcher.get(`${base}/redirect`, options);
    expect(response).toEqual({
      url: `${base}/films/`,
      status: 200,
      contentType: "",
      text: "films",
    });
  });

  it("returns an error status rather than throwing", async () => {
    const response = await fetcher.get(`${base}/missing`, options);
    expect(response.status).toBe(404);
  });

  it("classifies a timeout", async () => {
    const error = await fetcher.get(`${base}/hang`, { timeoutMs: 50 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).kind).toBe("timeout");
  });

  it("classifies a refused connection", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));

    const error = await fetcher.get(`http://127.0.0.1:${port}/`, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).kind).toBe("network");
  });

  it("throws a malformed URL unwrapped: it's a bug, not worth a retry", async () => {
    await expect(fetcher.get("not a url", options)).rejects.toThrow(TypeError);
  });
});

describe("getOk", () => {
  const answering = (status: number): Fetcher => ({
    get: (url) => Promise.resolve({ url, status, contentType: "", text: "" }),
  });

  it("passes a success through", async () => {
    await expect(getOk(answering(200), "https://a.test/", options)).resolves.toMatchObject({
      status: 200,
    });
  });

  it.each([404, 403, 503])("throws an HttpError for %i", async (status) => {
    await expect(getOk(answering(status), "https://a.test/", options)).rejects.toThrow(
      new HttpError(status, "https://a.test/"),
    );
  });
});
