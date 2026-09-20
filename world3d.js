/* ---------------------------------------------------------------------------
   WHAT THE WORLD IS MADE OF

   Every shape in the game is built here out of cones, cylinders and spheres -
   no artwork files, nothing to download. They are all built once when a land is
   first walked into and then kept, so walking back into a land costs nothing.

   The game's map is flat: everything has an x and a y, and z is height. On that
   map x runs east and y runs SOUTH, which - with z up - is a left-handed set of
   axes. Three.js is right-handed with y up. The rule that reconciles them, and
   the only one that matters in this file, is:

       game (x, y, z)  ->  three (x, z, y)

   and a heading of `a` on the map is a turn of MINUS `a` about three's up axis.

   Both halves of that matter. Sending game y to three's -z instead looks fine
   and is quietly a mirror image of the world: left and right swap over, so the
   turn buttons and the compass all come out backwards.
--------------------------------------------------------------------------- */
import * as THREE from './vendor/three.module.min.js';
import { mergeGeometries, mergeVertices } from './vendor/utils/BufferGeometryUtils.js';

export function v3(x, y, z) { return new THREE.Vector3(x, z || 0, y); }
export function setPos(obj, x, y, z) { obj.position.set(x, z || 0, y); }

// A heading on the map, as a turn in the scene.
export function yaw(a) { return -a; }

/* ---------------------------------------------------------------------------
   THE SAME LAND EVERY TIME

   The hills are not random - they come out of this hash, so the ground has the
   same bumps in it every time the game is opened, exactly like the trees do.
--------------------------------------------------------------------------- */
function hash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
export function fbm(x, y, oct) {
  let v = 0, amp = 1, tot = 0;
  for (let i = 0; i < (oct || 3); i++) { v += vnoise(x, y) * amp; tot += amp; x *= 2.03; y *= 2.03; amp *= .5; }
  return v / tot;
}

