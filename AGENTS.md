<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- The signed-in app (`src/app/(app)`) renders client-side behind a static skeleton (`AppShell` waits for `useMounted`): data comes from Supabase via TanStack Query, and dates use the browser's time zone. Don't read the current time during server rendering.
- Server work lives in route handlers under `src/app/api`. Background jobs use the service-role client (`src/lib/supabase/admin.ts`) and must stay server-only.
- Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` before committing.
