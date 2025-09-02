import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Container />
  </StrictMode>,
)
