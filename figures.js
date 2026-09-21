/* ---------------------------------------------------------------------------
   EVERYTHING THAT WALKS, AND HOW IT IS PUT TOGETHER

   The world (world3d.js) is built out of whole shapes - a tree is a trunk and
   four cones, and it never moves, so it can be merged down to one lump and
   forgotten about. A figure cannot. It has to bend, and the places it bends are
   the places a drawing has to be most careful about.

   The old figures had no such places. A leg was one box from hip to floor, so
   there was no knee to bend and nothing to draw; an arm was a box with a ball
   on the end of it. That reads as a toy, and no amount of smoothing or extra
   polygons changes it, because what is missing is not resolution - it is
   JOINTS.

   So the figures here are built from a small kit, in this order:

     a RIG      - a tree of named, empty pivots. Shoulder, elbow, wrist; hip,
                  knee, ankle. The rig is data, so a four-legged thing is a
                  different table rather than different code.

     BONES      - tapered geometry hung from a pivot, with a sphere sitting AT
                  the pivot. The sphere is the whole trick: without it a bent
                  limb shows a wedge of daylight at the joint and reads as two
                  sticks. With it, the limb is continuous at any angle.

     GARMENTS   - profiles turned about the figure's axis. A cloak is an
                  outline you could draw on paper - it flares on a curve, it
                  has a thickness, and it has a hem you can see the edge of.
                  A truncated cone has none of those things.

     a SHEET    - a plain object saying how tall, how heavy, what colour, what
                  it is wearing. Two figures that differ only in their sheet
                  cost one table row, not one function.

   AXES. A figure is built facing +x, with y up and z across - the same as the
   rest of the scene once world3d's game-to-three swap has been done. So a limb
   swinging forwards and backwards turns about z, which is what the walk in
   render3d.js has always poked at.

   WHY SO FEW MESHES. Every mesh is drawn twice, once for itself and once for
   the ink line round it. So parts that never move relative to each other are
   painted with their colour baked into their corners and merged down to one
   mesh - the whole torso, head, hood and tunic are ONE. That is fewer draws
   than the old figure managed with half the detail, and it means the ink line
   goes round the outside of the whole torso rather than round each piece of it.
--------------------------------------------------------------------------- */
import * as THREE from './vendor/three.module.min.js';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { lit, inkGroup, paint, at } from './world3d.js';

/* Figures are smooth, not faceted. The light ramp puts a hard edge between lit
   and unlit; on a faceted surface that edge can only ever fall along a facet
   join, which is a straight line, and straight lines are what make a thing look
   built rather than drawn. On a smooth surface it falls wherever the form
   turns away, which is a curve. That curve is most of the look. */
const figureMat = () => lit({ vertexColors: true, roughness: .85 });

// Things meant to glow are built brighter than white so the bloom pass finds
// them and nothing lit by the moon can reach them by accident.
const glow = (hex, gain) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(gain) });

/* ---------------------------------------------------------------------------
   THE RIG

   A table of [name, parent, x, y, z]. Each row becomes an empty Group sitting
   at that offset inside its parent, and the whole lot comes back keyed by name
   so a builder can hang geometry off `j.elbowL` and the walk can turn it.

   Nothing here draws anything. The rig is the skeleton on its own, and a figure
   with no geometry at all is still a valid rig - which is what makes it worth
   posing one before deciding what it looks like.
--------------------------------------------------------------------------- */
export function makeRig(rows) {
  const root = new THREE.Group();
  const j = { root };
  for (const [name, parent, x, y, z] of rows) {
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    (j[parent] || root).add(g);
    j[name] = g;
  }
  return j;
}

/* The rig every two-legged figure in the game uses. Everything is in units
   where the figure is about seventy tall, and a sheet scales the whole thing
   afterwards rather than each row being rewritten.

   Read it as a body: the hips carry the spine up through the chest to the neck
   and head, and carry the legs down. The arms hang off the chest, not the neck,
   which is the mistake that makes a figure look hunched. */
export const HIPS = 34;          // how high off the floor the hips ride

