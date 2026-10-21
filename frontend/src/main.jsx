import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
// Shared design tokens + component styles ported verbatim from public/css/styles.css,
// used by Settings and (later) Terminal/Scanner/Strategy. Its custom-property names
// differ from theme.css's (e.g. --bg-base vs --bg) but every value that overlaps is
// identical, so loading both is safe.
import './scanrApp.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