// How far a spot is from a line of points - used for the paths and the river.
function distToLine(x, y, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    let t = len ? ((x - a.x) * dx + (y - a.y) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a.x + dx * t - x, ey = a.y + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/* ---------------------------------------------------------------------------
   THE GROUND

   Gently rolling, not a flat sheet. Paths press it flat where feet have worn
   it down, and the river cuts a real channel into it with banks either side.
   The ground never drops below FLOOR except in that channel, which is what lets
   one sheet of water lie across the whole land and only show in the river.
--------------------------------------------------------------------------- */
/* One sheet of water lies across the whole land and is meant to show ONLY where
   the river has cut the ground away. That only works while the sheet stays below
   the open ground everywhere else - and the waves lift it by about five, so the
   gap has to be bigger than the waves. At -25 it was breaking the surface all
   over the flat parts of the land and flooding them. */
const FLOOR = -21;                // the lowest the open ground is ever allowed to sink
export const WAVE_HEIGHT = 5.1;   // how far the shader lifts the water at its peak
export const WATER_LEVEL = -34;   // comfortably under FLOOR - WAVE_HEIGHT

export function makeTerrain(L, curveOf) {
  const lanes = (L.paths || []).map(pa => ({
    pts: curveOf(pa.pts), w: pa.w, col: new THREE.Color(pa.c), water: pa.pts === 'river'
  }));
  // Only the widest river lane digs the channel; the narrow one is just colour.
  let carve = null;
  for (const lane of lanes) if (lane.water && (!carve || lane.w > carve.w)) carve = lane;

  function slowHeight(x, y) {
    let h = (fbm(x / 620, y / 620, 3) - .5) * 34 + (fbm(x / 170 + 31, y / 170 + 17, 2) - .5) * 7;
    if (h < FLOOR) h = FLOOR;
    for (const lane of lanes) {
      if (lane.water) continue;
      const r = lane.w * .75;
      const d = distToLine(x, y, lane.pts);
      if (d < r) h *= 1 - smooth(1 - d / r) * .8;   // a worn path lies flatter than the hill it crosses
    }
    if (carve) {
      const r = carve.w * 1.5;
      const d = distToLine(x, y, carve.pts);
      if (d < r) { const t = smooth(1 - d / r); h -= t * t * 54; }
    }
    /* And at the edge of the land the ground rises into a bank. He is stopped
       about forty paces short of the boundary, and until now nothing said so -
       he simply stopped walking, which in mist is indistinguishable from having
       hit a stone he could not see.

       It rises rather than falls on purpose. Ground that drops away is almost
       invisible from a camera looking down over his shoulder - you simply see
       over it - whereas ground that rises stands between him and the distance
       and reads as a wall at a glance. The border trees end up along the top of
       it, which is what a real field boundary looks like anyway.

       Applied last, so a path running out to the edge cannot flatten it away. */
    const edge = Math.max(-x, x - L.w, -y, y - L.h) + 38;
    if (edge > 0) h += smooth(Math.min(1, edge / 130)) * 95;
    return h;
  }

  /* Working a height out from scratch means walking every path and the whole
     river for that one point. Doing it for the boy, the camera, the light and
     every creature sixty times a second is far too much, and on a phone it shows
     up as a stutter. So it is worked out once onto a grid when the land is built,
     and read back off the grid with a little smoothing after that - about twenty
     times cheaper, and close enough that he never floats or sinks. */
  const STEP = 32, PAD = 700;
  const gx0 = -PAD, gy0 = -PAD;
  const gnx = Math.ceil((L.w + PAD * 2) / STEP) + 1;
  const gny = Math.ceil((L.h + PAD * 2) / STEP) + 1;
  const grid = new Float32Array(gnx * gny);
  for (let j = 0; j < gny; j++) {
    for (let i = 0; i < gnx; i++) grid[j * gnx + i] = slowHeight(gx0 + i * STEP, gy0 + j * STEP);
  }

  function height(x, y) {
    const fx = (x - gx0) / STEP, fy = (y - gy0) / STEP;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= gnx - 1 || j >= gny - 1) return slowHeight(x, y);
    const tx = fx - i, ty = fy - j, n = gnx;
    const a = grid[j * n + i], b = grid[j * n + i + 1];
    const c = grid[(j + 1) * n + i], d = grid[(j + 1) * n + i + 1];
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  }

  function colourAt(x, y, h, out) {
    const m = fbm(x / 240 + 7, y / 240 + 3, 3);
    out.copy(base).multiplyScalar(.74 + m * .52);
    // A second, larger patchwork so the ground is not one even tone.
    const patch = fbm(x / 900 + 41, y / 900 + 13, 2);
    out.lerp(tint, patch * .35);
    for (const lane of lanes) {
      const r = lane.w * .5;
      const d = distToLine(x, y, lane.pts);
      if (d < r + 46) out.lerp(lane.col, (1 - smooth(Math.max(0, d - r) / 46)) * (lane.water ? .85 : .78));
    }
    // The lip of the river channel is bare and pale, the way a bank really is.
    if (carve && h < -6) out.lerp(bank, Math.min(.7, (-6 - h) / 30));

    /* The edge of the land. He is stopped about forty paces short of it, and
       until now nothing said so - he simply stopped walking, which in the mist
       is indistinguishable from having hit a stone he could not see. The ground
       itself now darkens across that line, so "you cannot go that way" is
       something you can SEE rather than something you discover. */
    const edge = Math.max(-x, x - L.w, -y, y - L.h) + 38;
    if (edge > -62) {
      const t = smooth(Math.min(1, Math.max(0, (edge + 62) / 150)));
      out.lerp(apron, t * .92);
      out.multiplyScalar(1 - t * .32);
    }
    return out;
  }
  const base = new THREE.Color(L.ground);
  const tint = new THREE.Color(L.ground).offsetHSL(.04, -.05, .06);
  const bank = new THREE.Color(0x6b6350);
  const apron = new THREE.Color(L.apron);

  return { height, colourAt, hasWater: !!carve };
}

// The ground itself, as one piece of geometry with the colour baked into it.
/* ---------------------------------------------------------------------------
   HOW SURFACES ARE SHADED

   Everything lit in the game is made through lit(), so the whole world is
   shaded the one way from the one place.

   Light is put through a ramp of a few flat steps rather than falling off
   smoothly, so a surface is either lit or not lit with a hard edge between,
   which is what a drawing does. The ramp is a picture one pixel per step, read
   with no smoothing between them - that is the whole mechanism.

   Toon materials have no roughness, no metalness and no reflections, so those
   are dropped on the way through rather than being left to sit unused. The
   river is the one surface that still needs them - it is what lies the moon on
   the water - and so is built by hand rather than through here.

   This is set once before any land is built, and read while the shapes are
   being made. It is a module-level setting rather than an argument because
   every one of the fourteen builders below would otherwise have to be handed it
   and pass it on, for something that never changes while a land is alive.
--------------------------------------------------------------------------- */
let STYLE = { ramp: null, ink: null, inkColour: 0, inkWidth: 0 };

/* ---------------------------------------------------------------------------
   THE INK LINE

   A drawing holds a shape apart from what is behind it with a line round the
   outside. This does it the old way: build the shape a second time a little
   larger, turn it inside out, and paint it dark. The larger copy is hidden
   behind the real one everywhere except round the edge, where it shows as a
   line of even thickness.

   Two things make or break it.

   The copy is grown by pushing every corner out along the way its surface
   faces. That only closes up if the corners are SHARED between the faces that
   meet there - on a box built as six separate flats, each flat marches off in
   its own direction and the shape comes apart at the seams. So the copy is
   welded and its normals recomputed first, whatever the original was doing.
   It is a copy, so the original keeps its own shading either way.

   And the line is hung on the shape it belongs to rather than beside it, so an
   arm that swings takes its outline with it and nothing has to be kept in step.
--------------------------------------------------------------------------- */
function inkMaterial(colour, width) {
  const m = new THREE.MeshBasicMaterial({
    color: colour,
    side: THREE.BackSide,   // only the far side of the bigger copy is drawn
    fog: true               // a far-off figure should not keep a crisp black line
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uInk = { value: width };
    sh.vertexShader = 'uniform float uInk;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed += normalize(normal) * uInk;`
    );
  };
  m.customProgramCacheKey = () => 'ink';
  return m;
}

/* Give one shape its line. The line becomes a child of the shape, so it
   inherits every move the shape makes for nothing. */
const _inkCache = new Map();
const _size = new THREE.Vector3();

/* A line thicker than the thing it is drawn round does not outline it, it
   swallows it. A bat's wing is 1.2 across and the line is 1.8, so the wing
   would come out as a solid dark slab rather than a wing with an edge. So a
   part thinner than the line gets a finer one, in proportion. Materials are
   shared between parts that land on the same width, so this costs a handful
   of them rather than one per part. */
function inkFor(mesh, mat, width) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox.getSize(_size);
  const thinnest = Math.min(_size.x, _size.y, _size.z) * Math.min(
    Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z));
  const want = Math.min(width, thinnest * 0.28);
  if (want >= width) return mat;
  const key = want.toFixed(2);
  if (!_inkCache.has(key)) _inkCache.set(key, inkMaterial(STYLE.inkColour, want));
  return _inkCache.get(key);
}