/* How long each length of limb is. The rig below spaces its pivots by these,
   and the builders make their bones these long - from the one place, because
   when the two disagree the bone either stops short of the next joint or runs
   past it, and the joint ball that is supposed to be hiding the gap is left
   sitting in the middle of nothing. Luna had exactly that: bones of 14 and 12
   on a rig spaced 13 and 11. */
export const LIMB = { upper: 13, fore: 11, thigh: 18, shin: 12 };

export const BIPED = [
  ['hips', 'root', 0, HIPS, 0],
  ['spine', 'hips', 0, 8, 0],
  ['chest', 'spine', 0, 9, 0],
  ['neck', 'chest', 0, 7, 0],
  ['head', 'neck', 0, 4, 0],

  ['shoulderL', 'chest', 0, 1, -7.4],
  ['elbowL', 'shoulderL', 0, -LIMB.upper, 0],
  ['wristL', 'elbowL', 0, -LIMB.fore, 0],
  ['shoulderR', 'chest', 0, 1, 7.4],
  ['elbowR', 'shoulderR', 0, -LIMB.upper, 0],
  ['wristR', 'elbowR', 0, -LIMB.fore, 0],

  /* The ankle sits four off the floor rather than one. A foot needs somewhere
     to BE: at one, the sole was pushed below the ground and he waded. */
  ['hipL', 'hips', 0, 0, -4.4],
  ['kneeL', 'hipL', 0, -LIMB.thigh, 0],
  ['ankleL', 'kneeL', 0, -LIMB.shin, 0],
  ['hipR', 'hips', 0, 0, 4.4],
  ['kneeR', 'hipR', 0, -LIMB.thigh, 0],
  ['ankleR', 'kneeR', 0, -LIMB.shin, 0]
];

/* ---------------------------------------------------------------------------
   BONES

   `bone` makes the geometry for one length of limb: a tapered tube hanging
   DOWN from the pivot it is attached to, with a ball at the top sitting exactly
   on the pivot.

   The ball is not decoration. A tube pinned at its top corner and rotated
   swings away from whatever is above it and opens a gap; a ball centred on the
   pivot fills that gap at every angle, because a sphere turned about its own
   centre is the same sphere. That is why a knee works.

   It is deliberately a little wider than the tube it caps, so the joint reads
   as a joint - a knee and an elbow are thicker than what runs into them.
--------------------------------------------------------------------------- */
export function bone(len, rTop, rBot, colour, opts) {
  const o = opts || {};
  const parts = [];
  const shaft = new THREE.CylinderGeometry(rTop, rBot, len, o.seg || 12, 1, true);
  shaft.translate(0, -len / 2, 0);
  parts.push(paint(shaft, colour));
  if (o.cap !== false) {
    const ball = new THREE.SphereGeometry(rTop * (o.capScale || 1.06), o.seg || 12, 9);
    parts.push(paint(ball, o.capColour === undefined ? colour : o.capColour));
  }
  // The far end is closed off too, so the limb is a solid rather than a pipe -
  // an open pipe turns inside out along the ink line and shows its own inside.
  if (o.foot !== false) {
    const end = new THREE.SphereGeometry(rBot, o.seg || 12, 9);
    parts.push(paint(at(end, 0, -len, 0), o.endColour === undefined ? colour : o.endColour));
  }
  return mergeGeometries(parts);
}

