# SharedAnime

Find anime that **every** person in your group has on their **completed** list.

Works with **MyAnimeList** and **AniList**. You can mix users from both sites in one search.

**Live site (Cloud Run):** https://shared-anime-lists-git-57346811168.northamerica-northeast2.run.app

**Custom domain (GitHub Pages):** https://anime.aheriez.cafe/ (frontend only; API runs on Cloud Run)

Styled after the [AssetWise template](https://lovable.dev/dashboard/templates/apps/internal-tools/assetwise-asset-management-tracking-template).

## Why GitHub Pages was blank

GitHub Pages only hosts static files. This app needs a backend for `/api`. A blank page usually means JS/CSS loaded from the wrong path (`/assets/...` instead of `/shared-anime-lists/assets/...`). The workflow in `.github/workflows/deploy-pages.yml` fixes that and points the UI at Cloud Run.

In GitHub repo **Settings → Pages → Build and deployment**, set source to **GitHub Actions**.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Production

```bash
npm run build
npm start
```

## Cross-platform matching

Anime are matched using **MyAnimeList IDs** when AniList has `idMal` on an entry (most shows do). That lets a MAL user and an AniList user compare lists correctly.

Shows with **no MAL link** on AniList only match other AniList-only entries (same AniList id).

## Notes

- MAL lists must be **public**.
- AniList lists must be visible (not hidden from your profile).
- Only **completed** anime are compared.
- Large lists take longer (MAL paginates by 300, AniList by 50).
