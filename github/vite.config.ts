import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom plugin to strip the problematic importmap injected by the environment
const stripImportMap = () => {
  return {
    name: 'strip-importmap',
    transformIndexHtml(html: string) {
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
    // This allows your code to use process.env.API_KEY in the browser
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});