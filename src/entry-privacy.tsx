import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./style.css";
import PrivacyPage from "./pages/PrivacyPage";

// Privacy page has no server-embedded data payload — it is pure static prose.
// Hydrate directly without reading #__APP_DATA__.
hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
);