/* ---------------------------------------------------------------------------
   PROFILES AND GARMENTS

   A garment is an outline turned about the figure's axis. The outline is given
   as a handful of [radius, height] points and smoothed through, so the shape
   is a curve rather than a straight taper - the difference between a cloak that
   falls and a traffic cone.

   The outline is CLOSED: it runs down the inside, across the hem, and back up
   the outside. That gives the cloth a thickness and therefore a hem edge, which
   is the thing you actually see from the side, and it keeps the shape a solid
   so the ink line has something sensible to wrap.
--------------------------------------------------------------------------- */
export function turned(pts, colour, seg, deform) {
  /* Centripetal, not the default. A smooth curve drawn through points that
     turn sharply - and a hem turns through a full half-circle in about two
     points - will swing WIDE of them on the way round if it is parameterised
     evenly, and the shape balloons out where it should be tightest. A boot
     came out as a barrel that way, and a hood as a slab. Centripetal
     parameterisation is the one that provably cannot overshoot. */
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([r, y]) => new THREE.Vector3(r, y, 0)), true, 'centripetal');
  const fine = curve.getPoints(Math.max(24, pts.length * 4))
    .map(p => new THREE.Vector2(Math.max(.02, p.x), p.y));
  fine.push(fine[0].clone());               // lathe does not close the loop itself
  const geo = new THREE.LatheGeometry(fine, seg || 20);
  /* Any pushing about of the shape has to happen HERE, while the lathe still
     has its index. paint() drops the index so the part can be merged with its
     neighbours, and recomputing normals after that gives one normal per face
     rather than one per corner - which facets the very surface the lathe was
     used to keep smooth. */
  if (deform) { deform(geo); geo.computeVertexNormals(); }
  return paint(geo, colour);
}

/* A cloak hangs level all the way round only if nobody is inside it. This lifts
   the hem at the front - where the figure's legs are - so it parts as he walks,
   which is most of what says "cloth" rather than "bell".

   `front` is how far up the hem at +x rises; the lift falls away to nothing at
   the back. Only the low corners move, so the shoulders keep their shape. */
const drape = (lift, below, hug, hugFrom) => geo => {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z) || 1;
    const facing = Math.max(0, x / r);                   // 1 dead ahead, 0 at the sides
    /* Pulled in at the front, so the tunic underneath shows and the cloak
       gathers behind him instead of enclosing him like a barrel. Only below
       the shoulders: taken all the way up it closed round his throat and the
       cloak read as a scarf. */
    if (hug && x > 0) {
      const t = Math.min(1, Math.max(0, (hugFrom - y) / 12));
      pos.setX(i, x * (1 - hug * facing * t));
    }
    // and lifted at the front near the hem, so his legs come through it
    if (y <= below) {
      const depth = Math.min(1, (below - y) / 11);
      pos.setY(i, y + facing * facing * depth * lift);
    }
  }
};

/* ---------------------------------------------------------------------------
   HANDS AND FEET

   Both were balls before. Both are the end of a limb and therefore the thing a
   silhouette ends on, so both are worth more than a ball.

   A hand is a flattened palm with a wedge of fingers and a thumb set across
   them. At this size nobody counts fingers - what reads is that the shape is
   FLAT and has a thumb, so it is a hand and not a mitten.
--------------------------------------------------------------------------- */
export function handGeometry(skin, side) {
  const palm = new THREE.SphereGeometry(2.9, 10, 8);
  palm.scale(1, 1.15, .58);
  palm.translate(0, -2.2, 0);

  const fingers = new THREE.CylinderGeometry(2.5, 1.9, 4.4, 8, 1);
  fingers.scale(1, 1, .5);
  fingers.translate(0, -6.4, 0);
  const tip = new THREE.SphereGeometry(1.9, 8, 6);
  tip.scale(1, .9, .5);
  tip.translate(0, -8.5, 0);

  const thumb = new THREE.CylinderGeometry(1.1, .8, 3.4, 6, 1);
  thumb.translate(0, -1.7, 0);
  thumb.rotateX(side * .5);
  thumb.rotateZ(side * -.9);
  thumb.translate(0, -2.6, side * 1.4);

  return mergeGeometries([palm, fingers, tip, thumb].map(g => paint(g, skin)));
}

