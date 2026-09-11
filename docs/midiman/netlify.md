# Netlify (the site on the internet)

Owner: **Noa** (R&D tooling).

The app is published on Netlify on every push to `main`. The full account is in the README under **Publishing**; this page is the operator's card.

Workflow: [`.github/workflows/netlify.yml`](../../.github/workflows/netlify.yml)
Script: [`scripts/netlify-deploy.sh`](../../scripts/netlify-deploy.sh), over [`scripts/site.sh`](../../scripts/site.sh)
Config for a UI-connected site: [`netlify.toml`](../../netlify.toml)

## Enable (enough to work)

1. **Repo secret `MIDIMAN_NETLIFY_PAT`** — a Netlify personal access token. The Bitwarden item of the same name holds it.
2. **Enable Actions**. After the workflow lands on **main**, a push to `main` publishes; the tests run first and a red main does not go live.
3. Optional repo variables: `MIDIMAN_NETLIFY_SITE` (site name; default `peak-luli-midiman` since `midiman` is taken on Netlify, created on the first run if absent) or `MIDIMAN_NETLIFY_SITE_ID` (an existing site's API id, wins over the name).

**Smoke test:** Actions → **Netlify** → Run workflow on any branch with `draft=true`. A preview URL, production untouched.

Local:

```bash
MIDIMAN_NETLIFY_PAT=… scripts/netlify-deploy.sh --draft   # preview
MIDIMAN_NETLIFY_PAT=… scripts/netlify-deploy.sh           # production
```

## What the published site is, and is not

`scripts/site.sh` copies an explicit list: the six pages, their sheets, `src/`, `songs/`, `vendor/`, `icons/`, `tracks.json`, the manifest and `sw.js`. Not `docs/` (this wiki), not `design/`, not `test/`, not `serve.py`. `test/site.test.mjs` checks the list against the service worker's shell and the HTML.

Without `serve.py` the site has **no phone relay** (the laptop-mirror for an iPhone stays a same-Wi-Fi feature), **no Feedback endpoint** and **no composer save**. All three fail softly in the pages. What it gains is HTTPS: an Android phone with the piano plugged in gets Web MIDI on the published site with no certificate to trust.

## Failure modes

- *`MIDIMAN_NETLIFY_PAT is not set`* — the secret is missing or the workflow ran from a fork.
- *`could not create a site named …`* — the name is taken on Netlify (names are global). Set `MIDIMAN_NETLIFY_SITE` to another name.
- *deploy `error`* — Netlify rejected the zip; the message from the API is printed. Retry from the Actions page.
