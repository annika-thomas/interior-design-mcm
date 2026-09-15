import type { Finding, Furniture, Opening, Photo, Point, Room } from '../types.js';
import { CATALOG_BY_KEY } from './catalog.js';
import { ANTI_PATTERNS, DESIGN_RULES, MATERIALS } from './knowledge.js';
import {
  areaSqm, circulation, distanceToNearestWall, footprint, openingCenter, overlaps, walls,
} from './geometry.js';

const RULE = Object.fromEntries(DESIGN_RULES.map((r) => [r.key, r]));

const WOOD_KEYS = new Set(['walnut', 'teak', 'oak', 'rosewood', 'rattan', 'bentply', 'greywash']);
const TEXTURE_GROUPS: Record<string, string[]> = {
  wood: ['walnut', 'teak', 'oak', 'rosewood', 'bentply', 'greywash'],
  woven: ['tweed', 'wool-boucle', 'rattan'],
  pile: ['rug', 'rug-shag'],
  hard: ['travertine', 'smoked-glass', 'brass', 'blackened-steel', 'chrome', 'fiberglass'],
  leather: ['leather'],
};

function materialsOf(f: Furniture): string[] {
  const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
  return item ? item.materials : [];
}

function categoryOf(f: Furniture): string | null {
  const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
  return item?.category ?? null;
}

function roleOf(f: Furniture): string | null {
  const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
  return item?.role ?? null;
}

function finding(
  ruleKey: string,
  status: Finding['status'],
  severity: Finding['severity'],
  detail: string,
  fix: string,
): Finding {
  const r = RULE[ruleKey];
  return {
    ruleKey,
    title: r?.title ?? ruleKey,
    category: r?.category ?? 'styling',
    severity,
    status,
    detail,
    fix,
  };
}

const cm = (n: number) => `${Math.round(n)} cm`;

export interface RoomEvaluation {
  styleScore: number;
  summary: string;
  findings: Finding[];
  metrics: Record<string, number>;
}

/**
 * Score a room against the mid-century rule set.
 *
 * Every check is grounded in measurable geometry or in the catalog metadata of
 * the pieces placed, so the same room always scores the same way — no model call
 * involved. Anything the data cannot settle is reported as `unknown` rather than
 * quietly passing.
 */
