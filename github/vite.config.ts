import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom plugin to strip any problematic importmap that might be injected
const stripImportMap = () => {
  return {
    name: 'strip-importmap',
    transformIndexHtml(html: string) {
      // Strips <script type="importmap">...</script>
      return html.replace(/<script type="importmap">[\s\S]*?<\/script>/gi, '');
    },
  };
};

export default defineConfig({
  plugins: [
    react(),
    stripImportMap()
  ],
  define: {
    // Inject API key for client-side use
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 3000,
    strictPort: true
  }
});