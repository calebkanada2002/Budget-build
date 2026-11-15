# Budget Build: your own website

This folder is the whole game. When it's set up, anyone can open your link, type a name and a room code, and play. Nobody needs an account. AI decks (✨ topics, "Make your own deck" and 🏠 Home Team) run through your own Claude API key, which stays hidden on the server.

You'll use three free services:

| Service | What it does | Cost |
|---|---|---|
| **Supabase** | Keeps everyone's phones in sync during a game | Free |
| **GitHub** | Stores the game files | Free |
| **Netlify** | Hosts the website and runs the AI helper | Free |
| **Anthropic (Claude API)** | Writes AI decks | Pay per use (small); set a monthly limit |

Setup takes about 20–30 minutes the first time.

---

## Step 1: Supabase (online rooms)

1. Go to **supabase.com** and sign up.
2. Click **New project**. Name it anything (for example, `budget-build`), choose a database password and pick the region closest to you. Wait a minute while it sets up.
3. Open **Project Settings → API Keys** (on some accounts it's **Project Settings → API**).
4. Copy two things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - The **publishable** key (starts with `sb_publishable_`). If you only see an **anon public** key, use that one.
5. Open **`config.js`** in this folder with any text editor and paste them in:

```js
window.BB_CONFIG = {
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_KEY: "sb_publishable_..."
};
```

These two values are meant to be public. They only let browsers join game rooms. Never put your **secret** or **service_role** key here.

> Free Supabase projects pause after about a week with no activity. If online play stops working, log in to Supabase and click **Restore project**.

## Step 2: GitHub (store the files)

1. Go to **github.com** and sign up.
2. Click **+ → New repository**. Name it `budget-build` and click **Create repository**.
3. Click **uploading an existing file**.
4. Drag in **everything in this folder**: `index.html`, `config.js`, `netlify.toml`, `README.md` and the **`netlify`** folder. Keep the folder structure: the AI helper must stay at `netlify/functions/make-deck.mjs`.
5. Click **Commit changes**.

## Step 3: Netlify (put it online)

1. Go to **netlify.com** and sign up with your GitHub account.
2. Click **Add new site → Import an existing project → GitHub** and choose `budget-build`.
3. Leave the build settings as they are (the `netlify.toml` file handles them) and click **Deploy**.
4. After about a minute you'll get a link like `https://something-random.netlify.app`. You can rename it under **Site configuration → Change site name**, for example `budgetbuild-youth.netlify.app`.

The game now works for one-phone and online play. Next, turn on AI decks.

## Step 4: Claude API key (AI decks)

1. Go to **console.anthropic.com** and sign up.
2. Under **Billing**, add a small amount of credit. Under **Limits**, set a **monthly spend limit** you're comfortable with.
3. Under **API Keys**, click **Create Key** and copy it. It starts with `sk-ant-`. Keep it private.
4. In Netlify, open your site, then **Site configuration → Environment variables → Add a variable**:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-...` key
5. Optional: add `GAME_PASSWORD` with any word, like `potluck`. Players will then have to type it before generating AI decks, so strangers who find your link can't use up your credit.
6. Go to **Deploys → Trigger deploy → Deploy site** so the new settings take effect.

The ✨ and 🏠 Home Team options now appear in the game.

**Optional settings** (also environment variables):

| Name | What it does | Default |
|---|---|---|
| `ANTHROPIC_MODEL` | Which Claude model writes decks | `claude-haiku-5-5` |
| `MAX_DECKS_PER_HOUR` | AI decks each player can make per hour | `20` |

---

## Playing

- **Host:** open the link, type your name and tap **Host a game**. Share the 4-letter code.
- **Players:** open the same link, type a name and the code and tap **Join**.
- **TV:** open the link on a laptop or smart TV, type the code and tap **Join as the TV screen**.
- **One phone:** tap **Play on this phone** to pass one device around.

## Making changes later

Edit a file on GitHub (open it and click the ✏️ pencil), then commit. Netlify redeploys automatically in about a minute.

Packs you write or edit in the game are saved in that browser only. In online games, the host's packs are shared with the room automatically.

## If something doesn't work

- **"Online play isn't set up yet":** check that `config.js` has your Supabase URL and key, with the quotes kept.
- **No ✨ options:** check that `ANTHROPIC_API_KEY` is set in Netlify and that you redeployed after adding it.
- **"Couldn't make that deck":** check your Anthropic credit and spend limit. In Netlify, open **Logs → Functions → make-deck** to see the error.
- **Online play stopped after a quiet week:** restore the Supabase project (see Step 1).