export function evaluateRoom(
  room: Room,
  furniture: Furniture[],
  openings: Opening[],
  photos: Photo[] = [],
): RoomEvaluation {
  const findings: Finding[] = [];
  const metrics: Record<string, number> = {};
  const area = areaSqm(room.polygon);
  metrics.areaSqm = Math.round(area * 10) / 10;
  const floorPieces = furniture.filter((f) => f.z < 60);

  // --- leg lift -------------------------------------------------------
  const LIFTABLE = new Set(['seating', 'storage', 'sleeping', 'work', 'tables']);
  const groundHuggers = floorPieces.filter((f) => {
    const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
    if (!item) return false;
    // Lighting, rugs, plants and decor are not "furniture on legs".
    if (!LIFTABLE.has(item.category)) return false;
    // A pedestal or plinth base is a deliberate period form, not a piece that
    // forgot its legs — a tulip table and a Nelson bench both belong here.
    if (item.legs === 'pedestal' || item.legs === 'plinth') return false;
    if (item.shape === 'plant' || item.shape === 'box') return false;
    return item.legClearanceCm < 12;
  });
  metrics.groundHuggers = groundHuggers.length;
  if (!floorPieces.length) {
    findings.push(finding('leg-lift', 'unknown', 'info', 'No furniture placed yet.', 'Place the anchor pieces first, then re-run the review.'));
  } else if (groundHuggers.length) {
    findings.push(finding('leg-lift', 'fail', 'major',
      `${groundHuggers.length} piece(s) sit flat on the floor: ${groundHuggers.map((f) => f.label).join(', ')}.`,
      'Raise them on tapered or hairpin legs, or swap them out. Visible floor beneath furniture is the strongest MCM cue there is.'));
  } else {
    findings.push(finding('leg-lift', 'pass', 'info', 'Every piece stands clear of the floor.', 'Keep it that way when you add anything new.'));
  }

  // --- low horizon ----------------------------------------------------
  const tall = floorPieces.filter((f) => {
    const cat = categoryOf(f);
    if (cat && !['storage', 'tables', 'work'].includes(cat)) return false;
    const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
    // Wall-hung shelving is allowed above the line; floor-standing case goods are not.
    if (item?.shape === 'shelf' && item.placement.includes('wall-mounted')) return false;
    return f.heightCm > 90;
  });
  metrics.tallCaseGoods = tall.length;
  if (tall.length) {
    findings.push(finding('low-horizon', 'fail', 'major',
      `${tall.map((f) => `${f.label} (${cm(f.heightCm)})`).join(', ')} rise above the 90 cm case-good ceiling.`,
      'Swap for a lowboy version, or move the piece out of the room’s main sightline. The long low horizon is what makes the style read.'));
  } else if (floorPieces.length) {
    findings.push(finding('low-horizon', 'pass', 'info', 'Case goods stay under 90 cm — the horizon line holds.', 'Keep new storage low and wide rather than tall.'));
  }

  // --- circulation ----------------------------------------------------
  const circ = circulation(room, furniture);
  metrics.openFloorRatio = Math.round(circ.openFloorRatio * 100) / 100;
  metrics.widestGapCm = Math.round(circ.widestGapCm);
  const minPath = RULE['walk-path'].check?.min ?? 75;
  if (!floorPieces.length) {
    findings.push(finding('walk-path', 'unknown', 'info', 'Nothing placed yet, so the room is entirely walkable.', 'Re-check once the anchor pieces are in.'));
  } else if (circ.widestGapCm < minPath) {
    findings.push(finding('walk-path', 'fail', 'major',
      `The widest clear run through the room is ${cm(circ.widestGapCm)}, below the ${cm(minPath)} minimum.`,
      'Pull one piece out or shrink a footprint. A room you have to edge around never feels calm however good the pieces are.'));
  } else {
    findings.push(finding('walk-path', 'pass', 'info',
      `Widest clear run is ${cm(circ.widestGapCm)} and ${Math.round(circ.openFloorRatio * 100)}% of the floor is open.`,
      'Comfortable. Protect that run as you add pieces.'));
  }

  // --- floating the seating group -------------------------------------
  const sofas = floorPieces.filter((f) => roleOf(f) === 'sofa');
  if (sofas.length && area >= 14) {
    const pinned = sofas.filter((f) => distanceToNearestWall(f, room.polygon) < 8);
    metrics.sofaWallGapCm = Math.round(Math.min(...sofas.map((f) => distanceToNearestWall(f, room.polygon))));
    if (pinned.length) {
      findings.push(finding('float-the-seating', 'fail', 'minor',
        `${pinned.map((f) => f.label).join(', ')} is pushed flat against the wall.`,
        'Pull it 10-25 cm forward. The shadow gap behind the sofa is what makes the piece read as furniture rather than built-in.'));
    } else {
      findings.push(finding('float-the-seating', 'pass', 'info', 'The seating group floats off the wall.', 'Good — that gap is doing real work.'));
    }
  }

  // --- rug anchoring ---------------------------------------------------
  const rugs = furniture.filter((f) => roleOf(f) === 'rug');
  const seats = floorPieces.filter((f) => ['sofa', 'lounge-chair'].includes(roleOf(f) ?? ''));
  if (seats.length) {
    if (!rugs.length) {
      findings.push(finding('rug-anchor', 'fail', 'major',
        'There is a seating group but no rug under it.',
        'Add a rug large enough that the front legs of every seat land on it — 240x300 cm is the usual living-room size.'));
    } else {
      const rugArea = rugs.reduce((s, r) => s + (r.widthCm * r.depthCm) / 10_000, 0);
      metrics.rugAreaRatio = Math.round((rugArea / Math.max(area, 0.1)) * 100) / 100;
      const rugPolys = rugs.map((r) => footprint(r));
      const landed = seats.filter((s) => rugPolys.some((rp) => overlaps(footprint(s), rp)));
      metrics.seatsOnRug = landed.length;
      if (landed.length < seats.length) {
        findings.push(finding('rug-anchor', 'fail', 'minor',
          `${seats.length - landed.length} of ${seats.length} seats do not touch the rug.`,
          'Size up the rug or slide it under the group. A rug floating clear of the furniture reads as a bath mat.'));
      } else {
        findings.push(finding('rug-anchor', 'pass', 'info', 'The rug binds the whole seating group.', 'Exactly right.'));
      }
    }
  }

  // --- wood tone consistency ------------------------------------------
  const woods = new Set<string>();
  for (const f of furniture) for (const m of materialsOf(f)) if (WOOD_KEYS.has(m)) woods.add(m);
  metrics.woodToneCount = woods.size;
  if (woods.size > 2) {
    findings.push(finding('wood-consistency', 'fail', 'minor',
      `${woods.size} different wood tones in one room: ${[...woods].join(', ')}.`,
      'Pick one primary and at most one secondary. Mismatched woods make good pieces look accidental.'));
  } else if (woods.size) {
    findings.push(finding('wood-consistency', 'pass', 'info', `${woods.size} wood tone(s) — disciplined.`, 'Match any new wood to what is already here.'));
  }

  // --- texture variety --------------------------------------------------
  const present = new Set<string>();
  for (const f of furniture) {
    const mats = materialsOf(f);
    const role = roleOf(f);
    for (const [group, keys] of Object.entries(TEXTURE_GROUPS)) {
      if (mats.some((m) => keys.includes(m))) present.add(group);
      if (role && keys.includes(role)) present.add(group);
    }
    if (role === 'rug') present.add('pile');
  }
  metrics.textureCount = present.size;
  const minTex = RULE['texture-count'].check?.min ?? 4;
  if (furniture.length >= 3 && present.size < minTex) {
    const missing = Object.keys(TEXTURE_GROUPS).filter((g) => !present.has(g));
    findings.push(finding('texture-count', 'fail', 'minor',
      `Only ${present.size} texture families present (${[...present].join(', ')}).`,
      `Add ${missing.slice(0, 2).join(' and ')}. With a restrained palette, texture is what keeps the room from going flat.`));
  } else if (furniture.length >= 3) {
    findings.push(finding('texture-count', 'pass', 'info', `${present.size} texture families — layered nicely.`, 'Nothing needed here.'));
  }

  // --- lighting layers ---------------------------------------------------
  const lights = furniture.filter((f) => categoryOf(f) === 'lighting');
  metrics.lightSourceCount = lights.length;
  const minLights = RULE['three-light-sources'].check?.min ?? 3;
  if (lights.length < minLights) {
    findings.push(finding('three-light-sources', 'fail', lights.length <= 1 ? 'major' : 'minor',
      `${lights.length} light source(s) placed; the room wants at least ${minLights}.`,
      'Layer ambient, task and accent. This is the single highest-impact and cheapest change in most rooms.'));
  } else {
    findings.push(finding('three-light-sources', 'pass', 'info', `${lights.length} light sources across the room.`, 'Put them on separate switches or smart plugs if you can.'));
  }

  // --- bulb temperature (from photos) -----------------------------------
  const temps = photos.map((p) => p.analysis?.colorTemperature).filter(Boolean) as string[];
  if (temps.length) {
    const cool = temps.filter((t) => t === 'cool').length;
    if (cool) {
      findings.push(finding('warm-bulbs', 'fail', 'minor',
        `${cool} of ${temps.length} photos show cool-white light.`,
        'Swap every bulb in this room for 2700K. Walnut, brass and wool all need warm light to show their color.'));
    } else {
      findings.push(finding('warm-bulbs', 'pass', 'info', 'Light reads warm in your photos.', 'Keep all bulbs at one temperature.'));
    }
  } else {
    findings.push(finding('warm-bulbs', 'unknown', 'info', 'No photo evidence of bulb temperature yet.', 'Upload a photo taken at night with the lamps on and this will resolve.'));
  }

  // --- negative space ----------------------------------------------------
  const ws = walls(room.polygon);
  if (ws.length && floorPieces.length >= 3) {
    const emptyWalls = ws.filter((w) => !furniture.some((f) => {
      const d = distanceToNearestWall(f, room.polygon);
      if (d > 60) return false;
      // Is this piece nearest to *this* wall?
      return footprint(f).some((c) => {
        const vx = w.b.x - w.a.x, vy = w.b.y - w.a.y;
        const lenSq = vx * vx + vy * vy || 1;
        let t = ((c.x - w.a.x) * vx + (c.y - w.a.y) * vy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(c.x - (w.a.x + t * vx), c.y - (w.a.y + t * vy)) < 60;
      });
    }));
    metrics.emptyWalls = emptyWalls.length;
    if (!emptyWalls.length) {
      findings.push(finding('negative-space', 'fail', 'minor',
        'Every wall in the room has something against it.',
        'Clear one wall completely. The eye needs somewhere to rest, and the pieces you kept will register more strongly.'));
    } else {
      findings.push(finding('negative-space', 'pass', 'info', `${emptyWalls.length} wall(s) left open.`, 'Resist filling them.'));
    }
  }

  // --- art height --------------------------------------------------------
  const art = furniture.filter((f) => roleOf(f) === 'art' || roleOf(f) === 'mirror');
  if (art.length) {
    const check = RULE['art-height'].check!;
    const bad = art.filter((f) => {
      const center = f.z + f.heightCm / 2;
      return center < (check.min ?? 135) || center > (check.max ?? 155);
    });
    if (bad.length) {
      findings.push(finding('art-height', 'fail', 'minor',
        bad.map((f) => `${f.label} centers at ${cm(f.z + f.heightCm / 2)}`).join(', ') + '.',
        'Move it so the center sits at 145 cm from the floor. Hanging too high is the most common styling mistake there is.'));
    } else {
      findings.push(finding('art-height', 'pass', 'info', 'Art hangs at the right height.', 'Nothing needed.'));
    }
  }

  // --- organic counterpoint ----------------------------------------------
  if (floorPieces.length >= 3) {
    const curvy = furniture.some((f) => {
      const item = f.catalogKey ? CATALOG_BY_KEY[f.catalogKey] : undefined;
      return item?.tags.some((t) => t === 'curve' || t === 'organic');
    });
    metrics.organicPieces = curvy ? 1 : 0;
    if (!curvy) {
      findings.push(finding('organic-counterpoint', 'fail', 'minor',
        'Everything in the room is rectilinear.',
        'Add one genuine curve — a womb chair, a round mirror, a kidney coffee table, or a big leafy plant. A plant costs almost nothing and does the job.'));
    } else {
      findings.push(finding('organic-counterpoint', 'pass', 'info', 'There is a curved counterpoint to the grid.', 'Good balance.'));
    }
  }

  // --- window clearance ---------------------------------------------------
  const windows = openings.filter((o) => o.kind === 'window');
  if (windows.length && floorPieces.length) {
    const blocking: string[] = [];
    for (const win of windows) {
      const c = openingCenter(win, room.polygon);
      if (!c) continue;
      for (const f of floorPieces) {
        if (f.heightCm <= win.sillCm) continue;
        const near = footprint(f).some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 90);
        if (near) blocking.push(f.label);
      }
    }
    metrics.windowBlockers = new Set(blocking).size;
    if (blocking.length) {
      findings.push(finding('window-clearance', 'fail', 'minor',
        `${[...new Set(blocking)].join(', ')} rises above the sill in front of a window.`,
        'Move it, or swap for something below sill height. Indoor-outdoor connection is central to the era — do not fight the glass.'));
    } else {
      findings.push(finding('window-clearance', 'pass', 'info', 'Windows are clear.', 'Hang curtains at the ceiling, outside the frame, to push it further.'));
    }
  }

  // --- anti-patterns seen in photos ---------------------------------------
  const seen = new Set<string>();
  for (const p of photos) for (const a of p.analysis?.antiPatterns ?? []) seen.add(a);
  for (const key of seen) {
    const ap = ANTI_PATTERNS.find((a) => a.key === key);
    if (ap) {
      findings.push({
        ruleKey: `anti:${ap.key}`,
        title: ap.label,
        category: 'styling',
        severity: 'minor',
        status: 'fail',
        detail: 'Spotted in your survey photos.',
        fix: ap.fix,
      });
    }
  }

  // --- score ---------------------------------------------------------------
  const weight = (f: Finding) => (f.severity === 'major' ? 3 : f.severity === 'minor' ? 1.5 : 0.5);
  const scored = findings.filter((f) => f.status !== 'unknown');
  const possible = scored.reduce((s, f) => s + weight(f), 0);
  const earned = scored.filter((f) => f.status === 'pass').reduce((s, f) => s + weight(f), 0);
  const styleScore = possible ? Math.round((earned / possible) * 100) : 0;

  const fails = findings.filter((f) => f.status === 'fail');
  const majors = fails.filter((f) => f.severity === 'major');
  const summary = !furniture.length
    ? `${room.name} is surveyed but empty at ${metrics.areaSqm} sqm. Place the anchor pieces and the review will fill in.`
    : majors.length
      ? `${room.name} scores ${styleScore}/100. ${majors.length} thing(s) are working against the style right now — start with "${majors[0].title}".`
      : fails.length
        ? `${room.name} scores ${styleScore}/100 and the fundamentals are sound. ${fails.length} refinement(s) left.`
        : `${room.name} scores ${styleScore}/100 — it passes every check in the rule set.`;

  return { styleScore, summary, findings, metrics };
}

/** Which material keys in this room are period-questionable. */
export function suspectMaterials(furniture: Furniture[]): string[] {
  const inauthentic = new Set(MATERIALS.filter((m) => !m.authentic).map((m) => m.key));
  const found = new Set<string>();
  for (const f of furniture) for (const m of materialsOf(f)) if (inauthentic.has(m)) found.add(m);
  return [...found];
}