/* ---------------------------------------------------------------------------
   A HEAD

   A skull, hair over the back of it, and two eyes.

   The hair is a second, slightly bigger skull with its FRONT FLATTENED OFF
   against a sloping plane. Pinching the front vertices inwards - the obvious
   thing, and what was tried first - leaves the two spheres almost touching
   over a wide band, and the skull surfaces through it in ragged patches: the
   first attempt gave him a grey slab where his face should be. Flattening
   against a plane instead leaves a clean edge, and the flat disc it creates
   sits well inside the skull where it is never seen.

   The plane leans back as it rises (`cutSlope`), which is the difference
   between a hairline and a fringe cut with a ruler.
--------------------------------------------------------------------------- */
export function headGeometry(o) {
  const r = o.r || 5.45, y = o.y || 0, out = [];

  const skull = new THREE.SphereGeometry(r, 18, 14);
  skull.scale(1.04, 1.1, .96);
  out.push(at(paint(skull, o.skin), 0, y, 0));

  if (o.hair !== undefined) {
    const hair = new THREE.SphereGeometry(r * 1.027, 20, 15);
    hair.scale(1.10, 1.14, 1.04);
    const base = o.cut === undefined ? 1.1 : o.cut;
    const slope = o.cutSlope === undefined ? .34 : o.cutSlope;
    const pos = hair.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const cut = base + Math.max(0, pos.getY(i)) * slope;
      if (pos.getX(i) > cut) pos.setX(i, cut);
      // hair that falls past the shoulders, if this one has any
      if (o.fall && pos.getX(i) < 0 && pos.getY(i) < 0) pos.setY(i, pos.getY(i) * o.fall);
    }
    hair.computeVertexNormals();
    out.push(at(paint(hair, o.hair), -.35, y + .3, 0));
  }

  // Two eyes. A blank head reads as a mannequin however well the rest of the
  // figure is drawn, and they cost four hundred triangles between them.
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(r * .174, 8, 6);
    eye.scale(.7, 1, 1);
    out.push(at(paint(eye, o.eye === undefined ? 0x2a2233 : o.eye),
      r * .86, y + .4, side * r * .40));
  }
  return out;
}

/* A foot is longer than it is wide and it points forwards - which the old box
   did too, but a box has four hard vertical corners and a foot has none. */
/* `drop` is how far the ankle is off the floor, so the sole lands ON it rather
   than under it - the foot is built downwards from the joint and then pushed
   back up by exactly that much. */
export function footGeometry(colour, len, drop) {
  const L = len || 11, d = drop === undefined ? 4 : drop;
  const shoe = new THREE.SphereGeometry(3.4, 14, 10);
  shoe.scale(L / 6.8, .60, .76);
  shoe.translate(L / 2 - 3.6, -d + 2.05, 0);
  const heel = new THREE.SphereGeometry(3.0, 12, 9);
  heel.scale(1, .68, .80);
  heel.translate(-1.5, -d + 2.05, 0);
  return mergeGeometries([shoe, heel].map(g => paint(g, colour)));
}

/* ---------------------------------------------------------------------------
   PUTTING ONE TOGETHER

   `attach` hangs geometry on a pivot. Everything handed to it in one call is
   merged into a single mesh, because anything sharing a pivot moves together
   by definition and so never needs to be told apart again.
--------------------------------------------------------------------------- */
export function attach(joint, geos, mat, shadow) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const mesh = new THREE.Mesh(list.length === 1 ? list[0] : mergeGeometries(list), mat);
  mesh.castShadow = shadow !== false;
  joint.add(mesh);
  return mesh;
}

/* ---------------------------------------------------------------------------
   HIM

   Seventy units tall with a head about a seventh of that, which is roughly
   where a person is and a long way from where he was - he used to be a third
   head by height, which is why he read as a doll.

   He is dressed rather than coloured: trousers, boots that come up the shin,
   a tunic to mid-thigh, a belt, a cloak over the top with the hood thrown back,
   and bracers on his forearms. Seven things, so there is somewhere for the eye
   to stop, and each of them is a different tone so the silhouette breaks up
   instead of reading as one purple mass.
--------------------------------------------------------------------------- */
const HIM = {
  skin: 0xe9d3b8,
  hair: 0x3a2b22,
  cloth: 0x6d46b5,     // the cloak
  trim: 0x8f63e2,      // its lining and collar, a shade up
  tunic: 0x4b5f96,
  belt: 0x5b3f24,
  trouser: 0x39476b,
  boot: 0x5b3f24,
  bootTrim: 0x74502e
};

