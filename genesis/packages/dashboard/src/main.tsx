import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import { App } from "./App.tsx";
import { installDebugHook } from "./lib/debug.ts";
import { wireSocket } from "./store/wiring.ts";

wireSocket();
installDebugHook();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
