# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## AI Insights & Monthly Reports

The Summary tab's "AI Insights" card and the History tab's "AI Report" button (per month) call two serverless functions (`api/ai-summary.js`, `api/ai-monthly-report.js`) that use the real Anthropic API. To enable them:

1. Get an API key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. In your Vercel project → **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` — your key (required)
   - `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-5`
3. Redeploy

Usage is billed to your own Anthropic account. Without a key set, both features show a clear "not set up yet" message instead of failing silently — nothing else in the app is affected.

All the actual numbers (totals, allocation %, trade amounts) are computed client-side as before; the AI only turns already-correct figures into prose, it never does the arithmetic itself.
