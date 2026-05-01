import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// wouter's hash router expects the path in location.hash and the query in
// location.search. Normalize deep links like #/logs?level=info before mount.
{
  const rawHash = window.location.hash;
  const qIdx = rawHash.indexOf("?");
  if (qIdx !== -1) {
    const url = new URL(window.location.href);
    url.hash = rawHash.slice(0, qIdx);
    url.search = rawHash.slice(qIdx);
    history.replaceState(history.state, "", url.href);
  }
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
