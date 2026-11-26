import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { configuredGateway } from './server/gateway';

export default defineConfig(({ command, mode }) => {
  const root = import.meta.dirname;
  const env = { ...loadEnv(mode, path.resolve(root, '../../..'), ''), ...process.env };
  const readOnly = env.SENTINEL_DEPLOYMENT === 'gateway';
  const base = '/';
  // Credentials are only needed by the development server, never by a static build.
  const gateway = readOnly && command === 'serve' ? configuredGateway(base, env) : null;
  const target = `http://127.0.0.1:${env.WEB_PORT ?? '8050'}`;
  return {
    root, base,
    plugins: [...(gateway ? [gateway.plugin] : []), react(), tailwindcss()],
    define: { 'import.meta.env.VITE_SENTINEL_DEPLOYMENT': JSON.stringify(readOnly ? 'gateway' : 'local') },
    resolve: { alias: { '@': path.resolve(root, 'src') }, dedupe: ['react', 'react-dom'] },
    build: { outDir: path.resolve(root, '../../dist'), emptyOutDir: true },
    server: {
      host: '127.0.0.1', port: Number(env.PORT ?? 5173), strictPort: true,
      proxy: gateway?.proxy ?? { '/api': { target }, '/ws': { target, ws: true } },
    },
    preview: { host: '127.0.0.1', port: Number(env.PORT ?? 4173) },
  };
});
