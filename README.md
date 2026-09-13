# Moonwood: The Lost Star

A single-file browser game. Walk the forest, meet four friendly creatures,
battle four monsters, collect three Star Shards, and bring them back to the
Star Gate.

## Play it

Once GitHub Pages is turned on (see below), the game lives at:

https://luketeal.github.io/moonwood/

Open that link in **Safari or Chrome**. Tapping "Begin Adventure" starts the game.

## Turning on GitHub Pages

One-time setup, done on github.com:

1. Go to the repo → **Settings** → **Pages** (left sidebar)
2. Under "Build and deployment", set **Source** to *Deploy from a branch*
3. Pick the branch that has `index.html`, folder `/ (root)`
4. Click **Save**, wait a minute or two, then open the link above

## The files

- `index.html` — the whole game: layout, art, and code, all in one file
- `.nojekyll` — tells GitHub to publish the file exactly as written

## Editing the game

Everything is in `index.html`. Some easy things to change:

- **Creature and monster names** — search for `const creatures` and `const monsters`
- **How tough monsters are** — the `hp` and `attack` numbers on each monster
- **Walking speed** — `speed:3.1` near the top
- **Story text** — anything inside quotes in the `say(...)` lines

## If the screen is stuck on the start card

The game needs JavaScript. A file preview (the kind that opens when you tap an
attachment) usually does not run JavaScript, so the button does nothing. The
start screen shows a red warning when that happens. Open the page in a real
browser tab instead.

If something goes wrong once the game is running, a red bar appears at the top
of the screen with the error message.
