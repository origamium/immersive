import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AcousticLab as App } from "./acoustics/AcousticLab.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
