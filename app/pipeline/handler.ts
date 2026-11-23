import { MADRID_TZ } from "../shared/madrid.ts";

export function handler(): { tz: string } {
  return { tz: MADRID_TZ };
}