export function buildPlayer() {
  const j = makeRig(BIPED);
  const mat = figureMat();
  const C = HIM;

  /* THE LEGS. Thigh, then shin, then a boot and a foot on the ankle. The knee
     ball is the trouser colour and a touch wider than the thigh, so when the
     leg bends there is a knee there rather than a crease. */
  for (const s of ['L', 'R']) {
    // The hip ball is kept small and plain: it lives under the tunic, and the
    // only thing it has to do there is fill the gap when the leg swings.
    attach(j['hip' + s], [bone(LIMB.thigh, 5.0, 4.0, C.trouser, { capScale: .98 })], mat);
    attach(j['knee' + s], [
      bone(LIMB.shin, 4.2, 3.2, C.trouser, { foot: false }),
      // the boot: a cuff round the bottom of the shin, wider than the leg in it
      turned([[0, -12.2], [4.7, -12.2], [4.9, -9.5], [4.2, -6.8], [3.5, -6.6],
              [3.7, -9.5], [3.4, -11.8], [0, -11.9]], C.boot, 14),
      turned([[0, -7.4], [5.1, -7.2], [5.2, -5.9], [0, -5.7]], C.bootTrim, 14)
    ], mat);
    attach(j['ankle' + s], [footGeometry(C.boot, 11.5, 4)], mat);
  }

  /* THE ARMS. Sleeve, bracer, hand. The sleeve is cloak-coloured so the arm
     reads as part of the garment until the bracer, where it becomes an arm. */
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? -1 : 1;
    /* The shoulder ball was as big across as his head, which put a purple
       boulder where his neck should be and made him look hunched. It only has
       to cover the top of the arm, so it is barely wider than the arm. */
    attach(j['shoulder' + s], [
      bone(LIMB.upper, 4.1, 3.2, C.cloth, { capScale: 1.0, foot: false })
    ], mat);
    /* The forearm is a SLEEVE, not a bare arm. Built bare, it came out as a
       long pale plank swinging in front of a dark figure and took the eye
       straight off his face. Only the hand is skin now, and the bracer is a
       cuff at the wrist rather than a band round the middle of nothing. */
    attach(j['elbow' + s], [
      bone(LIMB.fore, 3.1, 2.4, C.tunic, { foot: false }),
      turned([[0, -10.4], [3.1, -10.3], [3.3, -6.6], [0, -6.5]], C.belt, 12)
    ], mat);
    attach(j['wrist' + s], [handGeometry(C.skin, side)], mat);
  }

  /* THE BODY. Tunic, belt, collar, neck, head, hair and the thrown-back hood,
     all merged into ONE mesh - none of them moves against any of the others,
     so there is nothing to gain by keeping them apart and a draw call to lose
     for each one kept. The ink line then goes round the whole torso instead of
     round each piece of it, which is the seam problem gone at the source. */
  /* Everything below is given in HEIGHTS OFF THE FLOOR, because that is how a
     body is actually measured and how the drawing was worked out - and then
     dropped by HIPS in one go at the end, since it all hangs on the hips.
     Writing the offsets in already is how the first attempt ended up with the
     hem of his tunic round his shins. */
  const torso = [];

  // the tunic: close at the chest, flaring past the belt to mid-thigh
  torso.push(turned([
    [0, 24], [7.4, 24], [8.4, 25.4], [7.6, 31], [6.5, 36],      // hem, then up the outside
    [6.8, 42], [8.0, 47], [7.8, 51.4], [7.0, 52.2],             // chest
    [6.3, 51.4], [6.1, 46], [5.4, 40], [5.8, 32], [6.6, 26], [0, 25.2]
  ], C.tunic, 22));

  // the belt
  torso.push(turned([[0, 33.2], [7.1, 33.2], [7.4, 36.8], [0, 36.8]], C.belt, 20));

  // the neck, and the collar the cloak fastens to
  torso.push(at(bone(7, 2.8, 3.1, C.skin, { cap: false, foot: false }), 0, 64, 0));
  torso.push(turned([
    [0, 51.6], [7.2, 51.8], [7.8, 55.2], [6.0, 55.8], [5.4, 53.4], [5.2, 52], [0, 51.8]
  ], C.trim, 20));

  torso.push(...headGeometry({ y: 65, skin: C.skin, hair: C.hair }));

  // the hood, thrown back off the head and lying between his shoulders
  const hood = turned([
    [0, 0], [5.8, .4], [6.4, 3.4], [5.4, 7.6], [3.4, 10.6], [1.0, 11.2],
    [.7, 10.0], [2.6, 8.0], [3.9, 4.6], [3.7, 1.4], [0, 1.2]
  ], C.trim, 18);
  hood.rotateZ(-1.15);
  torso.push(at(hood, -6.0, 56.4, 0));

  attach(j.hips, torso.map(g => at(g, 0, -HIPS, 0)), mat);

  /* THE CLOAK is the one part of the body kept separate, because it swings.
     It hangs from the collar, and its hem is lifted at the front so his legs
     come through it rather than the whole thing moving as a bell. */
  const CHEST = HIPS + 8 + 9;               // where the rig actually puts it
  /* A RING, not a disc. The profile never reaches the axis: a cloak has a hole
     in it for a head to go through, and a lathe whose outline touches r=0
     pinches every segment into one point there. That point is a knot of
     near-degenerate triangles, and the ink shell blows it up into a dark spike
     - which is what was sitting on his chest. */
  const cloakGeo = at(turned([
    [5.4, 54.6], [5.8, 50], [7.0, 42], [9.2, 33], [10.6, 27.4],   // down the inside
    [11.5, 26.2],                                                 // round the hem edge
    [12.1, 27.6], [10.5, 33], [8.2, 42], [7.0, 50], [6.7, 54.8],  // up the outside
    [6.0, 55.3]                                                   // over the top, back to the start
  ], C.cloth, 26, drape(6, 36, .32, 48)), -1.0, -CHEST, 0);
  const cloak = new THREE.Mesh(cloakGeo, mat);
  cloak.castShadow = true;
  j.chest.add(cloak);

  j.root.userData = {
    rig: j,
    legs: [j.hipL, j.hipR],
    arms: [j.shoulderL, j.shoulderR],
    knees: [j.kneeL, j.kneeR],
    elbows: [j.elbowL, j.elbowR],
    ankles: [j.ankleL, j.ankleR],
    cloak,
    height: 70
  };
  return inkGroup(j.root);
}

