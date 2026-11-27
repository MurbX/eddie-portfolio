import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Tiny HTML partials: `<!-- @include header.html -->` is replaced with
 * partials/header.html, so every page shares one header, footer and icon set.
 * Variables: `<!-- @include chrome.html page="Photography" -->` fills {{page}}.
 */
function htmlIncludes() {
  const include = (html, depth = 0) =>
    html.replace(/<!--\s*@include\s+([\w./-]+)((?:\s+\w+="[^"]*")*)\s*-->/g, (_, file, attrs) => {
      if (depth > 5) throw new Error(`Include depth exceeded at ${file}`);
      const vars = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const body = readFileSync(resolve(root, 'partials', file), 'utf8')
        .replace(/\{\{(\w+)\}\}/g, (__, key) => vars[key] ?? '');
      return include(body, depth + 1);
    });
  return {
    name: 'html-includes',
    transformIndexHtml: { order: 'pre', handler: (html) => include(html) },
    handleHotUpdate({ file, server }) {
      if (file.includes(`${sep}partials${sep}`)) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({
  plugins: [htmlIncludes()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        services: resolve(root, 'services/index.html'),
        photography: resolve(root, 'services/photography/index.html'),
        videography: resolve(root, 'services/videography/index.html'),
        graphicDesign: resolve(root, 'services/graphic-design/index.html'),
        webDevelopment: resolve(root, 'services/web-development/index.html'),
      },
    },
  },
});
