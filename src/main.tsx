import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";

// The list stays mounted under the detail overlay, so its scroll position
// survives on its own. Manual keeps the browser from writing a scroll offset
// of its own on popstate, while the body is still scroll-locked.
if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