function inkOne(mesh, mat) {
  const shell = mergeVertices(mesh.geometry.clone());
  shell.computeVertexNormals();
  const line = new THREE.Mesh(shell, inkFor(mesh, mat, STYLE.inkWidth));
  line.castShadow = false;       // it is not a thing, it is a line round a thing
  line.receiveShadow = false;
  line.userData.isInk = true;
  mesh.add(line);
}

/* Give everything in a group its line. Anything built to glow is left alone:
   a shard or an eye is a light, and a light does not have an edge drawn on it. */
export function inkGroup(g) {
  if (!STYLE.ink) return g;
  const meshes = [];
  g.traverse(o => {
    if (o.isMesh && !o.userData.isInk && !(o.material && o.material.isMeshBasicMaterial)) meshes.push(o);
  });
  for (const m of meshes) inkOne(m, STYLE.ink);
  return g;
}

export function setStyle(s) {
  Object.assign(STYLE, s);
  if (STYLE.ink) STYLE.ink.dispose();
  for (const m of _inkCache.values()) m.dispose();
  _inkCache.clear();
  STYLE.ink = (STYLE.inkColour !== undefined && STYLE.inkWidth > 0)
    ? inkMaterial(STYLE.inkColour, STYLE.inkWidth) : null;
}

/* The ramp. Each number is how much of the light reaches a surface in that
   band, from the side facing away to the side facing the moon. Nearest-neighbour
   sampling is what keeps the steps hard - with smoothing it is just a gradient
   again, which is the thing being got rid of. */
