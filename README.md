# SharedAnime

Find anime that **every** person in your group has on their **completed** list.

Works with **MyAnimeList** and **AniList**. You can mix users from both sites in one search.

**Live site:** https://shared-anime-lists-git-57346811168.northamerica-northeast2.run.app

Styled after the [AssetWise template](https://lovable.dev/dashboard/templates/apps/internal-tools/assetwise-asset-management-tracking-template).

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
