import { render } from "preact-render-to-string";
import { today } from "../domain/today.ts";
import { Greeting } from "./Greeting.tsx";

export function renderHome(now: Date): string {
  return render(<Greeting day={today(now)} />);
}