export function toonRamp(steps) {
  const a = new Uint8Array(steps.length);
  for (let i = 0; i < steps.length; i++) a[i] = Math.round(Math.min(1, Math.max(0, steps[i])) * 255);
  const t = new THREE.DataTexture(a, a.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function lit(p) {
  const q = {};
  for (const k in p) {
    if (k === 'roughness' || k === 'metalness' || k === 'envMapIntensity') continue;
    q[k] = p[k];
  }
  if (STYLE.ramp) q.gradientMap = STYLE.ramp;
  return new THREE.MeshToonMaterial(q);
}

export function groundMesh(L, terrain, quality) {
  const apron = 1600;                       // the land keeps going past its edges
  const w = L.w + apron * 2, h = L.h + apron * 2;
  const seg = quality === 'low' ? 96 : 160;
  const segY = Math.round(seg * h / w);
  const geo = new THREE.PlaneGeometry(w, h, seg, segY);
  geo.rotateX(-Math.PI / 2);                // three's plane stands up; lay it down

  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Plane sits around the origin; shift it so it covers the land.
    const gx = pos.getX(i) + L.w / 2, gy = pos.getZ(i) + L.h / 2;
    const y = terrain.height(gx, gy);
    pos.setY(i, y);
    terrain.colourAt(gx, gy, y, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, lit({
    vertexColors: true, roughness: 1, metalness: 0
  }));
  mesh.position.set(L.w / 2, 0, L.h / 2);
  mesh.receiveShadow = true;
  return mesh;
}

/* ---------------------------------------------------------------------------
   SHAPES

   paint() stamps a colour onto every corner of a shape, so a tree that is brown
   at the bottom and green at the top is still ONE shape drawn in ONE go.
--------------------------------------------------------------------------- */
function paint(geo, hex) {
  // Some of three's shapes come indexed and some do not, and they cannot be
  // merged with each other. Everything here is flat-shaded anyway, so drop the
  // index and they all become mergeable.
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function at(geo, x, y, z) { geo.translate(x, y, z); return geo; }

// Every tree is built 100 tall and then scaled, so one shape does for all of them.
export const TREE_H = 100;

export function pineGeometry() {
  const parts = [paint(at(new THREE.CylinderGeometry(2.6, 4.4, 36, 6), 0, 18, 0), 0x4a3628)];
  const tiers = [[26, 34, 26], [42, 32, 21.5], [58, 30, 17], [72, 28, 11.5]];
  for (const [base, hgt, rad] of tiers) {
    const cone = new THREE.ConeGeometry(rad, hgt, 7, 1);
    cone.rotateY(base * .7);                         // each tier turned a little, so it is not a stack of copies
    parts.push(paint(at(cone, 0, base + hgt / 2, 0), 0x24553e));
  }
  return mergeGeometries(parts);
}

export function broadleafGeometry() {
  const parts = [paint(at(new THREE.CylinderGeometry(3, 5, 46, 6), 0, 23, 0), 0x4a3628)];
  const blobs = [[0, 62, 0, 27], [14, 74, 6, 18], [-15, 71, -5, 17], [2, 84, -8, 14]];
  for (const [x, y, z, r] of blobs) {
    parts.push(paint(at(new THREE.IcosahedronGeometry(r, 1), x, y, z), 0x24553e));
  }
  return mergeGeometries(parts);
}

export function deadTreeGeometry() {
  const parts = [paint(at(new THREE.CylinderGeometry(2.2, 4.6, 70, 6), 0, 35, 0), 0x4a463e)];
  const limbs = [[.9, .5, 62, 30], [-1.1, .7, 52, 26], [.2, .9, 70, 22], [-2.4, .6, 44, 20]];
  for (const [yaw, tilt, y, len] of limbs) {
    const b = new THREE.CylinderGeometry(.8, 1.9, len, 5);
    b.translate(0, len / 2, 0);
    b.rotateZ(tilt);
    b.rotateY(yaw);
    parts.push(paint(at(b, 0, y, 0), 0x4a463e));
  }
  return mergeGeometries(parts);
}

// A lumpy stone rather than a smooth ball - the corners are pushed about a bit.
export function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pos = geo.attributes.position;
  const moved = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = [pos.getX(i).toFixed(3), pos.getY(i).toFixed(3), pos.getZ(i).toFixed(3)].join();
    let m = moved.get(key);
    if (!m) {
      const n = hash2(Math.round(pos.getX(i) * 97), Math.round(pos.getZ(i) * 131));
      m = .74 + n * .5;
      moved.set(key, m);
    }
    pos.setXYZ(i, pos.getX(i) * m, pos.getY(i) * m * .78, pos.getZ(i) * m);
  }
  geo.computeVertexNormals();
  geo.translate(0, .42, 0);
  return paint(geo, 0x4a4d52);
}

// A few spikes of grass in a clump. Tiny, but there are hundreds of them.
export function tuftGeometry(colour) {
  // Six fine blades rather than four fat ones. A three-sided cone is still the
  // cheapest thing that reads as a blade of grass, but at the old width they
  // looked like splinters once there were thousands of them.
  const parts = [];
  const blades = [[0, 0, 1], [3.4, 1.6, .82], [-3, 2.4, .74], [1.2, -3.2, .66],
                  [-2.2, -2.4, .6], [4.1, -1.2, .55]];
  for (const [x, z, s] of blades) {
    // Open-ended: the cap sits underground and is never seen, and there are
    // a great many of these.
    const b = new THREE.ConeGeometry(1.05 * s, 22 * s, 3, 1, true);
    b.translate(0, 22 * s / 2, 0);
    b.rotateZ((hash2(Math.round(x * 13), Math.round(z * 17)) - .5) * .55);
    b.rotateY(hash2(Math.round(z * 29), Math.round(x * 11)) * 6.283);
    parts.push(at(b, x, 0, z));
  }
  return paint(mergeGeometries(parts), colour);
}

/* ---------------------------------------------------------------------------
   THE THINGS EACH LAND GROWS - haystacks, pillars, rubble and the rest
--------------------------------------------------------------------------- */
export function propGeometry(type) {
  if (type === 'grass') return tuftGeometry(0x6b8e45);
  if (type === 'flower') {
    const stem = paint(at(new THREE.CylinderGeometry(.5, .7, 19, 4), 0, 9.5, 0), 0x6f9349);
    const head = paint(at(new THREE.IcosahedronGeometry(5.4, 0), 0, 23, 0), 0xf0dc86);
    return mergeGeometries([stem, head]);
  }
  if (type === 'hay') {
    // Round and slumped, with a thatched peak and a darker course where the
    // bottom has been rained on. Plenty of segments, because at this size the
    // facets of a coarse one read as canvas panels rather than straw.
    const dome = new THREE.SphereGeometry(30, 16, 10);
    dome.scale(1, 1.12, 1);
    const cap = new THREE.ConeGeometry(13, 28, 12);
    const foot = new THREE.CylinderGeometry(30.5, 33, 9, 16);
    return mergeGeometries([
      paint(at(dome, 0, 28, 0), 0xb08f47),
      paint(at(cap, 0, 62, 0), 0xc3a257),
      paint(at(foot, 0, 5, 0), 0x87692f)
    ]);
  }
  if (type === 'bale') {
    const g = new THREE.CylinderGeometry(20, 20, 40, 12);
    g.rotateZ(Math.PI / 2);
    return paint(at(g, 0, 20, 0), 0xa3853f);
  }
  if (type === 'column') {
    const base = paint(at(new THREE.BoxGeometry(34, 9, 34), 0, 4.5, 0), 0x4f4c46);
    const shaft = paint(at(new THREE.CylinderGeometry(11, 12.5, 96, 10), 0, 57, 0), 0x625f57);
    const top = new THREE.CylinderGeometry(11.5, 11, 12, 10);
    const pos = top.attributes.position;       // snapped off, not sawn off
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) - hash2(i * 7, 3) * 11);
    }
    top.computeVertexNormals();
    return mergeGeometries([base, shaft, paint(at(top, 0, 110, 0), 0x6e6a61)]);
  }
  if (type === 'fallen') {
    const g = new THREE.CylinderGeometry(11, 12, 96, 10);
    g.rotateZ(Math.PI / 2);
    g.rotateY(.6);
    return paint(at(g, 0, 11, 0), 0x5c584f);
  }
  if (type === 'arch') {
    const legL = paint(at(new THREE.BoxGeometry(22, 140, 26), -46, 70, 0), 0x625f57);
    const legR = paint(at(new THREE.BoxGeometry(22, 104, 26), 46, 52, 0), 0x625f57);
    const span = new THREE.TorusGeometry(46, 12, 6, 14, Math.PI * .62);
    span.rotateZ(Math.PI * .19);
    return mergeGeometries([legL, legR, paint(at(span, 0, 140, 0), 0x67635b)]);
  }
  // rubble
  const bits = [[-8, 7, 2, 9], [7, 6, -3, 8], [0, 15, 1, 6.5], [-2, 5, -8, 5]];
  return mergeGeometries(bits.map(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.rotateY(i * 1.7); g.rotateX(i * .9);
    return paint(at(g, x, y, z), i % 2 ? 0x666057 : 0x57534a);
  }));
}

