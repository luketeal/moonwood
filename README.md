# Moonwood: The Lost Star

A single-file browser game in 3-D. Walk the forest, meet four friendly
creatures, battle four monsters, collect three Star Shards, and bring them back
to the Star Gate.

The camera floats behind him and a good way above, looking down over his
shoulder, so the forest has depth: trees and rocks stand up out of the ground,
things shrink as they get further away, and the Star Gate is a real archway you
can see from across the wood.

## Play it

Once GitHub Pages is turned on (see below), the game lives at:

https://luketeal.github.io/moonwood/

Open that link in **Safari or Chrome**. Tapping "Begin Adventure" starts the game.

## The controls

- **◀** and **▶** turn him left and right, and the camera swings round behind him
- **▲** walks him forward, **▼** steps him back
- **ACTION** looks at things, talks to Luna, picks up shards, and attacks
- **ABILITY** uses a creature power in a fight
- On a keyboard: arrow keys or WASD, space for ACTION, Q for ABILITY

Anything that gets between the camera and him - a tree trunk, a boulder - turns
ghostly so he is never lost behind it. In a fight the camera swings round to the
side so you can see the two of them squaring up.

## Turning on GitHub Pages

One-time setup, done on github.com:

1. Go to the repo → **Settings** → **Pages** (left sidebar)
2. Under "Build and deployment", set **Source** to *Deploy from a branch*
3. Pick the branch that has `index.html`, folder `/ (root)`
4. Click **Save**, wait a minute or two, then open the link above

## The files

- `index.html` — the whole game: layout, art, and code, all in one file
- `.nojekyll` — tells GitHub to publish the file exactly as written

## Saving progress

The game saves itself automatically whenever something is earned - a shard picked
up, a creature discovered, a monster beaten, a level gained - and shows a short
"Progress saved" note when it does.

Next time the game is opened there are two buttons:

- **Continue** picks up where he left off
- **Start Over** begins a fresh adventure and erases the save

Winning the game also clears the save, so the next visit starts clean.

Two things worth knowing:

- The save lives in **that browser on that phone**. It will not follow him to a
  tablet or a different browser, and clearing browser data erases it. Saves that
  follow you between devices need an account and a server, which is a much
  bigger project.
- Private browsing mode may refuse to save. The game still plays normally, it
  just will not remember anything.

## Editing the game

Everything is in `index.html`. Some easy things to change:

- **Creature and monster names** — search for `const creatures` and `const monsters`
- **How tough monsters are** — the `hp` and `attack` numbers on each monster
- **Walking speed** — `speed:3.1` near the top, and `turn:.05` for how fast he turns
- **Story text** — anything inside quotes in the `say(...)` lines
- **The camera** — `const cam` near the middle of the file. `dist` is how far
  behind him it sits, `height` how high above, and `aim` the height it points
  at. Raise `height` for more of a bird's eye view, lower it to stand closer
  behind his shoulder.

## If the screen is stuck on the start card

The game needs JavaScript. A file preview (the kind that opens when you tap an
attachment) usually does not run JavaScript, so the button does nothing. The
start screen shows a red warning when that happens. Open the page in a real
browser tab instead.

If something goes wrong once the game is running, a red bar appears at the top
of the screen with the error message.
