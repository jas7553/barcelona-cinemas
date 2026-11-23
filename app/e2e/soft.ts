import { expect, test } from "@playwright/test";

/** Runs one check as a step; a failure is recorded and the test carries on to the next check. */
export async function softCheck(name: string, run: () => Promise<void> | void): Promise<void> {
  await test.step(name, async () => {
    let failure = "";
    try {
      await run();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect.soft(failure, name).toBe("");
  });
}
