// Why this file exists (this is the actual reason "the endpoint doesn't
// work" from inside the app, even though the endpoint itself is fine):
//
// `api/gse-live/index.js` and `api/gse-live/[symbol].js` are Vercel
// serverless functions. That "put a file under /api and it becomes an
// endpoint" behaviour is a Vercel-hosting convention — it is NOT something
// Vite knows about. This project's dev script is plain `"dev": "vite"`,
// with no proxy config pointing `/api/*` anywhere.
//
// So when the app is run locally with `npm run dev` and the "Fetch Live
// Prices" button calls fetch("/api/gse-live"), that request goes to Vite's
// own dev server. Vite has no route for it, falls back to serving
// index.html (SPA fallback), and the app tries to JSON.parse an HTML page
// and fails. Meanwhile, hitting the upstream GSE-API (or the deployed
// Vercel /api route) directly works perfectly — because that request never
// goes through the local Vite server at all. That mismatch is exactly what
// made this look like "the endpoint doesn't work" while direct queries
// succeeded.
//
// This plugin fixes that by wiring the *same* handler modules used in
// production straight into Vite's dev middleware stack, so `npm run dev`
// behaves the same way `vercel dev` / production would, with zero extra
// tooling required.

export function gseApiDevMiddleware() {
  return {
    name: "gse-api-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/gse-live")) return next();
        if (req.method !== "GET") return next();

        // Minimal shim so the Vercel-style handlers (res.status().json())
        // work unmodified against Vite's raw Node http response.
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (body) => {
          if (!res.getHeader("Content-Type")) {
            res.setHeader("Content-Type", "application/json");
          }
          res.end(JSON.stringify(body));
        };

        const url = new URL(req.url, "http://localhost");
        // "/api/gse-live" -> ["api","gse-live"], "/api/gse-live/GCB" -> [..., "GCB"]
        const parts = url.pathname.split("/").filter(Boolean);
        req.query = Object.fromEntries(url.searchParams);

        try {
          if (parts.length === 2) {
            const mod = await server.ssrLoadModule("/api/gse-live/index.js");
            await mod.default(req, res);
          } else if (parts.length === 3) {
            req.query.symbol = decodeURIComponent(parts[2]);
            const mod = await server.ssrLoadModule("/api/gse-live/[symbol].js");
            await mod.default(req, res);
          } else {
            next();
            return;
          }
        } catch (err) {
          console.error("[gse-api-dev-middleware] handler crashed:", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: true, message: err.message }));
        }
      });
    },
  };
}
