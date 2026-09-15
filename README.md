# Apartment Planner — Mid-Century Modern

Survey your real apartment from photographs, turn it into an editable 3D model,
and plan it in mid-century modern style using the images, videos and products
you have already been saving.

## What it actually does

**Survey.** Drop in photos of a room. A guided checklist tells you which shots
matter (every wall straight on, each corner, every door and window) because
coverage is what makes the survey worth anything. With an API key configured,
all of a room's photos go to Claude in a single vision call — so a door visible
in one frame sets the scale for every other frame — and come back as room
dimensions, wall and floor colours, window and door sizes, and an honest
assessment of the furniture you already own.

**Plan.** The survey seeds an editable floor plan. Drag a corner to match your
tape measure, slide a window along its wall, push the sofa where it really
goes. Everything writes through to one model.

**3D.** The plan extrudes into a room with two ways to look at it.

*Orbit* is the planning view: walls between you and the room are culled as you
move around it, and you drag furniture along the floor.

*Walk* is the game view. Click in and the pointer locks: mouse to look, WASD to
move, shift to run, C to crouch, Esc to let go. You collide with the walls and
the furniture, the ceiling closes over you, your head bobs with your stride,
and the crosshair names whatever you are standing in front of. Doors and
windows are real cut-outs you can walk up to and see through.

**Light.** A time-of-day slider moves the sun through the day, from a low warm
morning to overhead noon to evening, after which the room is lit only by the
lamps you have placed. This is more than atmosphere: a palette that sings at
3pm can go grey by evening, and a north-facing room never gets direct sun at
all. Scrubbing the day is how you find that out before you buy the paint.

**Library.** Everything you have been collecting — screenshots, video clips,
product links, notes. Each item gets read for what is specifically reusable
about it and scored on how squarely it sits in the period.

**Design.** A rule engine scores the room against fifteen checkable
mid-century rules and turns what it finds into an ordered plan, working out
where each suggested piece physically fits. Anything that matches something in
your library is attributed to it, so the plan is built from things you have
already chosen rather than a generic shopping list.

## About the 3D model

This does **not** do photogrammetry. That was a deliberate call. A point cloud
reconstructed from photos needs a GPU and hours per room, and then you cannot
actually design with it — you cannot slide a credenza along a mesh or ask
whether the walkway is still 80 cm wide. What you want for planning is a
parametric model with real dimensions.

So photos drive *measurement*, and the model is built from those measurements.
You get something you can plan in, and it exports two ways:

- **`.glb` from the 3D tab** — the mesh, drag it straight into Blender.
- **`.py` from the Export menu** — a Blender Python script that rebuilds the
  apartment with a collection per room, named objects for every wall and piece
  of furniture, boolean-cut window and door openings, and real materials. This
  is the more useful one if you intend to keep working on the model: you can
  select "Living Room / Walnut Credenza" in the outliner and move it.

Run the script with `blender --python apartment.py`, or paste it into Blender's
Scripting tab.

If you later want true photogrammetry, `server/src/services/` is where a
COLMAP or gaussian-splat worker would slot in; it would replace the dimension
estimate, not the parametric model.

## Furniture

The catalog is 45 pieces, each with real dimensions and no downloaded assets.
Every piece is generated procedurally in the browser from a shape descriptor,
which means the repo stays small, you can resize anything to match a product
you actually found, and it still exports as clean glTF. The silhouettes are
what matter: low seat heights, tapered legs, and a visible gap of floor
underneath are the things that make a room read as mid-century, and those are
modelled faithfully.

Surfaces are procedural too — wood grain, woven tweed, bouclé, brushed brass,
travertine, cane and floorboards are all painted onto a canvas at load time and
turned into matching normal maps, so things catch light instead of reading as
flat colour. No texture files, and every material still takes the exact hex the
catalog asks for.

## Running it

```bash
npm install
cp .env.example .env     # optional, see below
npm run dev              # server on :8787, app on :5173
```

Then open http://localhost:5173.

For a single-process build:

```bash
npm run build && npm start   # everything on :8787
```

### The API key is optional

Without `ANTHROPIC_API_KEY` set, the app still works end to end:

- Photos upload and are colour-sampled in the browser, so wall and floor
  colours are real.
- You enter room dimensions by hand — which is *more* accurate than any
  estimate if you have a tape measure.
- The rule engine and the whole suggestion pipeline run normally. They are
  deterministic and read geometry, not images.

What the key adds is the photo survey (dimensions, openings and furniture
detection from images), reading your library items properly rather than by
keyword, and a pass that rewrites each suggestion against your own saved
inspiration. Set it in `.env` and restart.

## Layout

```
server/
  src/mcm/          the design brain — all of it deterministic
    knowledge.ts    palettes, materials, 14 checkable rules, room programs
    catalog.ts      44 parametric pieces with real dimensions
    geometry.ts     areas, wall normals, collisions, circulation, placement
    rules.ts        scores a room from geometry alone
    suggest.ts      missing pieces + rule failures -> a placed, ordered plan
  src/services/
    claude.ts       structured vision and text calls
    vision.ts       room survey and library reading, with fallbacks
    blender.ts      the Blender rebuild script
web/
  src/three/
    furniture.ts    procedural mid-century geometry
    textures.ts     canvas-painted surfaces and derived normal maps
    player.ts       first-person controller: look, move, collide
    scene.ts        room shell, sun, wall culling, drag, walk mode, export
  src/components/
    FloorPlan.tsx   the 2D editor
  src/pages/        Survey, Plan, 3D, Library, Design
```

### One convention worth knowing

Plan space is `(x right, y down)` in centimetres and a piece at rotation 0
**faces +y**. The 3D scene maps plan-y onto world +z. `frontDirection()` in
`server/src/mcm/geometry.ts` is the single definition; everything that computes
a facing derives it from there. Getting the plan and the 3D view out of step is
what makes sofas face their own walls.

## Data

Everything lives in `data/` — a JSON document store for metadata and the
original files under `data/uploads/`. Nothing leaves your machine except the
images sent to the Anthropic API when you explicitly run a survey or read a
library item. `data/` is gitignored; the Export menu will give you the whole
project as JSON if you want a backup.
