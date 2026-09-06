import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProactiveSurface } from "./ProactiveSurface";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get("surface") === "proactive" ? <ProactiveSurface /> : <App />}
  </StrictMode>
);