// How wide each prop is, so nothing gets planted inside anything else.
export const PROP_SCALE = { grass: 1, flower: 1, hay: 1, bale: 1, column: 1, fallen: 1, arch: 1, rubble: 1 };

/* ---------------------------------------------------------------------------
   THE STAR GATE

   A real archway standing in the land, with the way through it glowing. It gets
   brighter as the shards come home - at nine it is pouring light.
--------------------------------------------------------------------------- */
export function buildGate() {
  const g = new THREE.Group();
  const R = 112, T = 18;

  const stone = lit({ color: 0x8c99bd, roughness: .72, metalness: .08, flatShading: true });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(R, T, 8, 30, Math.PI), stone);
  arch.position.y = 12;
  arch.castShadow = true; arch.receiveShadow = true;
  g.add(arch);

  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(52, 30, 34), stone);
    foot.position.set(side * R, 14, 0);
    foot.castShadow = true; foot.receiveShadow = true;
    g.add(foot);
  }

  // The way through. Two discs: a soft wash and a brighter core.
  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(R - T * .4, 36, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x6d5ab2, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false })
  );
  portal.position.y = 12;
  g.add(portal);

  const light = new THREE.PointLight(0xb9a6ff, 0, 620, 2);
  light.position.set(0, 90, 0);
  g.add(light);

  g.rotation.y = Math.PI / 2;    // the arch stands across the path, not along it
  return { group: g, portal, light, arch };
}

