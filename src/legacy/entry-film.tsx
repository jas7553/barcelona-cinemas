import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./style.css";
import FilmPage, { type FilmPageData } from "./pages/FilmPage";
import { readPageData } from "./hooks/useClient";

const data = readPageData<FilmPageData>();
if (data) {
  hydrateRoot(
    document.getElementById("root")!,
    <StrictMode>
      <FilmPage data={data} />
    </StrictMode>,
  );
}
