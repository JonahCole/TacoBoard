# TacoBoard 🌮 — POC

A deliberately lightweight, taco-themed group appreciation board inspired by the ease of online group cards and the playful culture of taco-based peer recognition.

## What this POC does

- Create short appreciation notes with an author name
- Add uploaded photos / animated GIFs
- Paste direct image or GIF URLs
- Choose card colors
- Drag notes anywhere on the board
- Add and drag taco-themed emoji stickers
- Customize board title, subtitle, and background vibe
- Save automatically in the browser with `localStorage`
- Export the full board as PNG or PDF
- Export / import board data as JSON
- Runs as a completely static site, so it can be deployed directly to GitHub Pages

## Important POC limitation

This version is **single-browser/local**, not multi-user. A GitHub Pages site has no database or write API, so visitors do not share the same live board yet.

The JSON import/export is included so the board can still be moved between browsers during testing.

### Natural V2 architecture for real group collaboration

Keep the GitHub Pages frontend and add one tiny hosted data layer:

- **Supabase**: board + post tables, anonymous contribution links, realtime updates, optional admin token
- or **Firebase**: Firestore + anonymous auth
- or **Cloudflare**: Pages + D1/Workers if you want one deployment ecosystem

Suggested minimal data model:

- `boards`: id, title, subtitle, theme, admin_token_hash, created_at
- `posts`: id, board_id, author, message, media_url, color, x, y, rotation, created_at
- `stickers`: id, board_id, emoji, x, y, rotation, size

For uploaded media in V2, use a storage bucket rather than embedding base64 in browser storage.

## Run locally

You can double-click `index.html`, but using a local server is more representative:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Deploy to GitHub Pages

1. Create a new GitHub repository, e.g. `tacoboard`.
2. Put `index.html`, `styles.css`, and `app.js` at the repo root.
3. Commit and push.
4. In GitHub: **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select `main` and `/ (root)`.
7. Save. GitHub will provide the Pages URL.

No build step is required.

## GIF/export note

Uploaded images and GIFs are converted to data URLs, which makes PNG/PDF export much more reliable. Remote GIF/image URLs can display fine but may fail during export when the remote host blocks cross-origin canvas access.

When a GIF is exported to a static PNG/PDF, the export is naturally a still frame.

## External libraries

Loaded from CDN in `index.html`:

- html2canvas — board snapshot
- jsPDF — PDF export
- Google Fonts — DM Sans and Fredoka

For a more locked-down production deployment, pin/self-host these assets and add a Content Security Policy.