/* ---------------------------------------------------------------------------
   THE LANDMARKS - the one thing in each land you can see from anywhere
--------------------------------------------------------------------------- */
export function buildLandmark(type) {
  const g = new THREE.Group();
  const mat = (c, r) => {
    const m = lit({ color: c, roughness: r === undefined ? .9 : r, flatShading: true });
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float _f = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( _f * 0.5, 0.0, 1.0 ) );
        #endif`);
    };
    m.customProgramCacheKey = () => 'landmark';
    return m;
  };

  if (type === 'pine') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(16, 30, 210, 9), mat(0x3e2d20));
    trunk.position.y = 105;
    g.add(trunk);
    const tiers = [[150, 190, 150], [250, 175, 124], [345, 160, 98], [435, 145, 72], [520, 130, 44]];
    for (const [base, hgt, rad] of tiers) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 9, 1), mat(0x17392b));
      cone.position.y = base + hgt / 2;
      cone.rotation.y = base * .01;
      cone.castShadow = true;
      g.add(cone);
    }
  } else if (type === 'mill') {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(76, 84, 32, 14), mat(0x6f6350));
    plinth.position.y = 16; plinth.castShadow = true; g.add(plinth);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(44, 74, 300, 14), mat(0xa89577, .95));
    tower.position.y = 150; tower.castShadow = true; g.add(tower);
    // The balcony is small, but it is most of what says "windmill" rather than
    // "tower" when all you can see is a shape against the sky.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(54, 6, 6, 18), mat(0x5c5140));
    ring.rotation.x = Math.PI / 2; ring.position.y = 198; g.add(ring);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(58, 80, 14), mat(0x4e4636));
    cap.position.y = 338; cap.castShadow = true; g.add(cap);

    const sails = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      const spar = new THREE.Mesh(new THREE.BoxGeometry(8, 200, 8), mat(0x5c5140));
      spar.position.y = 100; arm.add(spar);
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(32, 156, 4), mat(0xe8dcb8, .8));
      sheet.position.set(22, 108, 0); sheet.castShadow = true; arm.add(sheet);
      arm.rotation.z = i * Math.PI / 2;
      sails.add(arm);
    }
    sails.position.set(0, 322, 68);
    g.add(sails);
    g.userData.spin = sails;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(14, 10, 8), mat(0x4e4636));
    hub.position.set(0, 322, 62); g.add(hub);

    const door = new THREE.Mesh(new THREE.BoxGeometry(34, 92, 12), mat(0x3a3226, 1));
    door.position.set(0, 46, 72); g.add(door);
    for (const [ang, y] of [[.6, 210], [-.8, 262], [2.4, 150]]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(20, 28, 14), mat(0x30291f, 1));
      win.position.set(Math.sin(ang) * 54, y, Math.cos(ang) * 54);
      win.rotation.y = ang; g.add(win);
    }
  } else {
    // the broken tower
    const body = new THREE.Mesh(new THREE.CylinderGeometry(52, 74, 340, 10), mat(0x5e5a51));
    body.position.y = 170; body.castShadow = true; g.add(body);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(54, 52, 60, 10), mat(0x6e6a61));
    const pos = crown.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {             // a torn-off top, not a flat one
      if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) - hash2(i * 13, 5) * 54);
    }
    crown.geometry.computeVertexNormals();
    crown.position.y = 370; crown.castShadow = true; g.add(crown);
    for (const [ang, y] of [[0, 260], [2.1, 170], [4.0, 300]]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(26, 44, 14), mat(0x252a33, 1));
      win.position.set(Math.sin(ang) * 58, y, Math.cos(ang) * 58);
      win.rotation.y = ang;
      g.add(win);
    }
  }
  return g;
}

/* ---------------------------------------------------------------------------
   HIM, LUNA, AND EVERYTHING THAT WALKS ABOUT

   All of them are built the same way: a few solid shapes in a group, with the
   bits that need to move kept on userData so the renderer can find them again.
--------------------------------------------------------------------------- */
/* Him, Luna, the creatures and the monsters. These are the one part of the
   game built out of round things - spheres and many-sided cylinders - and so
   the one part where a hard edge between lit and unlit can actually fall ACROSS
   a surface instead of along the join between two flats. So they are smooth,
   and note the absence of flatShading below - faceting them would throw that
   away, since every facet is one flat tone already and the ramp would have
   nothing left to do. The trees keep theirs: they are merged into one shape
   each and lose their seams on the way, so they could not be smoothed even if
   it helped, and faceted foliage reads perfectly well in a drawing. */
const solid = (c, opts) => lit(Object.assign(
  { color: c, roughness: .85 }, opts || {}));

/* Things that are meant to glow are built BRIGHTER THAN WHITE. Nothing lit by
   the moon can ever reach these values, so the bloom pass picks out exactly the
   things that are supposed to spill light and nothing else. */
const glow = (hex, gain) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(gain) });

