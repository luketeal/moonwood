# Moonwood: The Lost Star

A single-file browser game in 3-D. Three lands, nine Star Shards, six creatures
to find and ten monsters to beat - and then whatever it was that broke the Star
Gate in the first place.

The camera floats behind him and a good way above, looking down over his
shoulder. The world is real 3-D: the ground rolls, the river runs in a channel
it has cut for itself, the trees are solid things you can walk round, and one
low moon lights all of it and lays every shadow on the ground.

## Play it

Once GitHub Pages is turned on (see below), the game lives at:

https://luketeal.github.io/moonwood/

Open that link in **Safari or Chrome**. Tapping "Begin Adventure" starts the game.

## The three lands

Three shards are hidden in each land, and the Star Gate hangs between them:

- **🌲 Moonwood** - dark pines, fireflies, a cold river and the Great Pine.
- **🌾 Sunfield** - open country, tall grass, haystacks and an old windmill.
- **🏛️ The Ruins** - fallen halls, cold mist and a broken tower.

Each land takes about twenty seconds to walk across and he can only see a
quarter of one at a time, so there is always somewhere he has not been. Every
land has one tall landmark you can see from anywhere in it - walk toward the
tower and you will get there.

Walking into the Star Gate in any land opens it up: pick a land and go. He can
wander back and forth as often as he likes, in any order, and the gate shows how
many shards he has found in each.

Bring all nine back to the gate and the Gate Guardian wakes up. Beating it ends
the game. Losing to it costs nothing - he wakes at the foot of the gate, healed,
with the Guardian a little more worn down than before, and can walk straight
back in.

## Small finds

Walking is worth something. Scattered through the lands:

- **Moonberries** - a few health back. They grow again whenever he leaves a land
  and comes back, so it is worth remembering where the bushes are
- **Campfires** - full health, and a line about what happened here. Two to a
  land, and they glow from a long way off
- **Star seeds** - three hidden in each land. Each one is +1 maximum health,
  forever
- **Standing stones** - carved hints: where a shard is, or what a monster fears
- **Swift boots** - one pair in each land. Each pair makes him permanently
  quicker, so the more he explores the less the walking costs him
- **Frogs, rabbits and bats** - they hop away from him and do nothing else

None of it is needed to finish the game. The nine shards are the only thing
that moves the story on, so nothing important can be missed.

## Finding your way

A compass sits above the buttons, pointing at the nearest shard he has not found
in this land - or at the Star Gate once all three are his. It says "close" when
he is nearly on top of it.

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

If anything tall gets between the camera and him - a tree, a standing column -
the camera slips past it, and if it is too close for that to help, it climbs and
looks down over the top instead. Something standing right at his shoulder cannot
be got round by either, and is left alone: it passes in a step or two, and the
cures for it are more distracting than the problem.

The edge of each land is a raised bank. He is stopped a little short of it, and
without something to see there, "you cannot go that way" and "you have walked
into a stone you cannot see" feel exactly the same. In a fight he takes a step back and the camera
swings round to the side, so you can see the two of them squaring up - and they
turn to face each other, as do creatures when he comes near them.

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

## How it is drawn

The picture is WebGL, through three.js. There is no artwork to download: every
tree, rock, creature and archway is built out of cones, cylinders and spheres
when a land is first walked into, and each land takes about a tenth of a second
to build. What makes it look like anything is the lighting, not the models:

- **One moon**, low and cold, casting real shadows that fall the way the moon
  says they should
- **Distance**, which eats colour, so far trees go blue and soft and the wood
  feels bigger than the screen
- **A bloom pass**, which spills light from anything brighter than daylight -
  shards, campfires, fireflies, the gate, the moon itself. Those things are
  deliberately built brighter than white so that they, and only they, bloom: a
  surface the moon happens to be catching never does, however bright it looks
- **The sky reflected**, baked once per land, which is what puts a moon on the
  river and a little cold light on everything else

### The three lands look different on purpose

The same moon hangs over all three - it is one night - but it sits at a
different height and a different colour over each, and that, with the fog and
the exposure, is what makes them feel like different places rather than one wood
painted three colours. It is all in one table, `MOOD`, at the top of
`render3d.js`:

- **Moonwood** - a cold clear night. The moon is low and blue-white, the fog is
  close, and the wood is enclosed. The river runs through it.
- **Sunfield** - a big warm low moon over open country, almost dusk. Long raking
  shadows, a mauve sky, and much less fog, because you are meant to be able to
  see across it. The grass is tall and leans in the wind.
- **The Ruins** - the moon is high and colourless, so there are no long shadows
  to hide in. The fog is heavy and mist drifts in four sheets between knee and
  head height. Nothing grows much and nothing moves.

The mist keeps a clear bubble around him. Mist that hides the stone he is about
to walk into is not atmosphere, it is a blindfold, so it lives in the middle
distance where it does the work and never between him and his own feet.

Changing `el` in that table moves the moon up or down over a land, which changes
the whole feel of it more than any other single number.

### If it runs slowly

The game watches its own frame rate and quietly steps down if it cannot keep
up - shadows go first, then the glow. You can also force a setting by adding
`?gfx=low`, `?gfx=med` or `?gfx=high` to the address.

## The files

- `index.html` — the game: layout, the world, and all the rules
- `render3d.js` — the camera, the light, the weather and the order of things
- `world3d.js` — the shapes everything is built from, and the lie of the land
- `vendor/` — three.js and the four post-processing passes, kept in the repo so
  the game never depends on anyone else's server staying up
- `.nojekyll` — tells GitHub to publish the files exactly as written
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

The world and the rules are in `index.html`. Some easy things to change:

- **The lands themselves** — `const LANDS`, one block each. Colours, size, what
  grows there, where the gate and the landmark stand. `w` and `h` are the size
  of a land: raise or lower them and the scenery counts in `gen` together
- **Berries, campfires, star seeds, stones and boots** — `const FINDS`
- **Creature and monster names** — `const CREATURES` and `const MONSTERS`
- **Where the shards are hidden** — `const SHARDS`
- **What the moves do** — `const MOVES`: damage, healing, cooldown and kind
- **How tough monsters are** — the `hp` and `attack` numbers on each monster, and
  `weak` for the kind it fears
- **Walking speed** — `speed:3.1` near the top, and `turn:.05` for how fast he turns
- **Story text** — anything inside quotes in the `say(...)` lines
- **The camera** — `const cam`, near the bottom of `index.html`. `dist` is how
  far behind him it sits, `height` how high above, and `aim` the height it
  points at. Raise `height` for more of a bird's eye view, lower it to stand
  closer behind his shoulder.

How it all looks is in the other two files:

- **The light, the fog and the glow** — the top of `render3d.js`. The moon's
  strength and colour, how fast distance eats the picture, and how much the
  bright things bloom
- **What the shapes are** — `world3d.js`. A pine is a few cones on a cylinder;
  make it five cones and it is a different wood
- **The lie of the land** — `makeTerrain` in `world3d.js`: how much the ground
  rolls, how deep the river cuts, and how worn the paths are
- **How a land feels** — the `MOOD` table at the top of `render3d.js`: where the
  moon sits over it, its colour, the fog, the wind and the mist

## If the screen is stuck on the start card

The game needs JavaScript. A file preview (the kind that opens when you tap an
attachment) usually does not run JavaScript, so the button does nothing. The
start screen shows a red warning when that happens. Open the page in a real
browser tab instead.

If something goes wrong once the game is running, a red bar appears at the top
of the screen with the error message.
