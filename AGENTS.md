# PROJECT KNOWLEDGE BASE

**Updated:** 2026-06-30 KST

## OVERVIEW

This directory is now a standalone `store-maker` web application. It is not an
Open Design route and does not depend on the Open Design daemon. The active app
entry is `index.html`, served by the local Node server in `server.mjs`.

Older `mqxk28h*` HTML files remain as generated design/reference artifacts only.
The latest visual/design reference for the standalone app is
`mqxk28he-local-model.html`; prefer it over older artifact-bundle guidance.

## ACTIVE APP STRUCTURE

```text
./
├── package.json                  # Node scripts for start/test/e2e
├── server.mjs                    # standalone local HTTP entrypoint
├── index.html                    # active Store Maker app shell
├── assets/
│   ├── app.css                   # standalone UI styling
│   ├── app.js                    # browser interaction and API calls
│   └── app-utils.js              # small browser helpers
├── lib/server/
│   ├── byok.mjs                  # BYOK HTTP preflight/generation
│   ├── config.mjs                # root, timeouts, output limits
│   ├── engines.mjs               # CLI discovery/preflight/execution
│   ├── http.mjs                  # local API routing
│   ├── logs.mjs                  # structured run logs
│   ├── prompt.mjs                # request parsing, prompt, exports
│   └── static.mjs                # allowlisted static serving
├── scripts/mock-engine.mjs       # local mock CLI that reads stdin
└── tests/
    ├── store-maker.test.mjs      # node:test API/server coverage
    └── browser-e2e.mjs           # Chrome CDP browser E2E
```

## LEGACY REFERENCE FILES

These files are reference material from the previous Open Design artifact bundle.
Do not treat them as the active app entrypoint unless the user explicitly asks to
inspect or compare legacy artifacts:

```text
detailpage-app-launcher.html
detailpage-app-launcher.html.artifact.json
dashboard.html
editor.html
generator.html
mqxk28hb-dashboard.html
mqxk28hd-detailpage-app-launcher.html
mqxk28he-detailpage-app-launcher.html.artifact.json
mqxk28he-editor.html
mqxk28he-generator.html
mqxk28he-index.html
mqxk28he-local-model.html
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Start the app | `server.mjs`, `package.json` | Binds to `127.0.0.1`, default port `4317`. |
| Browser UI | `index.html`, `assets/app.css`, `assets/app.js` | Product form, engine setup, logs, preview, exports. |
| Local CLI execution | `lib/server/engines.mjs` | Uses `spawn(..., shell:false)` and sends the composed prompt via stdin. |
| BYOK provider | `lib/server/byok.mjs` | Bounded HEAD preflight and POST generation with timeout. |
| Prompt/export contract | `lib/server/prompt.mjs` | Builds the actual product prompt and Markdown/HTML/JSON exports. |
| Static serving boundary | `lib/server/static.mjs` | Only `/`, `/index.html`, and `/assets/*` are public. |
| API tests | `tests/store-maker.test.mjs` | Covers prompt delivery, static allowlist, BYOK failure paths. |
| Browser E2E | `tests/browser-e2e.mjs` | Drives the real UI through Chrome DevTools Protocol. |
| Design source | `mqxk28he-local-model.html`, `DESIGN.md` | `mqxk28he-local-model.html` is the newest visual reference. |

## COMMANDS

```bash
# Start the standalone app.
npm start

# Start on the expected local review port.
node server.mjs --port 4317

# Run API/server tests.
npm test

# Run browser E2E against a running server.
npm run e2e -- http://127.0.0.1:4317
```

For a persistent local session:

```bash
tmux new-session -d -s store-maker-server -c /Users/b./Desktop/store-maker 'node server.mjs --port 4317'
tmux attach -t store-maker-server
tmux kill-session -t store-maker-server
```

## VALIDATION

Before reporting the app as working, run:

```bash
npm test
node --check server.mjs lib/server/*.mjs scripts/mock-engine.mjs tests/*.mjs assets/app.js assets/app-utils.js
node tests/browser-e2e.mjs http://127.0.0.1:4317
```

Also verify static serving does not expose source/runtime files:

```bash
for route in / /index.html /assets/app.js /server.mjs /lib/server/engines.mjs /tests/store-maker.test.mjs /.omx/notepad.md /package.json /assets/%2e%2e/server.mjs /assets/%ZZ; do
  printf '%s ' "$route"
  curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:4317$route"
done
```

Expected: public routes return `200`; private/malformed routes return `404`.

## CONSTRAINTS

- Do not create or modify files under `/Users/b./Desktop/Open-desigh/open-design`.
- Do not depend on Open Design daemon APIs or `/sangselab` routes.
- Do not assume Codex, Claude, Gemini, or other local CLIs are installed.
- Do not run local CLI engines without sending the composed product prompt.
- Keep generated outputs, logs, and review artifacts inside this `store-maker`
  folder.
- Do not expose source files, `.omx/`, `.omo/`, tests, scripts, or package
  metadata through the local HTTP server.

## NOTES

- `/Users/b./Desktop/store-maker` is not currently a git repository; use direct
  file inspection and command output for local review evidence.
- `.omx/` and `.omo/` contain runtime/review evidence, not public app assets.
- `scripts/mock-engine.mjs` is intentionally present for local E2E verification;
  real provider behavior comes from the selected CLI command or BYOK URL.
