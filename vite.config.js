import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // The site is served from https://mochatr.github.io/shop-checkout/
  base: '/shop-checkout/',
  plugins: [react()],
})
