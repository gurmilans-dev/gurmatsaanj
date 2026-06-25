import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

function semanticCacheHeaders() {
  const applyHeaders = (middlewares) => {
    middlewares.use((req, res, next) => {
      const url = String(req.url || '').split('?')[0];
      let cacheControl = '';

      if (url === '/semantic/manifest.json') {
        cacheControl = 'no-cache';
      } else if (
        url === '/semantic/embeddings.bin' ||
        url === '/semantic/index.json' ||
        url === '/semantic/shabad-meta.json'
      ) {
        cacheControl = 'public, max-age=31536000, immutable';
      }

      if (cacheControl) {
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
          if (String(name).toLowerCase() === 'cache-control') {
            return originalSetHeader(name, cacheControl);
          }
          return originalSetHeader(name, value);
        };
        res.setHeader('Cache-Control', cacheControl);
      }

      next();
    });
  };

  return {
    name: 'semantic-cache-headers',
    configureServer(server) {
      applyHeaders(server.middlewares);
    },
    configurePreviewServer(server) {
      applyHeaders(server.middlewares);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  // basicSsl serves the dev AND preview servers over HTTPS with a self-signed
  // cert. Needed so phones reaching the app over the LAN IP (Sangat View QR,
  // remote mic) get a "secure context" — Web Speech, wake lock, and the
  // browser cache are all gated on https:// (or localhost). The cert is
  // self-signed, so each device accepts a one-time "not private" warning.
  plugins: [react(), basicSsl(), semanticCacheHeaders()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev-time proxy so the frontend can call /api/* without CORS.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        timeout: 60_000,
        proxyTimeout: 60_000,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({ error: 'Connection to backend lost. Reconnecting...' }));
          });
        },
      },
    },
  },
  // `npm run preview` serves the production build. By default it has NO
  // proxy, so /api/* requests fall through to the SPA fallback (index.html),
  // axios chokes on the HTML, and every state-publish / poll loop hammers
  // the connection slots until Chrome runs out (ERR_INSUFFICIENT_RESOURCES).
  // Mirror the dev proxy here so the preview server forwards /api to the
  // running backend on port 5000.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        timeout: 60_000,
        proxyTimeout: 60_000,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
