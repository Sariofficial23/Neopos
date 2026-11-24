import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { installTapSound } from './tap'
import './styles.css'
import './clopos.css'
import './clopos-extra.css'
import './clopos-pay.css'

installTapSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
