import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import App from "./App"
import faviconUrl from "./favicon.svg"
import "./index.css"

const favicon = document.createElement("link")
favicon.rel = "icon"
favicon.type = "image/svg+xml"
favicon.href = faviconUrl
document.head.appendChild(favicon)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
