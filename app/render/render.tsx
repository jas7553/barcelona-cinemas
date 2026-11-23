import { render } from "preact-render-to-string";
import { madridDay } from "../domain/madrid-date.ts";
import { Greeting } from "./Greeting.tsx";

export function renderHome(now: Date): string {
  return render(<Greeting day={madridDay(now)} />);
}