export function buildPlayer() {
  const g = new THREE.Group();
  const legs = [], arms = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(7, 20, 8), solid(0x39476b));
    leg.position.set(0, 12, side * 4.5);
    leg.castShadow = true;
    g.add(leg); legs.push(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 9), solid(0x5b3f24));
    boot.position.set(1, -8.5, 0);
    leg.add(boot);
  }

  // The cloak, wider at the hem than the shoulder, with a paler lining showing
  // down one side - that edge is what gives him a shape at a distance.
  const cloak = new THREE.Mesh(new THREE.CylinderGeometry(9, 17, 32, 8), solid(0x6d46b5));
  cloak.position.y = 36; cloak.castShadow = true; g.add(cloak);
  const trim = new THREE.Mesh(new THREE.CylinderGeometry(17.4, 17.4, 4, 8), solid(0x8257d6));
  trim.position.y = 21.5; g.add(trim);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 19, 6), solid(0x6d46b5));
    arm.position.set(0, 42, side * 11);
    arm.castShadow = true;
    g.add(arm); arms.push(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(3.4, 6, 5), solid(0xe9d3b8));
    hand.position.set(0, -11, 0);
    arm.add(hand);
  }

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 10.5, 5, 8), solid(0x8257d6));
  collar.position.y = 51; g.add(collar);

  const hood = new THREE.Mesh(new THREE.SphereGeometry(11, 10, 8), solid(0x3b2a46));
  hood.position.y = 58; hood.castShadow = true; g.add(hood);
  // The peak of the hood, thrown back over his shoulders.
  const peak = new THREE.Mesh(new THREE.ConeGeometry(7.5, 17, 7), solid(0x3b2a46));
  peak.position.set(-9, 57, 0); peak.rotation.z = -1.15; g.add(peak);

  const face = new THREE.Mesh(new THREE.SphereGeometry(6.6, 8, 6), solid(0xe9d3b8));
  face.position.set(7, 56, 0); g.add(face);

  g.userData = { legs, arms, cloak };
  return inkGroup(g);
}

export function buildLuna() {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(14, 40, 8), solid(0x352641));
  robe.position.y = 20; robe.castShadow = true; g.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), solid(0xd9a1d5));
  head.position.y = 47; head.castShadow = true; g.add(head);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 52, 5), solid(0x8f7ac4));
  staff.position.set(0, 26, 11); g.add(staff);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), glow(0xffe9a8, 2.6));
  orb.position.set(0, 54, 11); g.add(orb);
  const light = new THREE.PointLight(0xf5d76e, 0, 300, 2);
  light.position.set(0, 54, 11); g.add(light);
  g.userData = { orb, light };
  return inkGroup(g);
}

const CREATURE_COLOUR = {
  forest: 0x75a85c, magic: 0xa87ed6, water: 0x6faed0,
  spark: 0xe8b45c, stone: 0x9aa1ad
};

export function buildCreature(kind) {
  const col = CREATURE_COLOUR[kind] || 0xd7b65e;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), solid(col));
  body.scale.set(1, .9, 1); body.position.y = 9; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(13, 10, 8), solid(col));
  head.position.y = 25; head.castShadow = true; g.add(head);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(5, 20, 5), solid(col));
    ear.position.set(-2, 38, side * 9);
    ear.rotation.x = side * -.35;
    g.add(ear);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.7, 6, 5), solid(0x16202f, { roughness: .3 }));
    eye.position.set(10, 27, side * 5);
    g.add(eye);
  }
  const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), glow(0xffffff, 2.2));
  spark.position.y = 52;
  g.add(spark);
  g.userData = { spark };
  return inkGroup(g);
}

export function buildMonster(boss) {
  const g = new THREE.Group();
  const dark = boss ? 0x3b3560 : 0x6a3f58, light = boss ? 0x4d4680 : 0x7e4b67;
  const body = new THREE.Mesh(new THREE.SphereGeometry(17, 10, 8), solid(dark));
  body.scale.set(1, .85, 1); body.position.y = 15; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(19, 10, 8), solid(light));
  head.position.y = 34; head.castShadow = true; g.add(head);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(6, 24, 5), solid(light));
    horn.position.set(-3, 50, side * 13);
    horn.rotation.x = side * -.3;
    g.add(horn);
  }
  const eyes = [];
  if (boss) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), glow(0xf5d76e, 2.4));
    eye.position.set(15, 36, 0); g.add(eye); eyes.push(eye);
    const ring = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const sh = new THREE.Mesh(new THREE.OctahedronGeometry(4.5), glow(0xc8b4ff, 2.2));
      sh.position.set(Math.cos(i * 1.256) * 34, 0, Math.sin(i * 1.256) * 34);
      ring.add(sh);
    }
    ring.position.y = 36; g.add(ring);
    g.userData.ring = ring;
  } else {
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(3.6, 8, 6), glow(0xf1d36a, 2.0));
      eye.position.set(16, 36, side * 6.5);
      g.add(eye); eyes.push(eye);
    }
  }
  g.userData.eyes = eyes;
  if (boss) g.scale.setScalar(1.7);
  return inkGroup(g);
}

export function buildCritter(kind) {
  const g = new THREE.Group();
  const vmat = lit({ vertexColors: true, roughness: .85, flatShading: true });
  if (kind === 'bat') {
    g.add(new THREE.Mesh(paint(at(new THREE.SphereGeometry(4.5, 6, 5), 0, 13, 0), 0x4a3f5c), vmat));
    const wings = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(paint(new THREE.BoxGeometry(9, 1.2, 12), 0x4a3f5c), vmat);
      w.position.set(0, 13, side * 8);
      g.add(w); wings.push(w);
    }
    g.userData = { wings };
    return inkGroup(g);
  }
  const col = kind === 'frog' ? 0x5f9c52 : 0xb5a48c;
  const body = new THREE.SphereGeometry(7, 7, 6);
  body.scale(1, .8, .9); body.translate(0, 6, 0);
  const parts = [paint(body, col), paint(at(new THREE.SphereGeometry(4.6, 7, 6), 4.5, 11, 0), col)];
  if (kind === 'rabbit') {
    for (const side of [-1, 1]) parts.push(paint(at(new THREE.BoxGeometry(2, 11, 3.4), 3, 18, side * 2.6), col));
  }
  parts.push(paint(at(new THREE.SphereGeometry(1.3, 5, 4), 7.5, 12, 2), 0x1d2430));
  g.add(new THREE.Mesh(mergeGeometries(parts), vmat));
  return inkGroup(g);
}

