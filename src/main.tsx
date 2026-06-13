import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";

// MainList restores its own scroll offset on remount (it unmounts when a detail
// opens). Manual keeps the browser from racing that with a popstate-driven
// scroll of its own.
if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
