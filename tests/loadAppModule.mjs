import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Load the app's TypeScript without a listener or additional test dependencies.
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());

export function loadAppModule(path) {
  return server.ssrLoadModule(path);
}
