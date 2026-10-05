import { hydrate } from "preact";
import { App } from "./App";
import { removeObsoleteKeys } from "./client/prefs";
import type { PageData } from "./pageData";
import "./styles/base.css";
import "./styles/cinema.css";
import "./styles/film.css";
import "./styles/list.css";
import "./styles/map.css";
import "./styles/sheet.css";

const payload = document.getElementById("__APP_DATA__")?.textContent;
const root = document.getElementById("root");
if (payload && root) hydrate(<App data={JSON.parse(payload) as PageData} />, root);
removeObsoleteKeys();
