import { test as base, type BrowserContext } from "@playwright/test";

export { expect } from "@playwright/test";

/** A grey 2×3 PNG, a poster's shape. */
const PLACEHOLDER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAAAAACcgYFdAAAADUlEQVR4nGOYOZMBjAAQLAOXGA+xGQAAAABJRU5ErkJggg==",
  "base64",
);

/** Posters come from a placeholder, so runs don't depend on TMDb. */
async function stubPosters(context: BrowserContext): Promise<void> {
  await context.route("https://image.tmdb.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PLACEHOLDER }),
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await stubPosters(context);
    await use(context);
  },
});