/* ---------------------------------------------------------------------------
   LUNA

   Built on the same rig, but robed to the floor - so her legs exist and carry
   her, and simply never show. That costs nothing and means she can be given a
   walk later without being rebuilt.
--------------------------------------------------------------------------- */
const HER = {
  skin: 0xd9a1d5, hair: 0x2e2340, robe: 0x352641, trim: 0x6b4f8f, staff: 0x8f7ac4
};

export function buildLuna() {
  const j = makeRig(BIPED);
  const mat = figureMat();
  const C = HER;

  const body = [];
  // the robe, from the floor to the shoulders in one unbroken sweep
  body.push(turned([
    [0, 0], [13.6, 0], [14.6, 1.6], [12.4, 12], [9.4, 26], [7.6, 38], [7.6, 46], [7.0, 51.2],
    [5.8, 52], [5.6, 46], [5.8, 38], [6.4, 26], [8.4, 12], [10.0, 2], [0, 1.4]
  ], C.robe, 24));
  body.push(turned([[0, 50.2], [6.9, 50.4], [7.6, 54.4], [5.8, 55], [5.2, 52], [0, 50.6]], C.trim, 20));
  body.push(at(bone(7, 2.6, 2.9, C.skin, { cap: false, foot: false }), 0, 64, 0));
  // Her hair falls past her shoulders, which is the one thing her head does
  // that his does not.
  body.push(...headGeometry({ y: 65, r: 5.3, skin: C.skin, hair: C.hair, fall: 2.4 }));

  attach(j.hips, body.map(g => at(g, 0, -HIPS, 0)), mat);

  // arms held in at her sides, inside the robe's sleeves
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? -1 : 1;
    attach(j['shoulder' + s], [bone(LIMB.upper, 3.9, 3.0, C.robe, { capScale: 1.0, foot: false })], mat);
    attach(j['elbow' + s], [bone(LIMB.fore, 2.9, 2.3, C.robe, { foot: false })], mat);
    attach(j['wrist' + s], [handGeometry(C.skin, side)], mat);
    j['shoulder' + s].rotation.x = side * .1;
  }

  /* The staff stands in front of her and slightly to one side, so it reads
     against the sky rather than against her own robe - behind her it was a
     dark stick on a dark shape and simply vanished. */
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.4, 62, 8),
    lit({ color: C.staff, roughness: .8 })
  );
  staff.position.set(5.5, 31, 11.5);
  staff.rotation.x = -.05;
  staff.rotation.z = -.07;
  j.root.add(staff);

  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), glow(0xffe9a8, 2.6));
  orb.position.set(4.8, 64, 11.5);
  j.root.add(orb);
  const light = new THREE.PointLight(0xf5d76e, 0, 300, 2);
  light.position.copy(orb.position);
  j.root.add(light);

  j.root.userData = { rig: j, orb, light, height: 70 };
  return inkGroup(j.root);
}

