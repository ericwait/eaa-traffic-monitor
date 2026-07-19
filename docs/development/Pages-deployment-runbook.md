> Status: living | Audience: the repository owner (and anyone with admin) flipping the Pages source | See also: [TechStack.md](TechStack.md) § The stack, [Implementation-Plan.md](../Implementation-Plan.md) § Phase 5, the deploy workflow at [`.github/workflows/deploy-docs.yml`](https://github.com/ericwait/airshow-traffic-monitor/blob/main/.github/workflows/deploy-docs.yml)

# Pages deployment runbook

Phase 5 replaces the legacy GitHub Pages **branch build** (Jekyll serving `main:/docs`) with an **Actions build** that runs MkDocs Material and deploys the generated site.
The workflow is committed and ready; the one step that stays manual is the source flip in repository settings, because an agent cannot — and must not — change GitHub settings.
This runbook is that step, written down so the owner can do it in about a minute.

## Why the flip is needed

The legacy branch build has two problems this repo hits directly:

- **It cannot render the site.**
  The pages are MkDocs Material Markdown under `docs/`, not a Jekyll site; the branch build has no MkDocs and would serve raw or mis-rendered Markdown.
- **It serves LFS pointer files, not images.**
  Binary assets are Git LFS objects (see [TechStack.md](TechStack.md) § Known limitations); the legacy build checks out pointers, so every image on the published site is broken until an LFS-aware Actions checkout replaces it.

The new workflow does an LFS-aware checkout, builds with `mkdocs build --strict`, and deploys through the first-party `upload-pages-artifact` / `deploy-pages` actions — no third-party publisher, no personal token.

## Sequencing gotcha — flip promptly after this lands on `main`

The hand-written `docs/index.html` landing page is deleted in this same change, and MkDocs serves `docs/README.md` as the site root — so `README.md`, not a new `docs/index.md`, is the generated home (decision 2026-07-19).
The two would collide: MkDocs maps both `README.md` and `index.md` in a directory to the same root URL, and the plan-frozen `docs/Implementation-Plan.md` links to `README.md`, so `README.md` must stay the resolvable root page or the `--strict` build fails.
So the moment this reaches the default branch, the **legacy** branch build no longer has an `index.html` to serve as the home page.
Until the source is flipped to Actions, the published site degrades (GitHub falls back to rendering `README.md` as plain Jekyll, without the Material theme, nav, or working images).
Flipping the source is what restores a correct site — do it as soon as the change is on `main`.

## The manual steps (repository owner)

1. **Confirm the deploy workflow is on the default branch.**
   `deploy-docs.yml` must exist on `main` before Pages can select it.
   It ships in this change; once the release PR merges to `main`, it is there.
2. **Open Settings → Pages.**
   Under **Build and deployment → Source**, change the dropdown from **Deploy from a branch** to **GitHub Actions**.
   That is the whole flip — there is no branch or folder to pick under Actions.
3. **(First time only) approve the `github-pages` environment if it is protected.**
   Settings → Environments → `github-pages`: make sure the `main` branch is allowed to deploy to it.
   A fresh repo needs no change here; a repo with environment protection rules might.
4. **Trigger a deploy.**
   Either push any commit to `main`, or run the workflow manually: Actions → **Deploy docs site** → **Run workflow** (it exposes `workflow_dispatch`).
5. **Verify.**
   Open `https://ericwait.github.io/airshow-traffic-monitor/`.
   The home page is the Material-themed docs, the implementation-plan dependency graph renders as a **diagram** (not a code block), and the prototype screenshots load as real images (proof the LFS-aware checkout worked).

## Permissions and secrets

- **No secrets.**
  The workflow authenticates with the built-in `GITHUB_TOKEN` and Pages OIDC; nothing to add under Settings → Secrets.
- **Workflow permissions are declared in the workflow itself:** `pages: write` and `id-token: write` for the deploy job, `contents: read` otherwise.
  If the org enforces "read-only default `GITHUB_TOKEN`," these per-job declarations still grant what the deploy needs; no org change is required for a public repo with Pages enabled.

## Rollback

If the Actions build ever needs to be backed out, set Settings → Pages → Source back to **Deploy from a branch** (`main` / `docs`).
Note the degraded-home caveat above: with `index.html` gone, the branch build serves the plainly rendered `README.md`, not the themed site.
The clean fix is always forward — fix the MkDocs build and re-deploy through Actions — rather than reverting the source.
