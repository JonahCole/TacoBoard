# TacoBoard 2.0 🌮

**Appreciation, with seasoning.**

TacoBoard is a lightweight shared celebration board inspired by the fun, low-friction spirit of HeyTaco and the visual board mechanic of Kudoboard — without turning appreciation into a sterile HR workflow.

Version 2.0 is still a POC, but it is now designed to be genuinely usable with coworkers:

- Create a board from the homepage
- Separate **contributor** and **admin** links
- Shared notes stored in Supabase
- GIF/photo support (small uploads, direct URLs, optional GIPHY search)
- Taco/sticker decorations
- Admin drag-and-drop arrangement
- Admin edit/delete controls
- Realtime-ish board refresh using Supabase Realtime Broadcast
- Multiple board themes, including deliberately tragic **Corporate Beige**
- **Serve Board** to close contributions and make the board read-only
- PNG and PDF keepsake export
- JSON board-data export
- Local preview mode before Supabase is configured
- Static frontend: deploy directly to GitHub Pages

## Fastest path to a live shared TacoBoard

### 1. Create a free Supabase project

Create a project at Supabase. When it is ready, open **SQL Editor**.

### 2. Run `setup.sql`

Copy the entire contents of `setup.sql` into the Supabase SQL Editor and run it once.

The SQL creates:

- `tacoboards`
- `tacoboard_posts`
- `tacoboard_stickers`
- Token-validated database functions used by the browser

The tables themselves have RLS enabled and direct access revoked from browser roles. TacoBoard only exposes the specific RPC operations the app needs.

### 3. Fill in `config.js`

In Supabase, copy the project URL and **publishable key** from your project API settings.

Then edit:

```js
window.TACOBOARD_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_KEY',
  GIPHY_API_KEY: ''
};
```

A legacy Supabase `anon` browser key also works if your project still uses that key format.

**Never put a Supabase `service_role` or secret key in `config.js`.** This file is public on GitHub Pages.

### 4. Optional: enable built-in GIPHY search

Create a GIPHY developer API key and add it to `GIPHY_API_KEY`.

If you leave it blank, TacoBoard still supports:

- direct image/GIF uploads
- pasted image/GIF URLs

The GIF Search tab simply stays unavailable.

### 5. Push these files to GitHub

The repository root should look like:

```text
.nojekyll
index.html
styles.css
app.js
config.js
setup.sql
README.md
```

No npm install, build command, Node server, or bundler is required.

### 6. Turn on GitHub Pages

In the GitHub repository:

1. Open **Settings**
2. Open **Pages**
3. Under **Build and deployment**, select **Deploy from a branch**
4. Choose `main`
5. Choose `/ (root)`
6. Save

Open the resulting GitHub Pages URL.

## Testing the shared flow

1. Open the homepage and create a TacoBoard.
2. TacoBoard immediately gives you two URLs.
3. Keep the **admin URL**.
4. Open the **contributor URL** in another tab or browser.
5. Add a note from the contributor link.
6. The admin board should refresh after the realtime broadcast.
7. As admin, drag the card, add stickers, edit the board theme, or delete a note.
8. Open **Board → Serve board** when you are finished.
9. Export the finished wall as PNG or PDF.

## Link permissions

### Contributor URL

Contains a high-entropy contributor token. It can:

- View that board
- Add notes
- Add stickers while the board is open

It cannot:

- Edit/delete notes
- Move cards/stickers
- Change the board
- Serve/reopen the board
- Retrieve the admin token

### Admin URL

Contains a separate high-entropy admin token. It can do everything.

Anyone with the admin link effectively has admin access, so do not send it to the group.

## How the backend works

This version deliberately avoids user accounts.

```text
GitHub Pages
     ↓
 TacoBoard UI
     ↓
Supabase RPC functions
     ↓
Postgres tables

Supabase Realtime Broadcast
     ↓
"refresh this board" events
```

The raw tables are not directly readable/writable by the browser roles. The app calls `SECURITY DEFINER` functions that validate the board token and perform only the requested operation.

The admin token is stored as a SHA-256 hash. The contributor token is stored server-side so an authenticated admin link can retrieve and re-copy the contributor URL later.

## Media note for this POC

To keep TacoBoard deployable as **only GitHub Pages + Supabase**, small uploaded images/GIFs are stored as data URLs with the post. Uploads are capped at **1.25 MB** in the UI and **2,000,000 characters** in the database.

That is intentionally a POC tradeoff. The production-ish next step would move uploaded media to a private Supabase Storage bucket using a token-validating Edge Function or signed upload flow.

Direct GIPHY/media URLs do not consume database storage, but an arbitrary third-party image host can block canvas access and prevent PNG/PDF export. Uploaded media is the most reliable export path.

## Local preview mode

If `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are blank, TacoBoard automatically runs in local preview mode using `localStorage`.

This is useful for checking the UI before setup. The app clearly labels the board as local-only; contributor links do **not** create real collaboration until Supabase is configured.

## Current POC boundaries

Deliberately not included yet:

- User accounts / SSO
- Slack integration
- Reactions
- Comment threads
- Email notifications
- Board expiration
- Abuse/rate limiting
- Private object storage
- Analytics
- Custom domains

Those can come later if real-world use proves they are worth having. The goal of 2.0 is still: **make board → send link → add tacos → serve board**.
