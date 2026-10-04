import { hydrate } from "preact";
import { App } from "./App";
import { removeObsoleteKeys } from "./client/prefs";
import type { PageData } from "./pageData";
import "./styles/base.css";
import "./styles/sheet.css";

// The payload is inert JSON (type="application/json"), so the CSP needs no hash for it.
const payload = document.getElementById("__APP_DATA__")?.textContent;
const root = document.getElementById("root");
if (payload && root) hydrate(<App data={JSON.parse(payload) as PageData} />, root);
removeObsoleteKeys();
