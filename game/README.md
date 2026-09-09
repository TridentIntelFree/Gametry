# Gametry

Attempt at in browser 2-d game.

A 2D action-platformer prototype inspired by **Hollow Knight: Silksong**, built with vanilla JavaScript and HTML5 Canvas — no frameworks, no build step, no dependencies.

## Play it

Open `index.html` in any modern browser. That's it.

If you prefer a local server (avoids any browser file restrictions):

```sh
npx serve .
# or
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Controls

| Action | Keys |
| --- | --- |
| Move | Arrow keys / WASD |
| Jump | Z / Space (release early for a short hop) |
| Wall-jump | Hold toward a wall while airborne, then jump |
| Attack | X / J (aim up with Up; down + attack in the air to **pogo**) |
| Dash | C / K (one air-dash; refreshed by landing, wall-jumping, or pogoing) |
| Bind (heal) | Hold V / L while grounded — costs 3 silk |
| Rest | Up at a bench (heals fully, saves checkpoint, respawns enemies) |

On phones and tablets (including iOS) on-screen touch controls appear
automatically: a d-pad on the left and JUMP / ATK / DASH / BIND buttons on the
right. You can slide your thumb across the d-pad without lifting it. Landscape
orientation is recommended. (Append `?touch=1` to the URL to force the touch
controls on a desktop browser.)

## Mechanics

- **Masks** — 5 hit points shown top-left. Lose them all and you return to your last bench.
- **Silk** — earned by striking enemies (or collecting glowing shards). Spend 3 to bind a mask back.
- **Pogo** — striking downward onto enemies *or spikes* bounces you up and refreshes your dash. Chain it.
- **Movement feel** — coyote time, jump buffering, variable jump height, and wall-slides are all in, tuned for tight platforming.

## The level

A hand-built cave: starting chamber with a bench → spike-pit crossing → wall-jump shaft → upper cavern with flyers, crawlers, and a final bench that marks the end of the demo.

## Project structure

```
index.html      entry point
style.css       canvas centering / letterbox
js/input.js     keyboard state + action mapping
js/level.js     ASCII tile map, collision, tile rendering
js/player.js    movement, combat, silk & masks
js/enemies.js   Crawler and Flyer
js/game.js      game loop, camera, particles, background, UI
```

## Ideas for what's next

- Sound effects and ambient music
- More rooms and an interconnected map (true metroidvania layout)
- Boss fight
- Abilities gated behind exploration (double jump, needle upgrades)
- Gamepad support
