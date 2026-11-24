import React from 'react'
import ReactDOM from 'react-dom/client'
// Fontes variáveis auto-hospedadas (licença OFL): funcionam offline e sem pedidos externos.
import '@fontsource-variable/inter'
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import './index.css'
import App from './App.tsx'
import './frontend/discover.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
