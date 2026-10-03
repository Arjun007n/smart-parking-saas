import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // In development the React app calls /api/... and Vite forwards it
    // to the backend, so no CORS setup is needed locally.
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
