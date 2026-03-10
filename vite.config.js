import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	server: {
		allowedHosts: ['margorie-unsilhouetted-pratingly.ngrok-free.dev']
	}
})