/* ---------------------------------------------------------------------------
   THE REST, FOR NOW

   The creatures, the monsters and the critters are still the shapes they were.
   They are next, and the sheet system above is what they will be built on -
   but the player had to prove the kit first, and the turntable is how that gets
   looked at. Their builders are moved here unchanged so that everything that
   walks lives in one file.
--------------------------------------------------------------------------- */
const CREATURE_COLOUR = {
  forest: 0x75a85c, magic: 0xa87ed6, water: 0x6faed0,
  spark: 0xe8b45c, stone: 0x9aa1ad
};
const solid = (c, opts) => lit(Object.assign({ color: c, roughness: .85 }, opts || {}));

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
  g.userData = { spark, height: 54 };
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
  g.userData.height = 60;
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
    g.userData = { wings, height: 18 };
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
  g.userData = { height: 22 };
  return inkGroup(g);
}

/* ---------------------------------------------------------------------------
   WHAT THE TURNTABLE SHOWS

   One list, so the viewer does not have to know how any of them is made. Kept
   here rather than in the page, because when a figure is added it should turn
   up in the viewer without anybody having to remember a second place.
--------------------------------------------------------------------------- */
export const FIGURES = [
  { id: 'player', name: 'The Wanderer', note: 'rebuilt on the kit', make: () => buildPlayer() },
  { id: 'luna', name: 'Luna', note: 'rebuilt on the kit', make: () => buildLuna() },
  { id: 'mossling', name: 'Mossling', note: 'not yet rebuilt', make: () => buildCreature('forest') },
  { id: 'brookfin', name: 'Brookfin', note: 'not yet rebuilt', make: () => buildCreature('water') },
  { id: 'sunmoth', name: 'Sunmoth', note: 'not yet rebuilt', make: () => buildCreature('sky') },
  { id: 'larkspark', name: 'Larkspark', note: 'not yet rebuilt', make: () => buildCreature('spark') },
  { id: 'stonepup', name: 'Stonepup', note: 'not yet rebuilt', make: () => buildCreature('stone') },
  { id: 'glimmercat', name: 'Glimmercat', note: 'not yet rebuilt', make: () => buildCreature('magic') },
  { id: 'monster', name: 'Monster', note: 'not yet rebuilt', make: () => buildMonster(false) },
  { id: 'guardian', name: 'Gate Guardian', note: 'not yet rebuilt', make: () => buildMonster(true) },
  { id: 'frog', name: 'Frog', note: 'not yet rebuilt', make: () => buildCritter('frog') },
  { id: 'rabbit', name: 'Rabbit', note: 'not yet rebuilt', make: () => buildCritter('rabbit') },
  { id: 'bat', name: 'Bat', note: 'not yet rebuilt', make: () => buildCritter('bat') }
];
