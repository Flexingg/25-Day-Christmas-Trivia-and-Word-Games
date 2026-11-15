# 🎄 Randall Christmas

A 25-day Advent calendar of trivia and word games for the Randall family. There are six
personal paths (Meg, Rafa, Thomas, Kathy, Mom, Dad), each with puzzles built around that person,
plus shared Christmas and Faith & Scripture bonus puzzles every day.

- Days unlock on **December 1–25**. You can go back to any earlier day, but you can't get ahead.
- **Progress is saved on the server** per path.
- Puzzle types: multiple choice, type-the-answer, word scramble, **Wordle**, **Connections**.
- An **admin page** (`/admin`) for writing, editing, reviewing and previewing every puzzle.
- Answers are checked on the server, so they can't be peeked at in dev tools.

📋 See **[docs/PLAN.md](docs/PLAN.md)** for the plan for each path.

---

## Running it (Docker Compose / Portainer)

### Option A: command line
```bash
git clone https://github.com/Flexingg/25-Day-Christmas-Trivia-and-Word-Games.git
cd 25-Day-Christmas-Trivia-and-Word-Games
cp .env.example .env        # then edit ADMIN_PASSWORD
docker compose up -d --build
```
Open http://localhost:3000 (or `http://<your-computer-ip>:3000` from phones on your Wi-Fi).

### Option B: Portainer
1. **Stacks → Add stack → Repository**
2. Repository URL: `https://github.com/Flexingg/25-Day-Christmas-Trivia-and-Word-Games`
3. Compose path: `docker-compose.yml`
4. Under **Environment variables**, add `ADMIN_PASSWORD` (and `TZ` / `HOST_PORT` if you want
   something other than `America/New_York` / `3000`).
5. **Deploy the stack.** To update later, use **Pull and redeploy**.

Your database lives in the `christmas-data` Docker volume, so redeploying or updating the code
**does not** wipe progress or your admin edits.

### Settings
| Variable | Default | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | `changeme` | Password for `/admin`. **Change it!** |
| `TZ` | `America/New_York` | Days unlock at midnight in this time zone |
| `HOST_PORT` | `3000` | Port on your computer |
| `EVENT_YEAR` | current year | Which December counts (can also be set in Admin → Settings) |

---

## Using the admin page (`/admin`)

- **📅 Calendar**: pick a path and see all 25 days with puzzle counts per section
  (⭐ personal / 🎄 Christmas / ✝️ faith). Click a day to edit it.
  - **+ Add** a puzzle in any section, with a form for each type (or switch to **Raw JSON**).
  - Reorder (↑↓), duplicate, delete, or switch a puzzle between **draft** (hidden from players)
    and **ready**.
  - **👀 Preview** plays the day as that person, with everything unlocked and drafts shown.
    Preview progress goes to a separate sandbox and never touches real progress.
  - Path settings: name, emoji, color, tagline, and an optional **PIN**.
  - The **🎁 Everyone (shared bonus)** path holds puzzles that appear on every path.
- **🔎 Review**: one table of every puzzle for a path, with questions, answers and explanations
  side by side. You can search and filter by status or section, and click a row to edit.
- **🏆 Progress**: everyone's scores and per-day progress. You can reset a day or a whole path.
- **⚙️ Settings**:
  - **Pretend today is…** sets a date override for testing (e.g. `2026-12-10`). It affects
    everyone, so clear it before December!
  - **Sync from repo content/**: pulls new or updated puzzles from the `content/` folder into
    the database. Anything you edited in the admin is kept unless you tick "overwrite".
  - **Download export / Import**: back up or move all puzzle content as one JSON file.

### Where content lives
- `content/paths.json` holds the six paths.
- `content/<path>/day-NN.json` holds one day of puzzles for one path.
- `content/_shared/day-NN.json` holds the shared Christmas and faith bonus puzzles.

On first start, the database is seeded from `content/`. After that, the **database is the source
of truth** and the admin page edits it. To bring new content from the repo in (after a
`git pull` / Portainer redeploy), click **Settings → Sync from repo content/**.

To save admin edits back into the repo: **Download export**, then
`npm run bundle-to-content -- path/to/export.json`, then commit.

### Puzzle JSON format
```json
{
  "id": "meg-d01-04",
  "section": "main",            // main | christmas | faith
  "type": "wordle",             // multiple_choice | text_answer | scramble | wordle | connections
  "points": 3,
  "status": "ready",            // ready | draft
  "prompt": "Guess the 5-letter bird.",
  "word": "EGRET",
  "hint": "A wading bird with snowy plumes.",
  "explanation": "",
  "maxGuesses": 6
}
```
Look at the files in `content/*/day-01.json` for a working example of every type.

---

## Development
```bash
npm install
ADMIN_PASSWORD=dev npm run dev     # http://localhost:3000, auto-restarts on change
npm test                           # puzzle engine + API tests, and validates all content/ files
```

Stack: Node 22 + Express + SQLite (`better-sqlite3`), with a vanilla-JS frontend and no build step.

```
server/
  index.js      routes (player API + admin API), auth, static files
  puzzles.js    puzzle type engine: public view, answer checking, reveal
  content.js    import/export between content/ JSON and the database
  dates.js      Dec 1–25 gating + time zone + date override
  db.js         SQLite schema
public/
  index.html, js/app.js            player app
  admin.html, js/admin.js          admin app
  js/puzzles/<type>.js             one renderer per puzzle type
  js/puzzle-types.js               admin form fields per puzzle type
content/                           puzzle source files (JSON)
```

**Adding a new puzzle type:** add it to `server/puzzles.js`, add a renderer in
`public/js/puzzles/<type>.js` (and register it in `public/js/app.js`), and add its form fields in
`public/js/puzzle-types.js`.
