import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";

// We restore list scroll ourselves (MainList); the browser's automatic
// popstate restoration fires while the detail screen is still mounted,
// clamps to 0, and clobbers ours.
if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