/* ---------------------------------------------------------------------------
   THE SMALL FINDS

   Shards, star seeds, campfires, standing stones, boots and berry bushes. The
   glowing ones are deliberately over-bright: the bloom pass picks anything
   brighter than daylight and blooms it, which is what makes them carry at night.
--------------------------------------------------------------------------- */
export function buildShard() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(11),
    lit({
      color: 0xf5d76e, emissive: 0xf7df78, emissiveIntensity: 2.1,
      roughness: .25, metalness: .3, flatShading: true
    })
  );
  g.add(core);
  g.userData = { core };
  return g;
}

export function buildSeed() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(7, 0),
    lit({ color: 0xcdf7d6, emissive: 0x9ff5b6, emissiveIntensity: 2.0, roughness: .3 })
  );
  core.scale.set(.7, 1.5, .7);
  g.add(core);
  g.userData = { core };
  return g;
}

export function buildFire() {
  const g = new THREE.Group();
  const logMat = solid(0x5a4128);
  for (const a of [0.6, -0.7]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 30, 6), logMat);
    log.rotation.set(0, a, Math.PI / 2 + .12);
    log.position.y = 4;
    log.castShadow = true;
    g.add(log);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(9, 30, 7),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(2.4), transparent: true, opacity: .92 })
  );
  flame.position.y = 20;
  g.add(flame);
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(4.4, 18, 6),
    glow(0xffe9a8, 3.0)
  );
  core.position.y = 15;
  g.add(core);
  g.userData = { flame, core };
  return g;
}

export function buildStone() {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(30, 78, 15), solid(0x6a6f7a));
  slab.position.y = 39;
  slab.rotation.z = .04;
  slab.castShadow = true; slab.receiveShadow = true;
  g.add(slab);
  // The carving, lit faintly from inside so it can be read at night.
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 30),
    new THREE.MeshBasicMaterial({ color: 0xb4cdff, transparent: true, opacity: .7, map: carvingTexture() })
  );
  mark.position.set(0, 46, 8.2);
  g.add(mark);
  return g;
}

let carveTex = null;
function carvingTexture() {
  if (carveTex) return carveTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 112;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 7; x.lineCap = 'round';
  x.beginPath();
  x.moveTo(18, 34); x.lineTo(46, 34);
  x.moveTo(32, 20); x.lineTo(32, 56);
  x.moveTo(20, 74); x.lineTo(44, 74);
  x.moveTo(20, 92); x.lineTo(44, 92);
  x.stroke();
  carveTex = new THREE.CanvasTexture(c);
  return carveTex;
}

export function buildBoots() {
  const g = new THREE.Group();
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(17, 19, 8, 8), solid(0x5f6672));
  stone.position.y = 4; stone.receiveShadow = true; g.add(stone);
  for (const side of [-1, 1]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(9, 17, 8), solid(0x8a5a33));
    boot.position.set(0, 17, side * 6);
    boot.castShadow = true;
    g.add(boot);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 9), solid(0x6d4526));
    toe.position.set(2.5, -6, 0);
    boot.add(toe);
  }
  const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), glow(0xf5d76e, 2.2));
  spark.position.y = 34;
  g.add(spark);
  g.userData = { spark };
  return g;
}

export function buildBerryBush() {
  // Three leafy lumps and five berries. Merged into two shapes rather than
  // nine, because a land has eight of these bushes in it and every separate
  // shape is another thing for the phone to draw.
  const g = new THREE.Group();
  const bush = new THREE.Mesh(mergeGeometries(
    [[-7, 11, 2, 11], [8, 10, -3, 10], [0, 19, 1, 10]].map(([x, y, z, r]) =>
      at(new THREE.IcosahedronGeometry(r, 0), x, y, z))), solid(0x2b5238));
  bush.castShadow = true;
  g.add(bush);
  const fruit = new THREE.Mesh(mergeGeometries(
    [[-9, 17, 7], [3, 22, 5], [9, 13, 6], [-3, 9, 8], [12, 20, -2]].map(([x, y, z]) =>
      at(new THREE.SphereGeometry(2.9, 6, 5), x, y, z))), solid(0xc65a86, { roughness: .5 }));
  g.add(fruit);
  g.userData = { fruit };
  return g;
}
