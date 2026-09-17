# Moonwood: The Lost Star

A single-file browser game in 3-D. Three lands, nine Star Shards, six creatures
to find and ten monsters to beat - and then whatever it was that broke the Star
Gate in the first place.

The camera floats behind him and a good way above, looking down over his
shoulder, so the forest has depth: trees and rocks stand up out of the ground,
things shrink as they get further away, and the Star Gate is a real archway you
can see from across the wood.

## Play it

Once GitHub Pages is turned on (see below), the game lives at:

https://luketeal.github.io/moonwood/

Open that link in **Safari or Chrome**. Tapping "Begin Adventure" starts the game.

## The three lands

Three shards are hidden in each land, and the Star Gate hangs between them:

- **🌲 Moonwood** - dark pines, fireflies and a cold river. Where he starts.
- **🌾 Sunfield** - open country, tall grass, haystacks and warm wind.
- **🏛️ The Ruins** - fallen halls, broken pillars and cold mist.

Walking into the Star Gate in any land opens it up: pick a land and go. He can
wander back and forth as often as he likes, in any order, and the gate shows how
many shards he has found in each.

Bring all nine back to the gate and the Gate Guardian wakes up. Beating it ends
the game. Losing to it costs nothing - he wakes at the foot of the gate, healed,
with the Guardian a little more worn down than before, and can walk straight
back in.

## Fights

Every creature he discovers teaches him a **move**, and each move has a kind -
leaf, water, light, spark, stone or moon. Every monster is afraid of one kind
and takes far more damage from it, so **the creatures of a land are the answer
to the monsters of that land**. The monster's name plate says what it fears, and
the move that beats it glows gold along the bottom of the screen.

The moves do more than damage: Tide Rush heals him as it hits, Stone Smash
leaves the monster too dazed to take its turn, Glimmer Guard shields him from
the next blow. Each one then needs a turn or three to rest, so he cannot lean on
one move forever. The Guardian says out loud when it is winding up something
big, which is the moment to guard or heal.

The monsters get steadily harder: the Moonwood three are gentle, Sunfield is a
step up, the Ruins are hard work. Fainting is never a disaster - he wakes up
safe with full health, and any damage he did to that monster stays done.

## The controls

- **◀** and **▶** turn him left and right, and the camera swings round behind him
- **▲** walks him forward, **▼** steps him back
- **ACTION** looks at things, talks to Luna, picks up shards, and starts fights
- **ABILITY** lists the moves his creatures have taught him
- In a fight the walking buttons step aside and his moves appear along the bottom
- On a keyboard: arrow keys or WASD, space for ACTION, Q for ABILITY, and keys
  1-7 for moves in a fight

Anything that gets between the camera and him - a tree trunk, a boulder - turns
ghostly so he is never lost behind it. In a fight the camera swings round to the
side so you can see the two of them squaring up.

## Publishing it

The game is published by `.github/workflows/deploy.yml`, and there is one live
site: https://luketeal.github.io/moonwood/

- **Pushing to main** publishes main, on its own, a minute or so later.
- **Testing a branch:** go to the repo's **Actions** tab, pick *Deploy to
  GitHub Pages* on the left, hit **Run workflow**, choose the branch, and run
  it. That branch is live at the same address in about half a minute.
- **Putting it back:** run the same workflow again, on main.

Deploying a branch overwrites whatever was live, so while a test branch is up,
that is the game anyone opening the link gets. The workflow only offers
branches that have the workflow file on them.

### One-time setup on github.com

Both of these are under the repo's **Settings**, and only need doing once:

1. **Pages** → *Build and deployment* → set **Source** to **GitHub Actions**.
   The branch dropdown disappears when you do, which is correct - deployments
   are no longer tied to a branch.
2. **Environments** → **github-pages** → *Deployment branches and tags* → set
   it to **All branches**. Without this, GitHub refuses to deploy anything
   except main and the run fails with "not allowed to deploy to github-pages
   due to environment protection rules". (The environment only appears after
   step 1, and possibly only after the first run.)

## The files

- `index.html` — the whole game: layout, art, and code, all in one file
- `.nojekyll` — tells GitHub to publish the file exactly as written
- `.github/workflows/deploy.yml` — publishes the site, and lets you put any
  branch live for testing

## Saving progress

The game saves itself automatically whenever something is earned - a shard picked
up, a creature discovered, a monster beaten, a level gained, a land travelled to -
and shows a short "Progress saved" note when it does. A save made before the
three lands existed still loads: it keeps his level, his creatures and the shards
he had, and sets him down in Moonwood.

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

- **The lands themselves** — `const LANDS`, one block each. Colours, size, what
  grows there, where the gate stands
- **Creature and monster names** — `const CREATURES` and `const MONSTERS`
- **Where the shards are hidden** — `const SHARDS`
- **What the moves do** — `const MOVES`: damage, healing, cooldown and kind
- **How tough monsters are** — the `hp` and `attack` numbers on each monster, and
  `weak` for the kind it fears
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
