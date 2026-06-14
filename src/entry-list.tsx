import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./style.css";
import ListPage, { type ListPageData } from "./pages/ListPage";
import { readPageData } from "./hooks/useClient";

const data = readPageData<ListPageData>();
if (data) {
  hydrateRoot(
    document.getElementById("root")!,
    <StrictMode>
      <ListPage data={data} />
    </StrictMode>,
  );
}
