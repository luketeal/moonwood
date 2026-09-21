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

/* ---------------------------------------------------------------------------
   A SPINDLE

   The other half of `turned`, and the one bodies are made of. `turned` takes a
   CLOSED outline and gives back a tube with a wall - right for a cloak, which
   has a hole in it for a head. A body has no hole: its outline runs from a
   point at one end, out to its widest, and back to a point at the other.

   So this takes an OPEN profile and closes it against the axis at both ends.
   The two ends become proper poles, exactly as they are on a sphere, and the
   ink line handles them the same way it handles a sphere. (What it must not do
   is touch the axis in the middle of a CLOSED loop - that leaves a sliver of
   near-nothing which the ink shell blows up into a spike.)
--------------------------------------------------------------------------- */
export function spindle(pts, colour, seg, deform) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  const fine = curve.getPoints(Math.max(20, pts.length * 5))
    .map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
  const geo = new THREE.LatheGeometry(fine, seg || 18);
  if (deform) { deform(geo); geo.computeVertexNormals(); }
  return paint(geo, colour);
}

/* Lay a spindle down along the way the figure faces, so its profile reads as
   nose-to-tail rather than head-to-toe. A body is the same kind of shape as a
   head or a tail - round in section, varying in girth along its length - so
   all three are made this way. */
export function alongX(geo) { geo.rotateZ(-Math.PI / 2); return geo; }

/* ...and the same the other way, for a tail, which grows backwards out of the
   end the head is not at. Turning `droop` up now lowers it, which is what the
   word means. */
export function alongNegX(geo) { geo.rotateZ(Math.PI / 2); return geo; }

/* ---------------------------------------------------------------------------
   A PANEL

   A wing is not a shape you can turn on a lathe. It is an OUTLINE - a curve
   you could draw round with a pencil - with almost no thickness, and what
   makes an owl's wing an owl's rather than a bat's is entirely that curve.

   So: the outline is drawn as a list of points, smoothed, and given just
   enough depth to be a solid. The edge is rounded rather than cut square,
   which matters more than it sounds: the ink line is drawn by pushing the
   surface outwards along the way it faces, and a razor edge has no agreed
   direction to push, so it comes out ragged.

   Built in the plane the outline is drawn in, and turned flat by the caller,
   because a wing and a fin and a leaf all want the same shape and different
   orientations.
--------------------------------------------------------------------------- */
export function panel(pts, thick, colour, opts) {
  const o = opts || {};
  /* A wing wants smoothing and a fin does not. Run through a curve, every
     corner of a fin rounds off and the whole thing comes out as a paddle -
     and a fish is nothing but corners: the notch in its tail, the point of
     its dorsal. `sharp` uses the drawn points as drawn. */
  const fine = o.sharp
    ? pts.map(([x, y]) => new THREE.Vector3(x, y, 0))
    : new THREE.CatmullRomCurve3(
        pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal')
        .getPoints(Math.max(28, pts.length * 5));
  const shape = new THREE.Shape();
  shape.moveTo(fine[0].x, fine[0].y);
  for (let i = 1; i < fine.length; i++) shape.lineTo(fine[i].x, fine[i].y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true,
    bevelThickness: thick * .45, bevelSize: o.bevel === undefined ? thick * .8 : o.bevel,
    bevelSegments: 2, curveSegments: 1, steps: 1
  });
  geo.translate(0, 0, -thick / 2);
  geo.computeVertexNormals();
  return paint(geo, colour);
}

/* A wing, laid flat and spanning outwards. The outline is drawn with x running
   fore-and-aft and y running out along the span; this stands it up so the span
   runs across the figure and the thin way is up-and-down.

   Left and right are two different TURNS of the same shape rather than a
   mirror of it. A mirror turns a solid inside out - every face ends up wound
   the wrong way round and the whole wing lights as though it were hollow. */
export function layFlat(geo, side) { geo.rotateX(side < 0 ? -Math.PI / 2 : Math.PI / 2); return geo; }

/* A cloak hangs level all the way round only if nobody is inside it. This lifts
   the hem at the front - where the figure's legs are - so it parts as he walks,
   which is most of what says "cloth" rather than "bell".

   `front` is how far up the hem at +x rises; the lift falls away to nothing at
   the back. Only the low corners move, so the shoulders keep their shape. */
/* Tear the bottom off something. A thing made of straw that ends in a smooth
   turned curve reads as a bell, however good the colour is - what says straw
   is that the hem is a different length everywhere you look. The variation is
   in whole steps rather than a wobble, so it reads as strands rather than as
   a dented lampshade, and it dies away above `below` so only the hem moves. */
const ragged = (amount, below) => geo => {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > below) continue;
    const a = Math.atan2(z, x);
    // three overlapping runs of strands, so no two look alike round the turn
    const n = Math.sin(a * 7) * .5 + Math.sin(a * 13 + 1.7) * .3 + Math.sin(a * 23 + .6) * .2;
    const depth = Math.min(1, (below - y) / 8);
    pos.setY(i, y - Math.abs(n) * amount * depth);
    const r = Math.hypot(x, z) || 1;
    pos.setXYZ(i, x * (1 + n * .04 * depth), pos.getY(i), z * (1 + n * .04 * depth));
  }
};

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
   FOUR-LEGGED THINGS

   Most of the bestiary is an animal: a bear, a hound, a fox, a hare, a bull,
   a hedgehog, a stone pup, a cat. They differ enormously in how they LOOK and
   hardly at all in how they are BUILT - a spine with a leg at each corner, a
   neck, a head, a tail. So there is one builder, and each of them is a sheet
   of numbers handed to it.

   The rig is generated from the sheet rather than written out, because a hare
   and a bull do not want the same skeleton at different scales: the hare's back
   legs are half again as long as its front ones and the bull's are not, and
   that difference IS the animal.

   Nothing here is a monster or a creature particularly. `stonepup` and
   `glimmercat` are friendly and `shadehound` is not, and the only difference
   between them in this file is the numbers.
--------------------------------------------------------------------------- */
/* Repaint the lower part of a shape. `below` is where the change happens and
   `fade` how much of a gradient it gets - nearly none, because the whole point
   of the light ramp is that this picture is made of flat areas with edges
   between them, and a soft airbrushed belly would be the one thing in the
   scene that is not. */
function underside(geo, hex, below, fade) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  const c = new THREE.Color(hex);
  const f = fade || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (below - pos.getY(i)) / f));
    if (t <= 0) continue;
    col.setXYZ(i,
      col.getX(i) + (c.r - col.getX(i)) * t,
      col.getY(i) + (c.g - col.getY(i)) * t,
      col.getZ(i) + (c.b - col.getZ(i)) * t);
  }
  return geo;
}

function quadRig(s) {
  const L = s.body.len, W = s.width;
  const fr = s.legF, bk = s.legB;
  const rows = [
    ['spine', 'root', 0, s.stand, 0],
    ['chest', 'spine', L * .36, s.chestUp || 0, 0],
    ['rump', 'spine', -L * .30, s.rumpUp || 0, 0],
    ['neck', 'chest', s.neck.f, s.neck.up, 0],
    ['head', 'neck', s.neck.len, s.neck.rise || 0, 0],
    ['tail', 'rump', -s.tail.f, s.tail.up, 0],
    ['tailTip', 'tail', -s.tail.len * .55, 0, 0]
  ];
  for (const side of ['L', 'R']) {
    const z = (side === 'L' ? -1 : 1) * W;
    rows.push(
      ['shoulder' + side, 'chest', 0, -(s.chestDrop || 0), z],
      ['kneeF' + side, 'shoulder' + side, 0, -fr[0], 0],
      ['ankleF' + side, 'kneeF' + side, 0, -fr[1], 0],
      ['hip' + side, 'rump', 0, -(s.rumpDrop || 0), z],
      ['kneeB' + side, 'hip' + side, 0, -bk[0], 0],
      ['ankleB' + side, 'kneeB' + side, 0, -bk[1], 0]
    );
  }
  return rows;
}

export function buildBeast(s) {
  const j = makeRig(quadRig(s));
  const mat = figureMat();
  const C = s.col;
  const L = s.body.len;

  /* THE BODY, laid along the way it faces. One shape: a barrel is a barrel
     whether it belongs to a bear or a hare, and what makes it one or the other
     is the profile, which is the sheet's. */
  const barrel = at(alongX(spindle(s.body.prof, C.coat, s.body.seg || 18)), -L / 2, 0, 0);
  /* A body need not be round in section. A frog is wider than it is deep and
     a fish is the other way about, and both are the same outline pressed. */
  if (s.body.flat || s.body.wide) barrel.scale(1, s.body.flat || 1, s.body.wide || 1);
  /* The pale belly is REPAINTED ONTO the barrel rather than being a second
     shape tucked under it. Tucked under, it was a squashed ball that mostly
     hid inside the body and showed as a grey patch in the middle of the fox.
     Repainting costs no geometry at all, cannot poke through anything, and
     gives the hard line along the flank that a drawing would give it. */
  if (C.belly !== undefined) underside(barrel, C.belly, -s.body.deep * .46, s.body.deep * .26);
  attach(j.spine, [barrel], mat);

  /* THE NECK, aimed from the chest at wherever the head has been put. Built
     along +x and then turned to point at it, so a sheet can raise a head
     without also having to work out the angle of the neck below it. */
  {
    const rise = s.neck.rise || 0, run = s.neck.len;
    const n = alongX(spindle(
      [[0, -2], [s.neck.r * .92, 1], [s.neck.r, run * .5], [s.neck.r * .88, Math.hypot(run, rise) + 2]],
      C.coat, 14));
    n.rotateZ(Math.atan2(rise, run));
    attach(j.neck, [n], mat);
  }

  /* THE HEAD. Also a spindle: a muzzle is exactly a body profile, shorter.
     Ears, eyes and whatever it has instead of a nose go on top of it, and the
     whole head is merged into one mesh so the line goes round the head rather
     than round each ear. */
  attach(j.head, animalHead(s, C), mat);

  // THE LEGS. Same bones as his, in a different arrangement four times over.
  for (const side of ['L', 'R']) {
    const fr = s.legF, bk = s.legB;
    attach(j['shoulder' + side], [bone(fr[0], fr[2], fr[3], C.coat, { capScale: 1.0 })], mat);
    attach(j['kneeF' + side], [bone(fr[1], fr[3], fr[3] * .88, C.leg === undefined ? C.coat : C.leg, { foot: false })], mat);
    attach(j['ankleF' + side], [pawGeometry(s.paw, C)], mat);
    attach(j['hip' + side], [bone(bk[0], bk[2], bk[3], C.coat, { capScale: 1.08 })], mat);
    attach(j['kneeB' + side], [bone(bk[1], bk[3], bk[3] * .88, C.leg === undefined ? C.coat : C.leg, { foot: false })], mat);
    attach(j['ankleB' + side], [pawGeometry(s.paw, C)], mat);
  }

  // THE TAIL, in two lengths so it can hang and curl rather than stick out.
  if (s.tail.len > 0) {
    const tc = C.tail === undefined ? C.coat : C.tail;
    attach(j.tail, [alongNegX(spindle(
      [[0, -1], [s.tail.r, 0], [s.tail.r * .9, s.tail.len * .55]], tc, 10))], mat);
    attach(j.tailTip, [alongNegX(spindle(
      [[s.tail.r * .9, 0], [s.tail.r * (s.tail.tuft || .6), s.tail.len * .30], [0, s.tail.len * .48]],
      tc, 10))], mat);
    j.tail.rotation.z = s.tail.droop || 0;
    j.tailTip.rotation.z = s.tail.curl || 0;
  }

  /* STANDING. Left alone, all four legs are vertical poles and the animal
     reads as a table. A real one is a zigzag: the back leg especially, where
     the thigh goes down-and-forward and the hock comes back under it again.
     That zigzag is most of what separates a hound from a sheep, so a sheet can
     override it, and the numbers below are only the usual answer. */
  const pf = s.poseF || [.12, -.20], pb = s.poseB || [.30, -.52];
  for (const side of ['L', 'R']) {
    j['shoulder' + side].rotation.z = pf[0];
    j['kneeF' + side].rotation.z = pf[1];
    j['hip' + side].rotation.z = pb[0];
    j['kneeB' + side].rotation.z = pb[1];
    // and the paw sits flat however the leg above it is angled
    j['ankleF' + side].rotation.z = -(pf[0] + pf[1]);
    j['ankleB' + side].rotation.z = -(pb[0] + pb[1]);
  }

  // Whatever else this one has: a hedgehog's spines, a golem's cracks.
  if (s.extra) s.extra(j, mat, C, s);

  /* `eyes` is empty on purpose. A beast's eyes are merged into its head, so
     there is nothing separate to pulse - but the renderer walks this list for
     every monster, and an absent list is a crash rather than a still eye. */
  j.root.userData = {
    rig: j, eyes: [], height: s.stand + s.neck.up + (s.neck.rise || 0) + 12,
    legs: [j.shoulderL, j.shoulderR], backLegs: [j.hipL, j.hipR],
    knees: [j.kneeFL, j.kneeFR], backKnees: [j.kneeBL, j.kneeBR],
    head: j.head, tail: j.tail, tailTip: j.tailTip
  };
  if (s.scale && s.scale !== 1) j.root.scale.setScalar(s.scale);
  return inkGroup(j.root);
}

/* An animal's head, whatever the animal stands on or flies with. Sat ON the
   head joint rather than hung forward off it, so the joint lands roughly
   behind the eyes and everything else - ears, eyes, muzzle, nose - is placed
   against the head's own middle, which is how you would describe it out loud.

   Shared by the four-legged and the flying, because an owl's head and a fox's
   differ in their numbers and not at all in their parts. */
function animalHead(s, C) {
  const H = s.head;
  const skull = alongX(spindle(H.prof, C.coat, H.seg || 16));
  if (H.flat || H.wide) skull.scale(1, H.flat || 1, H.wide || 1);
  const out = [at(skull, -H.len * .45, 0, 0)];

  if (C.muzzle !== undefined && H.muzzleAt) {
    const m = new THREE.SphereGeometry(1, 14, 10);
    m.scale(H.muzzleAt[3], H.muzzleAt[4], H.muzzleAt[4]);
    m.translate(H.muzzleAt[0], H.muzzleAt[1], 0);
    out.push(paint(m, C.muzzle));
  }
  if (H.beak) {
    // A beak is a small spindle of its own, which is the one thing a muzzle
    // made of a squashed ball can never be made to look like.
    const b = alongX(spindle([[0, -1], [H.beak[3], 0], [H.beak[3] * .5, H.beak[2] * .55], [0, H.beak[2]]],
      C.beak === undefined ? 0xd9b45a : C.beak, 10));
    b.rotateZ(H.beak[4] === undefined ? -.12 : H.beak[4]);
    out.push(at(b, H.beak[0], H.beak[1], 0));
  }
  if (H.nose) {
    const n = new THREE.SphereGeometry(H.nose[3], 10, 8);
    n.scale(.9, .8, 1.05);
    out.push(at(paint(n, C.nose === undefined ? 0x241c1a : C.nose), H.nose[0], H.nose[1], 0));
  }
  for (const side of [-1, 1]) {
    if (H.eye) {
      const e = new THREE.SphereGeometry(H.eye[3], 10, 8);
      e.scale(.8, 1, 1);
      // A big eye wants a ring round it - it is most of what makes an owl an
      // owl rather than a pigeon with a wide face.
      if (C.eyeRing !== undefined) {
        const r = new THREE.SphereGeometry(H.eye[3] * 1.45, 12, 9);
        r.scale(.5, 1, 1);
        out.push(at(paint(r, C.eyeRing), H.eye[0] - H.eye[3] * .25, H.eye[1], side * H.eye[2]));
      }
      out.push(at(paint(e, C.eye), H.eye[0], H.eye[1], side * H.eye[2]));
    }
    if (s.ears) out.push(...earGeometry(s.ears, C, side));
    if (s.horns) out.push(...hornGeometry(s.horns, C, side));
    if (s.antennae) out.push(...antennaGeometry(s.antennae, C, side));
  }
  return out;
}

/* Feelers. A moth's are the whole reason you know it is a moth and not a
   butterfly, so they are fat and feathered rather than thread-thin. */
function antennaGeometry(a, C, side) {
  const col = C.antenna === undefined ? C.coat : C.antenna;
  const out = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const seg = spindle([[0, 0], [a.r * (1 - t * .5), a.len * .10], [0, a.len * .22]], col, 6);
    seg.rotateZ(-.5 - t * .5);                    // curling back over as it goes
    seg.rotateX(side * (.25 + t * .5));
    out.push(at(seg, a.at[0] + t * a.len * .55, a.at[1] + t * a.len * .42, side * (a.at[2] + t * a.len * .22)));
  }
  return out;
}

/* Ears. Four shapes between them cover every animal in the game: a wolf's
   point, a bear's round, a hare's long, and a cat's point set wide. */
function earGeometry(e, C, side) {
  const col = C.ear === undefined ? C.coat : C.ear;
  const out = [];
  const z = side * e.at[2];
  if (e.type === 'round') {
    const g = new THREE.SphereGeometry(e.r, 12, 9);
    g.scale(.55, 1, 1);
    out.push(at(paint(g, col), e.at[0], e.at[1], z));
  } else {
    // pointed and long are the same shape at different lengths
    const g = spindle([[0, 0], [e.r, e.len * .30], [e.r * .72, e.len * .72], [0, e.len]], col, 10);
    g.scale(.62, 1, 1);
    g.rotateX(side * (e.flare === undefined ? .34 : e.flare));
    g.rotateZ(e.lean === undefined ? -.18 : e.lean);
    out.push(at(g, e.at[0], e.at[1], z));
    if (C.earIn !== undefined) {
      const i = spindle([[0, 0], [e.r * .55, e.len * .30], [0, e.len * .78]], C.earIn, 8);
      i.scale(.5, 1, 1);
      i.rotateX(side * (e.flare === undefined ? .34 : e.flare));
      i.rotateZ(e.lean === undefined ? -.18 : e.lean);
      out.push(at(i, e.at[0] + .5, e.at[1], z));
    }
  }
  return out;
}

function hornGeometry(h, C, side) {
  const col = C.horn === undefined ? 0xcfc3ae : C.horn;
  const g = spindle([[0, 0], [h.r, h.len * .22], [h.r * .62, h.len * .66], [0, h.len]], col, 9);
  g.rotateZ(side * 0);
  g.rotateX(side * (h.flare === undefined ? .9 : h.flare));
  g.rotateZ(h.lean === undefined ? .2 : h.lean);
  return [at(g, h.at[0], h.at[1], side * h.at[2])];
}

/* A paw. Small, but it is where the animal meets the ground and a leg that
   ends in nothing reads as a stick pushed into the earth. */
function pawGeometry(p, C) {
  if (!p) return null;
  const col = C.paw === undefined ? (C.leg === undefined ? C.coat : C.leg) : C.paw;
  const g = new THREE.SphereGeometry(p.r || 3.4, 12, 9);
  g.scale(1.5, .62, .92);
  g.translate((p.r || 3.4) * .35, -(p.drop === undefined ? 2.2 : p.drop), 0);
  return paint(g, col);
}

/* ---------------------------------------------------------------------------
   THINGS WITH TOO MANY LEGS

   A tomb beetle and a rubble crab. What makes something read as a bug is not
   the shell - a shell is just a squashed body - it is the LEGS: a lot of them,
   splayed out sideways and then bent back down, so the body is slung between
   them rather than standing on top of them. Four legs under a body is a dog.
   Six or eight out to the side is an insect, whatever else you do.

   So each leg goes out from the body before it goes down, and the joint half
   way along bends the other way. The sheet gives each PAIR its own splay and
   its own length, because a crab's front legs are not its back ones.
--------------------------------------------------------------------------- */
function bugRig(s) {
  const rows = [
    ['body', 'root', 0, s.stand, 0],
    ['head', 'body', s.head.at, s.head.up || 0, 0]
  ];
  s.legs.forEach((L, i) => {
    for (const side of ['L', 'R']) {
      const d = side === 'L' ? -1 : 1;
      rows.push(
        ['leg' + i + side, 'body', L[0], L[1], d * L[2]],
        ['knee' + i + side, 'leg' + i + side, 0, -L[3], 0],
        ['foot' + i + side, 'knee' + i + side, 0, -L[4], 0]
      );
    }
  });
  if (s.claw) for (const side of ['L', 'R']) {
    const d = side === 'L' ? -1 : 1;
    rows.push(
      ['arm' + side, 'body', s.claw.at[0], s.claw.at[1], d * s.claw.at[2]],
      ['pinch' + side, 'arm' + side, 0, -s.claw.upper, 0]
    );
  }
  return rows;
}

export function buildBug(s) {
  const j = makeRig(bugRig(s));
  const mat = figureMat();
  const C = s.col;

  /* THE SHELL. A body spindle squashed flat and spread wide - a crab is the
     same shape as a hound, pressed. The plates are cut into it with colour
     rather than modelled, because at this size a raised plate is two hundred
     triangles nobody will ever see the edge of. */
  const shell = at(alongX(spindle(s.shell.prof, C.shell, s.shell.seg || 18)), -s.shell.len / 2, 0, 0);
  shell.scale(1, s.shell.flat, s.shell.wide);
  if (C.under !== undefined) underside(shell, C.under, -s.shell.deep * .12, s.shell.deep * .2);
  if (s.shell.plates) plates(shell, s.shell.plates, s.shell.len);
  attach(j.body, [shell], mat);

  attach(j.head, animalHead(s, C), mat);

  // Eyes on stalks, for the one that has them.
  const eyes = [];
  if (s.stalks) for (const side of [-1, 1]) {
    const st = spindle([[0, 0], [s.stalks.r * .5, s.stalks.len * .5], [s.stalks.r, s.stalks.len]], C.shell, 8);
    st.rotateZ(-.25);
    st.rotateX(side * .30);
    attach(j.head, [at(st, s.stalks.at[0], s.stalks.at[1], side * s.stalks.at[2])], mat);
    const e = new THREE.Mesh(new THREE.SphereGeometry(s.stalks.r * 1.05, 10, 8), glow(C.glow || 0xf1d36a, 1.7));
    e.position.set(s.stalks.at[0] + s.stalks.len * .26, s.stalks.at[1] + s.stalks.len * .92,
      side * (s.stalks.at[2] + s.stalks.len * .28));
    j.head.add(e);
    eyes.push(e);
  }

  // THE LEGS, out then down.
  s.legs.forEach((L, i) => {
    const [, , , up, low, r, spread, bend] = L;
    for (const side of ['L', 'R']) {
      const d = side === 'L' ? -1 : 1, n = i + side;
      attach(j['leg' + n], [bone(up, r, r * .8, C.leg, { capScale: 1.1, foot: false })], mat);
      attach(j['knee' + n], [bone(low, r * .8, r * .42, C.leg, { foot: false })], mat);
      attach(j['foot' + n], [paint(at((() => {
        const t = new THREE.SphereGeometry(r * .5, 8, 6); t.scale(1.6, .5, 1); return t;
      })(), r * .3, 0, 0), C.foot === undefined ? C.leg : C.foot)], mat);
      j['leg' + n].rotation.x = d * spread;
      j['leg' + n].rotation.z = bend || 0;
      // and the joint half way bends the other way, putting the foot back down
      j['knee' + n].rotation.x = -d * spread * 1.55;
      j['knee' + n].rotation.z = -(bend || 0) * .5;
    }
  });

  // THE CLAWS, for the one that has those.
  if (s.claw) for (const side of ['L', 'R']) {
    const d = side === 'L' ? -1 : 1;
    attach(j['arm' + side], [bone(s.claw.upper, s.claw.r, s.claw.r * .8, C.leg, { capScale: 1.1, foot: false })], mat);
    attach(j['pinch' + side], [pincer(s.claw, C.shell, d)], mat);
    j['arm' + side].rotation.x = d * s.claw.spread;
    j['arm' + side].rotation.z = s.claw.lift || 0;
    j['pinch' + side].rotation.x = -d * s.claw.spread * .8;
    j['pinch' + side].rotation.z = -(s.claw.lift || 0) - 1.25;   // held out in front
  }

  if (s.extra) s.extra(j, mat, C, s);

  j.root.userData = { rig: j, eyes, height: s.stand + s.shell.deep * s.shell.flat + 6, head: j.head };
  if (s.scale && s.scale !== 1) j.root.scale.setScalar(s.scale);
  return inkGroup(j.root);
}

/* A pincer: a fat palm with a fixed lower jaw and a shorter upper one held
   open above it. Two spindles and a squashed ball, and it reads instantly. */
function pincer(c, colour, side) {
  const out = [];
  const palm = new THREE.SphereGeometry(c.pr, 12, 9);
  palm.scale(1.5, 1, .7);
  palm.translate(c.pr * .4, 0, 0);
  out.push(paint(palm, colour));
  const lower = alongX(spindle([[0, -1], [c.pr * .55, 0], [c.pr * .3, c.plen * .7], [0, c.plen]], colour, 8));
  lower.rotateZ(-.10);
  out.push(at(lower, c.pr * 1.1, -c.pr * .35, 0));
  const upper = alongX(spindle([[0, -1], [c.pr * .45, 0], [c.pr * .24, c.plen * .6], [0, c.plen * .82]], colour, 8));
  upper.rotateZ(.42);
  out.push(at(upper, c.pr * 1.1, c.pr * .3, 0));
  return mergeGeometries(out);
}

/* Score a shell into plates. The lines are drawn by darkening a narrow band of
   corners, which costs nothing and lands wherever the shape already is -
   unlike a modelled groove, which has to be cut somewhere and then stays cut
   when the numbers around it change. */
function plates(geo, cuts, len) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + len / 2;            // distance from the tail end
    let near = 9e9;
    for (const t of cuts) near = Math.min(near, Math.abs(x - t * len));
    if (near > 1.1) continue;
    const k = 1 - near / 1.1;
    col.setXYZ(i, col.getX(i) * (1 - k * .75), col.getY(i) * (1 - k * .75), col.getZ(i) * (1 - k * .75));
  }
}

/* ---------------------------------------------------------------------------
   THINGS THAT STAND UP

   A stone golem, a scarecrow and a wraith made of hay. All three stand on two
   legs, so all three are built on BIPED - the same skeleton he is - and the
   whole difference is what is hung on it and how big it is scaled afterwards.

   That is the point of having had a rig at all. The golem took about twenty
   numbers, because the hard part was already done for a boy in a cloak.

   The wraith has no legs to speak of: `legless` puts a column of straw where
   they would be and leaves the rig underneath untouched, so it still has hips
   to sway from.
--------------------------------------------------------------------------- */
export function buildUpright(s) {
  const j = makeRig(BIPED);
  const mat = figureMat();
  const C = s.col;
  const body = [];

  /* BIPED is a boy's skeleton, and a boy is narrow. A golem is not: built on
     the rig as given, its arms hung at seven and a half from the middle of a
     torso fifteen wide, so both of them were INSIDE it and the thing came out
     as a lumpy cone. Widening the rig is a line each; rebuilding it per
     monster would not be. */
  if (s.shoulderZ) { j.shoulderL.position.z = -s.shoulderZ; j.shoulderR.position.z = s.shoulderZ; }
  if (s.hipZ) { j.hipL.position.z = -s.hipZ; j.hipR.position.z = s.hipZ; }
  if (s.shoulderY !== undefined) { j.shoulderL.position.y = s.shoulderY; j.shoulderR.position.y = s.shoulderY; }

  if (s.torso) body.push(turned(s.torso, C.body, s.torsoSeg || 20));
  if (s.belt) body.push(turned(s.belt, C.belt === undefined ? C.body : C.belt, 18));
  if (s.legless) body.push(turned(s.legless, C.legless === undefined ? C.body : C.legless, 24,
    s.ragged ? ragged(s.ragged[0], s.ragged[1]) : undefined));
  if (s.neck) body.push(at(bone(s.neck.len, s.neck.r, s.neck.r * 1.1, C.body, { cap: false, foot: false }),
    0, s.neck.at, 0));
  attach(j.hips, body.map(g => at(g, 0, -HIPS, 0)), mat);

  // THE HEAD, on the same parts every other animal's head is made of.
  attach(j.head, animalHead(s, C).map(g => at(g, 0, s.head.at - (HIPS + 8 + 9 + 7 + 4), 0)), mat);

  /* Eyes that GLOW are kept out of the merged head and given their own
     material, because a light is not a surface - and handed back on `eyes`,
     which is the list the renderer already pulses for every monster. */
  const eyes = [];
  if (s.glowEyes) {
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(s.glowEyes[3], 10, 8),
        glow(C.glow === undefined ? 0xf1d36a : C.glow, s.glowEyes[4] || 2.2));
      e.position.set(s.glowEyes[0], s.glowEyes[1] - (HIPS + 8 + 9 + 7 + 4), side * s.glowEyes[2]);
      j.head.add(e);
      eyes.push(e);
    }
  }

  for (const side of ['L', 'R']) {
    const d = side === 'L' ? -1 : 1;
    if (s.shoulder) {
      const b = new THREE.SphereGeometry(s.shoulder.r, 14, 10);
      b.scale(1, s.shoulder.squash || 1, 1);
      attach(j['shoulder' + side], [paint(b, C.shoulder === undefined ? C.body : C.shoulder)], mat);
    }
    attach(j['shoulder' + side], [bone(LIMB.upper, s.arm[0], s.arm[1], C.arm === undefined ? C.body : C.arm,
      { capScale: s.shoulder ? .8 : 1.05, foot: false })], mat);
    attach(j['elbow' + side], [bone(LIMB.fore, s.arm[1], s.arm[2], C.arm === undefined ? C.body : C.arm,
      { foot: false })], mat);
    attach(j['wrist' + side], [s.claw
      ? clawGeometry(s.claw, C.hand === undefined ? C.arm : C.hand, d)
      : handGeometry(C.hand === undefined ? C.body : C.hand, d)], mat);

    if (!s.legless) {
      attach(j['hip' + side], [bone(LIMB.thigh, s.leg[0], s.leg[1], C.leg === undefined ? C.body : C.leg,
        { capScale: 1.0 })], mat);
      attach(j['knee' + side], [bone(LIMB.shin, s.leg[1], s.leg[2], C.leg === undefined ? C.body : C.leg,
        { foot: false })], mat);
      attach(j['ankle' + side], [footGeometry(C.foot === undefined ? C.leg : C.foot, s.foot || 12, 4)], mat);
    }

    const p = s.pose || {};
    j['shoulder' + side].rotation.z = p.shoulder || 0;
    j['shoulder' + side].rotation.x = d * (p.spread === undefined ? .12 : p.spread);
    j['elbow' + side].rotation.z = p.elbow === undefined ? .2 : p.elbow;
    if (!s.legless) {
      j['hip' + side].rotation.z = p.hip || 0;
      j['knee' + side].rotation.z = p.knee === undefined ? -.1 : p.knee;
      j['ankle' + side].rotation.z = -((p.hip || 0) + (p.knee === undefined ? -.1 : p.knee));
      j['hip' + side].rotation.x = d * (p.stance === undefined ? .06 : p.stance);
    }
  }

  if (s.extra) s.extra(j, mat, C, s);

  j.root.userData = {
    rig: j, eyes, height: s.height || 72,
    legs: [j.hipL, j.hipR], arms: [j.shoulderL, j.shoulderR],
    knees: [j.kneeL, j.kneeR], elbows: [j.elbowL, j.elbowR],
    ankles: [j.ankleL, j.ankleR], head: j.head
  };
  if (s.scale && s.scale !== 1) j.root.scale.setScalar(s.scale);
  return inkGroup(j.root);
}

/* A hand that is not a hand: three blunt stone fingers, or a bundle of straw.
   Built as one piece because nothing about it ever moves on its own. */
function clawGeometry(c, colour, side) {
  const out = [];
  const palm = new THREE.SphereGeometry(c.r, 12, 9);
  palm.scale(1, 1.1, .8);
  palm.translate(0, -c.r * .9, 0);
  out.push(paint(palm, colour));
  for (let i = 0; i < (c.n || 3); i++) {
    const a = (i - (c.n || 3) / 2 + .5) * .6;
    const f = spindle([[0, 0], [c.r * .36, c.len * .3], [c.r * .22, c.len * .75], [0, c.len]], colour, 7);
    f.rotateZ(Math.PI);                       // pointing down, like the rest of the arm
    f.rotateX(side * a * .8);
    f.rotateZ(a * .35);
    out.push(at(f, 0, -c.r * 1.3, side * a * c.r * .7));
  }
  return mergeGeometries(out);
}

/* ---------------------------------------------------------------------------
   THINGS WITH WINGS

   An owl, a bat, a moth and a small quick bird. They have no legs worth
   drawing and one feature that carries the whole silhouette, so they are a
   different builder rather than a four-legged one with the legs turned off.

   The wings are hinged in two - shoulder and wrist - because a wing that
   flaps as one rigid board reads as a cardboard cut-out being waggled. Bent
   at the wrist on the upstroke, it reads as a wing.
--------------------------------------------------------------------------- */
function flierRig(s) {
  const rows = [
    ['body', 'root', 0, s.hover, 0],
    ['neck', 'body', s.neck.f, s.neck.up, 0],
    ['head', 'neck', s.neck.len, s.neck.rise || 0, 0],
    ['tail', 'body', -s.tail.f, s.tail.up || 0, 0]
  ];
  for (const side of ['L', 'R']) {
    const z = (side === 'L' ? -1 : 1);
    rows.push(
      ['wing' + side, 'body', s.wing.at[0], s.wing.at[1], z * s.wing.at[2]],
      ['wingTip' + side, 'wing' + side, 0, 0, z * s.wing.inner]
    );
    if (s.wing2) rows.push(['wing2' + side, 'body', s.wing2.at[0], s.wing2.at[1], z * s.wing2.at[2]]);
  }
  return rows;
}

export function buildFlier(s) {
  const j = makeRig(flierRig(s));
  const mat = figureMat();
  const C = s.col;

  const barrel = at(alongX(spindle(s.body.prof, C.coat, s.body.seg || 16)), -s.body.len / 2, 0, 0);
  // A fish is a flier with the press the other way about: tall and narrow.
  if (s.body.flat || s.body.wide) barrel.scale(1, s.body.flat || 1, s.body.wide || 1);
  if (C.belly !== undefined) underside(barrel, C.belly, -s.body.deep * .40, s.body.deep * .26);
  attach(j.body, [barrel], mat);

  if (s.neck.r > 0) {
    const rise = s.neck.rise || 0;
    const n = alongX(spindle([[0, -1], [s.neck.r, 1], [s.neck.r * .9, Math.hypot(s.neck.len, rise) + 1]], C.coat, 12));
    n.rotateZ(Math.atan2(rise, s.neck.len));
    attach(j.neck, [n], mat);
  }
  attach(j.head, animalHead(s, C), mat);

  /* THE WINGS. The inner half hangs off the shoulder and the outer half off
     the wrist, so the two bend against each other. Both are the same drawn
     outline at different lengths - which is the point of drawing it rather
     than modelling it. */
  for (const side of ['L', 'R']) {
    const d = side === 'L' ? -1 : 1;
    attach(j['wing' + side], [layFlat(panel(s.wing.inOutline, s.wing.thick, C.wing === undefined ? C.coat : C.wing, s.wing.opts), d)], mat);
    attach(j['wingTip' + side], [layFlat(panel(s.wing.outOutline, s.wing.thick, C.wingTip === undefined ? (C.wing === undefined ? C.coat : C.wing) : C.wingTip, s.wing.opts), d)], mat);
    // a second, smaller pair for the things that have four
    if (s.wing2) attach(j['wing2' + side], [layFlat(panel(s.wing2.outline, s.wing2.thick, C.wing2 === undefined ? C.wing : C.wing2), d)], mat);
    // Where they sit when nothing is driving them; `flapWings` adds to this.
    j['wing' + side].rotation.x = d * (s.wing.rest || 0);
    j['wingTip' + side].rotation.x = d * (s.wing.restTip || 0);
    if (s.wing2) j['wing2' + side].rotation.x = d * (s.wing2.rest || 0);
  }

  // THE TAIL - a fan on a bird, a rudder on a bat, nothing much on a moth.
  if (s.tail.outline) {
    const t = panel(s.tail.outline, s.tail.thick || 1.2, C.tail === undefined ? C.coat : C.tail, s.tail.opts);
    t.rotateX(Math.PI / 2);                 // flat, like a bird's
    t.rotateZ(s.tail.droop || 0);
    attach(j.tail, [t], mat);
  } else if (s.tail.len > 0) {
    attach(j.tail, [alongNegX(spindle(
      [[0, -1], [s.tail.r, 0], [s.tail.r * .6, s.tail.len * .7], [0, s.tail.len]],
      C.tail === undefined ? C.coat : C.tail, 10))], mat);
    j.tail.rotation.z = s.tail.droop || 0;
  }

  if (s.extra) s.extra(j, mat, C, s);

  /* The wings come back paired with the angle they rest at and which way round
     they are, so the flap can be added to where they already sit rather than
     replacing it - and so a hind pair that rests lower than the fore pair
     stays lower through the whole beat. */
  const wings = [
    { j: j.wingL, d: -1, rest: s.wing.rest || 0, lag: 0 },
    { j: j.wingR, d: 1, rest: s.wing.rest || 0, lag: 0 },
    // The tips trail the shoulders. A wing whose whole length moves at once is
    // a board; the lag is what makes it look like it is pushing against air.
    { j: j.wingTipL, d: -1, rest: s.wing.restTip || 0, lag: .9 },
    { j: j.wingTipR, d: 1, rest: s.wing.restTip || 0, lag: .9 }
  ];
  if (s.wing2) wings.push(
    { j: j.wing2L, d: -1, rest: s.wing2.rest || 0, lag: .5 },
    { j: j.wing2R, d: 1, rest: s.wing2.rest || 0, lag: .5 });

  j.root.userData = {
    rig: j, eyes: [], height: s.hover + s.body.deep + 6,
    wings, head: j.head,
    flap: s.wing.flap === undefined ? .55 : s.wing.flap,
    flapRate: s.wing.rate || 3.2,
    hover: s.hover
  };
  if (s.scale && s.scale !== 1) j.root.scale.setScalar(s.scale);
  return inkGroup(j.root);
}

/* Beat the wings of whatever has them. Kept here beside the thing it drives,
   so the game and the viewer flap the same way rather than each keeping their
   own copy of the sum and drifting apart. `phase` is time, and `amount` scales
   the whole beat down to nothing for a thing at rest. */
export function flapWings(u, phase, amount) {
  if (!u || !u.wings) return;
  const a = amount === undefined ? 1 : amount;
  for (const w of u.wings) {
    w.j.rotation.x = w.d * (w.rest + Math.sin(phase - w.lag) * u.flap * a);
  }
}

/* ---------------------------------------------------------------------------
   THE SHEETS

   One row per animal. Everything in here is a number or a colour - there is no
   code, and adding an animal adds no code either.

   `body.prof` and `head.prof` are outlines: pairs of (how wide, how far along),
   running nose-ward, starting and ending at nothing. They are the animal. A
   bear's barrel is widest a third of the way along and stays wide; a fox's
   tapers away at both ends; a bull carries its bulk at the shoulder.

   The leg pairs are [upper, lower, top radius, bottom radius], and they are
   what make a hare a hare: its back legs are half again its front ones, and
   nothing else about it has to change to say so.
--------------------------------------------------------------------------- */
export const BEASTS = {
  bramblebear: {
    stand: 34, width: 9.5, chestDrop: 6, rumpDrop: 6,
    body: { len: 58, deep: 14, prof: [[0, 0], [6, 2], [11, 9], [13.5, 20], [13, 34], [11, 46], [7, 54], [0, 58]] },
    legF: [13, 11, 4.4, 3.6], legB: [14, 10, 4.8, 3.8],
    neck: { f: 4, up: 5, len: 8, r: 4.8, rise: 4 },
    head: { len: 19, prof: [[0, 0], [5, 2], [7, 6], [6.5, 11], [5, 16], [0, 19]],
            muzzleAt: [4, -1.4, 0, 5.5, 3.4], nose: [8.4, -1.0, 0, 1.5], eye: [3.0, 2.2, 3.4, 1.15] },
    ears: { type: 'round', r: 3.2, at: [-3.5, 5.2, 4.4] },
    tail: { f: 2, up: 3, len: 7, r: 1.8, droop: .5 },
    paw: { r: 3.8, drop: 1.6 },
    col: { coat: 0x5b4636, belly: 0x46362a, muzzle: 0x6e5844, ear: 0x46362a, eye: 0xf1d36a, paw: 0x35291f }
  },

  shadehound: {
    stand: 32, width: 8, chestDrop: 5, rumpDrop: 5,
    body: { len: 52, deep: 10, prof: [[0, 0], [4, 2], [8, 8], [9.5, 18], [9, 30], [8.5, 42], [6, 49], [0, 52]] },
    legF: [13, 10, 3.6, 2.8], legB: [14, 9, 4.0, 3.0],
    neck: { f: 4, up: 5, len: 8, r: 3.6, rise: 4 },
    head: { len: 21, prof: [[0, 0], [4.5, 2], [6.2, 6], [4.8, 12], [3.4, 18], [0, 21]],
            nose: [9.6, -.6, 0, 1.3], eye: [2.4, 2.0, 2.8, 1.0] },
    ears: { type: 'point', r: 2.6, len: 7.5, at: [-2.6, 5.0, 3.4], flare: .40 },
    tail: { f: 2, up: 2, len: 14, r: 1.9, tuft: .8, droop: .9, curl: .4 },
    paw: { r: 3.0, drop: 1.4 },
    col: { coat: 0x4a4458, belly: 0x393447, muzzle: 0x565066, ear: 0x2f2b3c, earIn: 0x6a5f7e,
           eye: 0xf1d36a, paw: 0x2a2634, tail: 0x413b52 }
  },

  nightfox: {
    stand: 24, width: 6, chestDrop: 4, rumpDrop: 4,
    body: { len: 40, deep: 7.5, prof: [[0, 0], [3, 1.5], [5.5, 6], [7, 14], [6.5, 24], [6, 32], [4.5, 37], [0, 40]] },
    legF: [9, 7, 2.6, 2.0], legB: [10, 6, 2.8, 2.1],
    neck: { f: 3, up: 4, len: 5.5, r: 2.7, rise: 3 },
    head: { len: 16, prof: [[0, 0], [3.6, 1.5], [5, 5], [3.4, 10], [2.2, 14], [0, 16]],
            nose: [7.2, -.4, 0, 1.0], eye: [1.8, 1.6, 2.2, .85] },
    ears: { type: 'point', r: 2.4, len: 7, at: [-1.8, 3.8, 2.6], flare: .34 },
    tail: { f: 1, up: 1.5, len: 20, r: 2.6, tuft: 1.05, droop: .5, curl: .3 },
    paw: { r: 2.2, drop: 1.0 },
    col: { coat: 0x8a4a2e, belly: 0xd8c7ad, muzzle: 0xd8c7ad, ear: 0x2a1d16, earIn: 0xc99c78,
           eye: 0xf1d36a, paw: 0x2a1d16, tail: 0x9a5636 }
  },

  dusthare: {
    stand: 24, width: 5.5, chestDrop: 4, rumpDrop: 3,
    body: { len: 34, deep: 9, prof: [[0, 0], [4, 1.5], [8, 6], [9, 14], [8, 22], [6, 29], [4, 32], [0, 34]] },
    legF: [8, 8, 2.4, 1.9], legB: [11, 6, 3.6, 2.4],
    neck: { f: 2, up: 4, len: 4, r: 2.6, rise: 3.5 },
    head: { len: 14, prof: [[0, 0], [3.6, 1.5], [4.8, 5], [4, 9], [2.6, 12], [0, 14]],
            nose: [6.2, -.4, 0, .9], eye: [1.4, 1.8, 2.6, .9] },
    // The one feature nobody could mistake. Long, and leaning back.
    ears: { type: 'long', r: 2.0, len: 15, at: [-1.4, 3.6, 2.0], flare: .22, lean: -.55 },
    tail: { f: 1, up: 2, len: 4, r: 2.4, tuft: 1.0, droop: -.3 },
    paw: { r: 2.4, drop: 1.0 },
    col: { coat: 0xb9a184, belly: 0xe2d6c0, muzzle: 0xd6c6ad, ear: 0x8d7a62, earIn: 0xd3a9a0,
           eye: 0x2b2118, paw: 0x9a856b }
  },

  thistlebull: {
    stand: 40, width: 11, chestDrop: 8, rumpDrop: 8,
    body: { len: 62, deep: 16, prof: [[0, 0], [6, 2], [12, 10], [14, 24], [15.5, 40], [14, 52], [9, 59], [0, 62]] },
    legF: [15, 13, 5.0, 4.0], legB: [16, 12, 5.2, 4.0],
    neck: { f: 5, up: 3, len: 7, r: 6.2, rise: 1 },
    head: { len: 20, prof: [[0, 0], [6, 2], [7.5, 7], [7, 13], [6, 18], [0, 20]],
            muzzleAt: [5, -2.0, 0, 5.0, 3.6], nose: [8.6, -1.6, 0, 1.6], eye: [2.0, 2.6, 4.6, 1.2] },
    ears: { type: 'point', r: 2.2, len: 5.5, at: [-1.0, 3.0, 6.2], flare: 1.25, lean: 0 },
    horns: { r: 2.4, len: 13, at: [-0.5, 5.4, 4.6], flare: 1.05, lean: .35 },
    tail: { f: 2, up: 3, len: 16, r: 1.8, tuft: 1.4, droop: 1.0, curl: .3 },
    paw: { r: 4.2, drop: 1.8 },
    col: { coat: 0x5e4a52, belly: 0x4a3a41, muzzle: 0x8a7a70, ear: 0x4a3a41,
           eye: 0xf1d36a, horn: 0xd8cbb2, paw: 0x2e2429, tail: 0x4a3a41 }
  },

  thornback: {
    stand: 16, width: 5, chestDrop: 3, rumpDrop: 3,
    body: { len: 30, deep: 11, prof: [[0, 0], [5, 1.5], [9, 5], [11, 13], [10.5, 20], [7, 26], [4, 28], [0, 30]] },
    legF: [5, 5, 1.8, 1.5], legB: [6, 4, 2.0, 1.6],
    neck: { f: 2, up: 2, len: 3, r: 2.1, rise: 1.5 },
    head: { len: 13, prof: [[0, 0], [3.4, 1.5], [4.4, 4], [3, 8], [1.8, 11], [0, 13]],
            nose: [5.8, -.4, 0, .9], eye: [1.2, 1.4, 2.0, .75] },
    ears: { type: 'round', r: 1.5, at: [-1.6, 2.6, 2.2] },
    tail: { f: 1, up: 1, len: 2.5, r: 1.2 },
    paw: { r: 1.8, drop: .8 },
    col: { coat: 0x9a8468, belly: 0xc4b295, muzzle: 0xc4b295, ear: 0x7a6650,
           eye: 0x2b2118, paw: 0x7a6650 },
    // and the thing it is named for
    extra: (j, mat, C, s) => attach(j.spine, spikes(s, 0x3f3428), mat)
  },

  stonepup: {
    stand: 18, width: 5, chestDrop: 3, rumpDrop: 3,
    body: { len: 26, deep: 8, prof: [[0, 0], [4, 1], [7, 4], [8, 10], [7.5, 16], [6, 21], [4, 24], [0, 26]] },
    legF: [6, 5, 2.6, 2.2], legB: [7, 4, 2.8, 2.3],
    neck: { f: 2, up: 3, len: 3, r: 2.8, rise: 2 },
    head: { len: 14, prof: [[0, 0], [4.5, 2], [6, 5], [5, 10], [3.4, 13], [0, 14]],
            muzzleAt: [3.2, -1.2, 0, 3.6, 2.4], nose: [6.4, -.8, 0, 1.2], eye: [2.0, 1.8, 2.8, 1.0] },
    ears: { type: 'point', r: 2.2, len: 5, at: [-1.6, 3.4, 2.6], flare: .5, lean: -.3 },
    tail: { f: 1, up: 2, len: 5, r: 1.8, droop: .6 },
    paw: { r: 2.4, drop: 1.0 },
    col: { coat: 0x8f96a2, belly: 0xa4abb6, muzzle: 0x9ea5b1, ear: 0x767d89,
           eye: 0x9fd8ff, paw: 0x676e79 }
  },

  glimmercat: {
    stand: 22, width: 5, chestDrop: 4, rumpDrop: 4,
    body: { len: 34, deep: 7, prof: [[0, 0], [3, 1], [5.5, 5], [6.8, 12], [6.5, 20], [6, 27], [4.5, 31], [0, 34]] },
    legF: [8, 6, 2.2, 1.8], legB: [9, 5, 2.4, 1.9],
    neck: { f: 2, up: 4, len: 4, r: 2.4, rise: 2.5 },
    head: { len: 13, prof: [[0, 0], [4.2, 1.5], [5.4, 4.5], [4.4, 9], [3, 11.5], [0, 13]],
            nose: [5.8, -.2, 0, .8], eye: [1.6, 1.6, 2.4, 1.0] },
    ears: { type: 'point', r: 2.4, len: 5.5, at: [-1.4, 3.6, 2.4], flare: .42, lean: -.1 },
    tail: { f: 1, up: 3, len: 22, r: 1.4, tuft: 1.1, droop: 1.5, curl: .7 },
    paw: { r: 2.0, drop: .9 },
    col: { coat: 0x7a63a8, belly: 0x9584c4, muzzle: 0x9584c4, ear: 0x53437a, earIn: 0xc9a9e8,
           eye: 0xbff0a0, paw: 0x53437a, tail: 0x8f78bd }
  }
};

/* ---------------------------------------------------------------------------
   THE FLYING SHEETS

   The wing outlines are drawn with x running fore-and-aft - forward is the
   leading edge - and y running out along the span. Each is a closed loop: out
   along the front, then back along the trailing edge. Read them as drawings,
   because that is what they are; the difference between the owl and the bat is
   entirely in these numbers.
--------------------------------------------------------------------------- */
export const FLIERS = {
  owlshade: {
    hover: 36,
    body: { len: 26, deep: 11, prof: [[0, 0], [4, 1.5], [8, 5], [9, 12], [8, 19], [5, 24], [0, 26]] },
    neck: { f: 8, up: 4, len: 3, r: 5.5, rise: 1 },
    head: { len: 13, prof: [[0, 0], [6, 2], [7.5, 5], [7, 9], [5, 12], [0, 13]],
            // Enormous, and ringed. It is the whole face.
            eye: [5.2, 1.4, 3.2, 2.3], beak: [6.2, -.8, 4.5, 1.3, -.35] },
    ears: { type: 'point', r: 1.8, len: 5.5, at: [-1.0, 5.6, 2.8], flare: .3, lean: -.35 },
    wing: {
      at: [1, 5, 4], inner: 17, thick: 1.5, rest: .10, restTip: -.16, flap: .42,
      inOutline: [[7, 0], [8, 6], [7.2, 12], [5.5, 16.5], [4.5, 17],
                  [-6, 17], [-8, 16.5], [-9.2, 10], [-9, 4], [-7, 0]],
      outOutline: [[4.5, -2], [3.5, 5], [1, 12], [-2, 18], [-3.5, 20],
                   [-5.5, 19.5], [-8, 15], [-9, 8], [-8.5, 2], [-6, -2]]
    },
    tail: { f: 10, up: 0, thick: 1.4, droop: .18,
            outline: [[0, -5], [2, -7], [7, -9], [10, -6], [10, 0], [2, 4], [-1, 2]] },
    col: { coat: 0x4c4660, belly: 0x847c9c, wing: 0x3e3950, wingTip: 0x322e42,
           eye: 0xf5b942, eyeRing: 0xbcb2cc, beak: 0x2d2833, ear: 0x3e3950, tail: 0x3e3950 }
  },

  shadowbat: {
    hover: 32,
    body: { len: 16, deep: 5, prof: [[0, 0], [2, 1], [4, 4], [4.5, 8], [4, 12], [2.5, 15], [0, 16]] },
    neck: { f: 5, up: 2, len: 2, r: 2.4 },
    head: { len: 9, prof: [[0, 0], [3.4, 1], [4.2, 3], [3.4, 6], [2, 8], [0, 9]],
            nose: [4.0, -.4, 0, .8], eye: [2.6, 1.1, 1.8, .7] },
    // The ears are nearly as big as the head, which is the whole joke of a bat.
    ears: { type: 'long', r: 2.2, len: 8, at: [-.8, 3.4, 1.8], flare: .3, lean: -.25 },
    wing: {
      at: [0, 2, 2.5], inner: 13, thick: 1.0, rest: .18, restTip: -.30, flap: .95,
      inOutline: [[5, 0], [6, 4], [5.5, 9], [4, 12.5], [3, 13],
                  [-5, 13], [-6.5, 12.5], [-8, 8], [-7, 3], [-5, 0]],
      outOutline: [[3, -2], [1.5, 4], [-1, 10], [-4, 16], [-5.5, 18],
                   [-7, 17], [-9, 12], [-9, 6], [-8, 1], [-5, -2]]
    },
    tail: { f: 7, up: -1, len: 5, r: 1.2, droop: .6 },
    col: { coat: 0x3d3450, belly: 0x554a6b, wing: 0x2e2740, wingTip: 0x262036,
           eye: 0xf1d36a, ear: 0x2e2740, nose: 0x1d1828, tail: 0x2e2740 }
  },

  sunmoth: {
    hover: 34,
    body: { len: 20, deep: 6, prof: [[0, 0], [3, 1], [5.5, 4], [6, 9], [5, 14], [3, 18], [0, 20]] },
    neck: { f: 6, up: 2, len: 2, r: 2.8 },
    head: { len: 8, prof: [[0, 0], [3.4, 1], [4, 3], [3.2, 6], [0, 8]],
            eye: [2.2, .6, 2.3, 1.5] },
    antennae: { r: 1.0, len: 9, at: [1.5, 2.6, 1.0] },
    wing: {
      at: [2, 3, 2], inner: 11, thick: .9, rest: -.22, restTip: -.10, flap: .50,
      inOutline: [[8, 0], [9.5, 4], [8.5, 8], [6, 10.5], [4.5, 11],
                  [-4, 11], [-6, 10], [-8, 6], [-7.5, 2], [-5, 0]],
      outOutline: [[5, -2], [5, 4], [3, 9], [-1, 12.5], [-3, 13],
                   [-5, 12], [-8, 8], [-9, 4], [-8, 0], [-5, -2]]
    },
    // The hind pair, smaller and set behind - four wings, not two.
    wing2: { at: [-5, 1.5, 2], thick: .9, rest: -.05,
             outline: [[4, 0], [6, 5], [4, 11], [-1, 14], [-7, 11], [-8, 5], [-6, 1]] },
    tail: { f: 9, len: 0, r: 0 },
    col: { coat: 0xb08a4a, belly: 0xd8b878, wing: 0xe6c37a, wingTip: 0xf0d79c, wing2: 0xc9a25c,
           eye: 0x3a2c18, antenna: 0x6b5330 }
  },

  larkspark: {
    hover: 30,
    body: { len: 16, deep: 6, prof: [[0, 0], [2.5, 1], [5, 4], [5.5, 8], [4.5, 12], [2.5, 15], [0, 16]] },
    neck: { f: 5, up: 3, len: 2.5, r: 2.8, rise: 1 },
    head: { len: 9, prof: [[0, 0], [3.6, 1], [4.4, 3], [3.6, 6], [2, 8], [0, 9]],
            beak: [4.0, .2, 4, 1.0, -.10], eye: [2.6, 1.2, 2.0, .8] },
    wing: {
      at: [1, 3, 2.4], inner: 9, thick: .9, rest: -.12, restTip: -.22, flap: 1.05,
      inOutline: [[3, 0], [4.5, 3], [4, 6.5], [2.8, 8.5], [2, 9],
                  [-2.5, 9], [-4, 8], [-5.5, 4.5], [-4.5, 1.5], [-3, 0]],
      outOutline: [[2, -1.5], [1.2, 4], [-.5, 8], [-2.5, 11.5], [-4, 13],
                   [-5.5, 12], [-7, 8], [-6.5, 4], [-5, 0], [-3, -1.5]]
    },
    tail: { f: 7, up: 0, thick: 1.0, droop: .12,
            outline: [[0, -3], [2, -5], [6, -8], [7, -4], [7, 1], [2, 3], [-1, 1]] },
    col: { coat: 0xd6a94a, belly: 0xf0dda0, wing: 0xc6922f, wingTip: 0xe8c469,
           eye: 0x2e2410, beak: 0xe8b45c, tail: 0xc6922f }
  }
};

/* ---------------------------------------------------------------------------
   THE UPRIGHT SHEETS

   All three are BIPED, so their heights are the same seventy his are and the
   `scale` at the end is what makes the golem loom and the wraith drift. Torso
   and skirt outlines are closed loops given in heights off the floor, exactly
   as his tunic and cloak are.
--------------------------------------------------------------------------- */
export const UPRIGHT = {
  golem: {
    scale: 1.45, height: 74,
    // Heavy through the shoulders and narrow at the waist: a thing built to
    // hit, and the one silhouette nobody mistakes for a person in a coat.
    shoulderZ: 13.5, hipZ: 7.5, shoulderY: -1,
    torso: [[0, 26], [8.5, 26], [10, 30], [9, 38], [8.5, 44],
            [11, 51], [12.5, 56], [11, 58], [8, 55], [7, 46],
            [6.8, 38], [7.5, 30], [7.5, 27]],
    neck: { len: 5, r: 4.4, at: 60 },
    head: { at: 63, len: 15, prof: [[0, 0], [6, 2], [8, 5], [7.5, 10], [5, 13.5], [0, 15]] },
    glowEyes: [4.4, 65.5, 2.6, 1.5, 2.4],
    shoulder: { r: 8.5, squash: .85 },
    arm: [5.4, 4.8, 4.2], leg: [6.4, 5.6, 4.8], foot: 15,
    claw: { r: 4.2, len: 7, n: 3 },
    pose: { shoulder: .10, elbow: .30, spread: .20, hip: .04, knee: -.14, stance: .10 },
    col: { body: 0x6b6c66, shoulder: 0x7b7c74, arm: 0x63645e, leg: 0x5c5d57,
           hand: 0x73746c, foot: 0x4e4f4a, coat: 0x73746c, glow: 0x9fd8ff },
    // Veins of old light in the cracks, which is why it is weak to the moon.
    extra: (j, mat, C) => {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(9.2, .7, 5, 18),
        glow(0x9fd8ff, 1.7));
      seam.rotation.x = Math.PI / 2;
      seam.rotation.z = .22;
      seam.position.y = 49 - HIPS;
      j.hips.add(seam);
    }
  },

  scarecrow: {
    scale: 1.2, height: 74,
    // Thin, and hanging off its own crossbar rather than standing on anything.
    shoulderZ: 10.5, hipZ: 4.6, shoulderY: 2,
    torso: [[0, 26], [6.4, 26], [7.6, 30], [6.2, 38], [5.8, 46],
            [7.2, 52], [6.4, 55], [4.8, 53], [4.4, 44], [4.4, 34], [5.2, 27]],
    belt: [[0, 33], [7.8, 33], [8.2, 37], [0, 37]],
    neck: { len: 5, r: 2.4, at: 58 },
    // A sack, tied at the neck. Rounder than a head and slightly too big.
    head: { at: 62, len: 14, prof: [[0, 0], [6.5, 3], [7.4, 7], [6, 11], [3, 13.5], [0, 14]] },
    glowEyes: [5.0, 64.5, 2.6, 1.3, 2.0],
    arm: [3.0, 2.6, 2.2], leg: [3.6, 3.0, 2.6], foot: 10,
    claw: { r: 2.4, len: 6, n: 4 },
    // Arms out along the crossbar, which is the whole shape of a scarecrow.
    pose: { shoulder: 0, elbow: .05, spread: 1.32, hip: .02, knee: -.08, stance: .06 },
    col: { body: 0x6f5a3a, belt: 0x4a3a26, arm: 0x7a6440, leg: 0x5f4d32,
           hand: 0xc9a85e, foot: 0x3f3324, coat: 0xbfa066, glow: 0xf0a63c },
    extra: (j, mat, C) => {
      // the crossbar it is tied to, and the straw coming out at the cuffs
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 46, 7),
        lit({ color: 0x4a3a26, roughness: .95 }));
      bar.rotation.x = Math.PI / 2;
      bar.position.y = 52 - HIPS;
      j.hips.add(bar);
      const hat = new THREE.Mesh(
        mergeGeometries([
          paint(turned([[0, 0], [13, 0], [13.5, 1.6], [4.5, 2.6], [4.2, 1.4], [0, 1.2]], 0x8a7040, 18), 0x8a7040),
          paint(at(turned([[0, 1.4], [4.6, 1.6], [5.2, 9], [3.4, 10], [3.0, 8], [0, 1.8]], 0x7a6238, 16), 0, 0, 0), 0x7a6238)
        ]),
        figureMat());
      hat.position.y = 70 - (HIPS + 8 + 9 + 7 + 4);
      hat.rotation.z = .12;
      j.head.add(hat);
    }
  },

  haywraith: {
    scale: 1.25, height: 76,
    // No legs: it ends in a fall of straw and drifts on it.
    shoulderZ: 9.5, hipZ: 0, shoulderY: 2,
    legless: [[0, 2], [15, 2], [16.5, 6], [12, 18], [9, 28], [7.5, 35],
              [5.5, 35], [6.5, 26], [8.5, 15], [11, 5]],
    ragged: [9, 16],
    torso: [[0, 30], [6.5, 30], [8, 36], [7, 44], [8.6, 52],
            [7.4, 56], [5.2, 54], [4.8, 44], [4.8, 36], [5.6, 31]],
    neck: { len: 4, r: 3.0, at: 59 },
    // A hood of straw with nothing much inside it.
    head: { at: 62, len: 16, prof: [[0, 0], [6, 2], [7.2, 6], [5.6, 11], [2.6, 14.5], [0, 16]] },
    glowEyes: [4.6, 64.0, 2.4, 1.6, 2.6],
    arm: [3.4, 2.8, 2.2],
    claw: { r: 2.6, len: 8, n: 4 },
    pose: { shoulder: -.18, elbow: .62, spread: .78 },
    col: { body: 0xa08544, legless: 0x8a7038, arm: 0xa89050, hand: 0xc9ab62,
           coat: 0x9a7e40, glow: 0xb7e0ff }
  }
};

/* ---------------------------------------------------------------------------
   THE SMALL AND THE SQUAT

   A frog is a four-legged thing whose front legs are half its back ones and
   whose head is its front end rather than something on a neck. So these are
   BEASTS sheets like the rest - the neck is simply almost nothing long, and
   the body is pressed wider than it is deep.

   The two critters, the frog and the rabbit that hop about the lands, are the
   same sheets at a fraction of the size. They used to be a sphere with another
   sphere for a nose, which is what a rabbit looks like from very far away.
--------------------------------------------------------------------------- */
Object.assign(BEASTS, {
  bogling: {
    stand: 15, width: 7, chestDrop: 2, rumpDrop: 1,
    body: { len: 26, deep: 13, wide: 1.25, flat: .88,
            prof: [[0, 0], [5, 1], [9, 4], [10.5, 10], [10, 16], [8, 21], [5, 24], [0, 26]] },
    // Folded: a frog at rest is all haunch, and it is the haunch that says frog.
    legF: [6, 6, 2.2, 1.8], legB: [9, 8, 4.2, 2.4],
    poseF: [.22, -.34], poseB: [.85, -1.35],
    neck: { f: 1, up: 1, len: 1.5, r: 4.6, rise: .5 },
    head: { len: 15, prof: [[0, 0], [6, 1.5], [7.4, 5], [6.4, 10], [4, 13], [0, 15]],
            nose: [6.4, -.8, 0, .7], eye: [1.2, 4.2, 4.0, 2.4] },
    tail: { f: 0, up: 0, len: 0, r: 0 },
    paw: { r: 2.6, drop: .9 },
    col: { coat: 0x4e7a3e, belly: 0xc2c46a, muzzle: 0x5d8a48, eye: 0xf0d24a,
           paw: 0x3d6130, leg: 0x466f38 }
  },

  mossling: {
    stand: 13, width: 4.5, chestDrop: 2, rumpDrop: 2,
    body: { len: 20, deep: 11, wide: 1.1,
            prof: [[0, 0], [4, 1], [7.5, 4], [8.5, 9], [8, 13], [6, 17], [0, 20]] },
    legF: [5, 4, 2.0, 1.6], legB: [5, 4, 2.1, 1.7],
    poseF: [.10, -.16], poseB: [.20, -.34],
    neck: { f: 2, up: 2, len: 2, r: 3.0, rise: 1.5 },
    head: { len: 11, prof: [[0, 0], [4.4, 1.5], [5.4, 4], [4.4, 8], [2.6, 9.6], [0, 11]],
            nose: [4.8, -.4, 0, .7], eye: [2.0, 1.6, 2.6, 1.1] },
    ears: { type: 'round', r: 2.0, at: [-1.4, 3.0, 2.2] },
    tail: { f: 1, up: 1, len: 3, r: 1.4, droop: .4 },
    paw: { r: 1.8, drop: .7 },
    col: { coat: 0x6f8f4a, belly: 0x9db85f, muzzle: 0x86a355, ear: 0x54702f,
           eye: 0x2c3a18, paw: 0x54702f },
    // Leaves growing along its back, which is the whole of its name.
    extra: (j, mat, C, s) => attach(j.spine, leaves(s, 0x4e7a30, 0x6f9c42), mat)
  },

  critterfrog: {
    scale: .34,
    stand: 15, width: 7, chestDrop: 2, rumpDrop: 1,
    body: { len: 24, deep: 12, wide: 1.25, flat: .88,
            prof: [[0, 0], [5, 1], [9, 4], [10, 10], [9.4, 15], [7, 20], [0, 24]] },
    legF: [6, 6, 2.2, 1.8], legB: [9, 8, 4.0, 2.4],
    poseF: [.22, -.34], poseB: [.85, -1.35],
    neck: { f: 1, up: 1, len: 1.5, r: 4.4, rise: .5 },
    head: { len: 14, prof: [[0, 0], [5.6, 1.5], [7, 5], [6, 9], [3.6, 12], [0, 14]],
            eye: [1.2, 4.0, 3.8, 2.2] },
    tail: { f: 0, up: 0, len: 0, r: 0 },
    paw: { r: 2.4, drop: .8 },
    col: { coat: 0x5f9c52, belly: 0xbcc97a, eye: 0x1d2430, paw: 0x4a7c40 }
  },

  critterrabbit: {
    scale: .30,
    stand: 22, width: 5, chestDrop: 4, rumpDrop: 3,
    body: { len: 32, deep: 9, prof: [[0, 0], [4, 1.5], [7.5, 6], [8.5, 13], [7.5, 21], [5.5, 27], [0, 32]] },
    legF: [7, 7, 2.2, 1.8], legB: [10, 5, 3.4, 2.2],
    neck: { f: 2, up: 4, len: 3.5, r: 2.4, rise: 3 },
    head: { len: 13, prof: [[0, 0], [3.4, 1.5], [4.6, 5], [3.8, 9], [2.4, 11], [0, 13]],
            nose: [5.8, -.4, 0, .8], eye: [1.4, 1.8, 2.4, .9] },
    ears: { type: 'long', r: 1.9, len: 13, at: [-1.2, 3.4, 1.8], flare: .20, lean: -.45 },
    tail: { f: 1, up: 2, len: 3.5, r: 2.2, tuft: 1.0, droop: -.3 },
    paw: { r: 2.2, drop: .9 },
    col: { coat: 0xb5a48c, belly: 0xe0d6c2, muzzle: 0xd4c7ad, ear: 0x8f8069, earIn: 0xd3a9a0,
           eye: 0x1d2430, paw: 0x97886f }
  }
});

/* Leaves along a back. Flat panels rather than blobs, because a leaf is an
   outline - the same reason a wing is - and three sizes of one drawn shape,
   laid in a row and turned a little each, is a plant growing out of something
   rather than a row of identical green tabs. */
function leaves(s, dark, light) {
  const out = [], L = s.body.len;
  const shape = [[0, 0], [1.6, 2.2], [2.2, 5], [1.4, 7.6], [0, 8.6], [-1.4, 7.6], [-2.2, 5], [-1.6, 2.2]];
  const rows = [[.24, 1.15, .5], [.42, 1.45, -.2], [.60, 1.25, .35], [.76, .95, -.5]];
  for (const [along, size, turn] of rows) {
    for (const side of [-1, 0, 1]) {
      if (side === 0 && size < 1.1) continue;
      const g = panel(shape.map(([x, y]) => [x * size, y * size]), .5,
        side === 0 ? light : dark, { bevel: .18 });
      g.rotateX(side * .75 + turn * .3);
      g.rotateZ(-.5 - Math.abs(side) * .15);
      out.push(at(g, -L / 2 + along * L, s.body.deep * .42, side * s.body.deep * .30));
    }
  }
  return [mergeGeometries(out)];
}

/* ---------------------------------------------------------------------------
   THE MANY-LEGGED SHEETS

   Each leg row is [x along the body, y, z out from the middle, upper length,
   lower length, thickness, how far out it splays, how far forward it reaches].
   Front legs reach forward and back legs reach back, which is the difference
   between a bug walking and a bug lying on its back with its legs in the air.
--------------------------------------------------------------------------- */
export const BUGS = {
  tombbeetle: {
    scale: 1.15, stand: 13,
    shell: { len: 40, deep: 13, flat: .74, wide: 1.06,
             prof: [[0, 0], [5, 2], [10, 7], [12, 16], [11, 26], [8, 34], [0, 40]],
             plates: [.30, .52, .74] },
    head: { at: 20, up: 1, len: 12, prof: [[0, 0], [4, 1.5], [5.4, 4], [4.6, 8], [3, 10.5], [0, 12]],
            eye: [3.6, 1.6, 3.0, 1.0] },
    antennae: { r: .8, len: 8, at: [3.0, 2.2, 1.6] },
    legs: [
      [11, -1, 12.5, 7, 8, 1.7, .95, -.50],
      [1, -1, 13.5, 7, 9, 1.8, 1.05, 0],
      [-9, -1, 12.5, 7, 9, 1.8, 1.00, .55]
    ],
    col: { shell: 0x3f4a35, under: 0x2a3124, leg: 0x2f3728, foot: 0x232a1d,
           coat: 0x35402d, eye: 0x9fd85c, antenna: 0x2f3728 },
    // A beetle's back is two halves with a line down the middle, and that line
    // is most of what says beetle rather than woodlouse.
    extra: (j, mat, C, s) => {
      const split = new THREE.Mesh(new THREE.BoxGeometry(s.shell.len * .62, .5, .7),
        lit({ color: 0x1f2418, roughness: 1 }));
      split.position.set(-2, s.shell.deep * s.shell.flat * .92, 0);
      j.body.add(split);
    }
  },

  rubblecrab: {
    scale: 1.2, stand: 11,
    // Wide and low. Half as deep as it is broad, which no other thing here is.
    shell: { len: 26, deep: 14, flat: .54, wide: 1.30,
             prof: [[0, 0], [7, 2], [12, 6], [14, 13], [12, 20], [7, 24], [0, 26]],
             plates: [.38, .66] },
    head: { at: 12, up: -1, len: 7, prof: [[0, 0], [3.6, 1], [4.2, 3], [3.2, 5.5], [0, 7]] },
    stalks: { r: 1.2, len: 7, at: [1.5, 3.2, 2.6] },
    legs: [
      [7, 0, 16.5, 6, 8, 1.6, 1.15, -.65],
      [1, 0, 18, 6, 9, 1.7, 1.25, -.20],
      [-5, 0, 17.5, 6, 9, 1.7, 1.25, .28],
      [-10, 0, 15, 5, 8, 1.6, 1.15, .70]
    ],
    claw: { at: [13, 1, 13], upper: 9, r: 2.6, spread: .55, lift: -.35, pr: 3.6, plen: 7 },
    col: { shell: 0x7a6a5c, under: 0x9a8b7a, leg: 0x635648, foot: 0x4a4037,
           coat: 0x6e5f52, glow: 0xffd97a }
  }
};

/* A fish is a flier that happens to be in water: a body, a pair of fins that
   beat, and a tail that steers. So the Brookfin is a FLIERS sheet, with its
   body pressed the other way about - tall and narrow rather than flat and
   wide - and its pectorals where an owl's wings would be. The bat that flits
   about the lands is the Shadow Bat at a third of the size. */
Object.assign(FLIERS, {
  brookfin: {
    hover: 26,
    body: { len: 34, deep: 8, flat: 1.15, wide: .60,
            prof: [[0, 0], [2, 1], [5, 5], [7, 13], [6.5, 22], [4, 29], [0, 34]] },
    neck: { f: 11, up: 1, len: 1, r: 0 },
    head: { len: 11, flat: 1.2, wide: .66,
            prof: [[0, 0], [4.2, 1.5], [5, 4], [4, 8], [2.4, 10], [0, 11]],
            eye: [3.2, 1.8, 2.6, 1.4] },
    // The pectorals, small and fanning rather than a wing that carries weight.
    wing: {
      at: [4, -1, 3.2], inner: 5, thick: .7, rest: .34, restTip: .14, flap: .28, rate: 4.4,
      opts: { sharp: true, bevel: .18 },
      inOutline: [[3, 0], [4, 2.5], [3.2, 4.5], [2, 5], [-2.5, 5], [-3.6, 3.5], [-3, 1.2], [-2, 0]],
      outOutline: [[2, -1], [2.2, 2], [1, 5], [-1, 7], [-3.4, 6], [-4, 3.5], [-3.6, 1], [-2.4, -1]]
    },
    // Forked, with the notch between the lobes - the one detail that says
    // "fish" from behind, which is the angle he usually sees it from.
    tail: { f: 15, up: 0, thick: .7, droop: 0, opts: { sharp: true, bevel: .18 },
            outline: [[0, -2.5], [3, -10], [9, -14], [10, -6], [5.5, 0],
                      [10, 6], [9, 14], [3, 10], [0, 2.5]] },
    col: { coat: 0x5b9ec6, belly: 0xd3e8f2, wing: 0x8fcbe4, wingTip: 0xb4e0f0,
           eye: 0x14212e, tail: 0x8fcbe4 },
    // The dorsal, standing up on edge - the one fin you see from the bank.
    extra: (j, mat, C) => {
      const d = panel([[4.5, 0], [5, 3], [2, 6], [-1, 7], [-5, 4.5], [-5, 1.5], [-3, 0]], .6, C.wing, { sharp: true, bevel: .18 });
      attach(j.body, [at(d, 0, 9, 0)], mat);
    }
  },

  critterbat: {
    scale: .34, hover: 30,
    body: { len: 16, deep: 5, prof: [[0, 0], [2, 1], [4, 4], [4.5, 8], [4, 12], [2.5, 15], [0, 16]] },
    neck: { f: 5, up: 2, len: 2, r: 2.4 },
    head: { len: 9, prof: [[0, 0], [3.4, 1], [4.2, 3], [3.4, 6], [2, 8], [0, 9]],
            nose: [4.0, -.4, 0, .8], eye: [2.6, 1.1, 1.8, .7] },
    ears: { type: 'long', r: 2.2, len: 8, at: [-.8, 3.4, 1.8], flare: .3, lean: -.25 },
    wing: {
      at: [0, 2, 2.5], inner: 13, thick: 1.0, rest: .18, restTip: -.30, flap: .95, rate: 9,
      inOutline: [[5, 0], [6, 4], [5.5, 9], [4, 12.5], [3, 13],
                  [-5, 13], [-6.5, 12.5], [-8, 8], [-7, 3], [-5, 0]],
      outOutline: [[3, -2], [1.5, 4], [-1, 10], [-4, 16], [-5.5, 18],
                   [-7, 17], [-9, 12], [-9, 6], [-8, 1], [-5, -2]]
    },
    tail: { f: 7, up: -1, len: 5, r: 1.2, droop: .6 },
    col: { coat: 0x4a3f5c, belly: 0x5f5273, wing: 0x3b3249, wingTip: 0x322a3e,
           eye: 0xf1d36a, ear: 0x3b3249, nose: 0x241e2e, tail: 0x3b3249 }
  }
});

/* ---------------------------------------------------------------------------
   THE ONES THAT ARE NOT ANIMALS AT ALL

   A dust devil is not built like anything else in the game, because it has no
   body: it is a column of air with things caught up in it. And the Guardian is
   one eye the size of a cart, which is not a creature either.

   Both are written out rather than given sheets. A sheet earns its keep when
   there are several of a kind; there is one of each of these.
--------------------------------------------------------------------------- */
export function buildVortex() {
  const g = new THREE.Group();
  const mat = figureMat();

  /* Rings, widest at the top and tightening to nothing at the ground, each
     turned a little further round than the one below. The twist is the whole
     illusion: a stack of rings all facing the same way is a lampshade. */
  const parts = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const r = 5 + t * t * 26;
    const ring = turned([
      [r * .72, 0], [r, 1.2], [r * 1.02, 5.5], [r * .86, 7],
      [r * .66, 6.4], [r * .74, 2.4]
    ], i % 2 ? 0x8a7a62 : 0x776850, 16, ragged(2.2, 2.0));
    ring.rotateY(t * 5.2);
    ring.scale(1, 1, .82 + t * .2);
    parts.push(at(ring, t * 3, 4 + t * 52, 0));
  }
  const col = new THREE.Mesh(mergeGeometries(parts), mat);
  col.castShadow = true;
  g.add(col);

  // Two lights somewhere up inside it, which is all there is of a face.
  const eyes = [];
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), glow(0xf0c060, 2.2));
    e.position.set(17, 46, side * 5.5);
    g.add(e);
    eyes.push(e);
  }

  // Grit going round with it, so the turn is visible even when it is still.
  const grit = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + (i % 3) * .5, 0),
      lit({ color: i % 2 ? 0x9a8a70 : 0x6e6050, roughness: 1 }));
    const a = i * 2.39, rad = 10 + t * 22;
    b.position.set(Math.cos(a) * rad, 10 + t * 46, Math.sin(a) * rad);
    grit.add(b);
  }
  g.add(grit);

  g.userData = { eyes, spin: col, grit, height: 62 };
  return inkGroup(g);
}

export function buildGuardian() {
  const g = new THREE.Group();
  const mat = figureMat();

  /* A shell in two halves, parted, with the eye between them. Parted rather
     than whole because a closed ball is a rock, and what makes this read as
     something awake is that it has OPENED. */
  const shellCol = 0x3b3560, rimCol = 0x554d86;
  for (const s of [1, -1]) {
    const half = turned([
      [4, 0], [22, 2], [27, 10], [26, 20], [18, 26],
      [17, 24], [24, 19], [25, 10], [20, 5], [4, 3]
    ], s > 0 ? rimCol : shellCol, 22);
    /* TURNED over, not mirrored. Scaling y by minus one is the obvious way to
       get the lower half from the upper and it reflects the solid: every face
       ends up wound backwards, and the half simply is not drawn. The same
       mistake the wings are built to avoid, made again here. */
    if (s < 0) half.rotateX(Math.PI);
    half.rotateZ(s * .34);
    const m = new THREE.Mesh(half, mat);
    m.position.y = 40 + s * 15;
    m.castShadow = true;
    g.add(m);
  }

  const eyeball = new THREE.Mesh(new THREE.SphereGeometry(17, 24, 18),
    lit({ color: 0xe8e4f4, roughness: .3 }));
  eyeball.position.y = 40;
  eyeball.castShadow = true;
  g.add(eyeball);

  const iris = new THREE.Mesh(new THREE.SphereGeometry(9, 18, 14), glow(0xf5d76e, 2.4));
  iris.scale.set(.5, 1, 1);
  iris.position.set(13, 40, 0);
  g.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 10), glow(0x1a0f26, 1));
  pupil.scale.set(.5, 1, 1);
  pupil.position.set(16.2, 40, 0);
  g.add(pupil);

  // The shards it took, still going round it.
  const ring = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const sh = new THREE.Mesh(new THREE.OctahedronGeometry(5), glow(0xc8b4ff, 2.2));
    const a = i * (Math.PI * 2 / 7);
    sh.position.set(Math.cos(a) * 44, Math.sin(a * 2) * 6, Math.sin(a) * 44);
    sh.rotation.set(a, a * 1.7, 0);
    ring.add(sh);
  }
  ring.position.y = 40;
  g.add(ring);

  const light = new THREE.PointLight(0xc8b4ff, 2.2, 700, 2);
  light.position.y = 40;
  g.add(light);

  g.userData = { eyes: [iris], ring, iris, pupil, height: 72 };
  g.scale.setScalar(1.35);
  return inkGroup(g);
}

/* A hedgehog's back. Spines laid in rows over the barrel, each one leaning the
   way the back falls away, so the silhouette is a bank of points rather than a
   lump with texture on it. They are merged into one shape - there are sixty of
   them and every separate shape is another thing to draw. */
function spikes(s, dark) {
  const out = [], L = s.body.len, prof = s.body.prof;
  const widest = prof.reduce((a, p) => Math.max(a, p[0]), 0);
  for (let row = 0; row < 7; row++) {
    const along = .16 + row * .115;                 // where down the back this row sits
    const x = -L / 2 + along * L;
    // how fat the body is here, read straight off its own outline
    let r = 0;
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1], b = prof[i], y = along * L;
      if (y >= a[1] && y <= b[1]) { const t = (y - a[1]) / ((b[1] - a[1]) || 1); r = a[0] + (b[0] - a[0]) * t; break; }
    }
    if (!r) r = widest * .8;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = -1.15 + (i / (n - 1)) * 2.30;       // across the back, not down the sides
      const len = 7.5 * (.72 + .28 * Math.cos(a)) * (1 - Math.abs(along - .45));
      const g = spindle([[0, 0], [1.25, len * .22], [.7, len * .66], [0, len]], dark, 7);
      // lean it back and outward, the way a real spine lies
      g.rotateZ(.55);            // leaning back toward the tail
      g.rotateX(a * .78);
      out.push(at(g, x, Math.cos(a) * r * .86, Math.sin(a) * r * .96));
    }
  }
  return [mergeGeometries(out)];
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

/* A creature or a monster is looked up by its id. If it has a sheet it is
   drawn from the sheet; if it does not, it falls back to the two-spheres-and-
   horns shape everything used to be, so a half-finished bestiary still runs.
   The viewer says which is which, so it is obvious what is left. */
export function buildCreature(c) {
  const id = typeof c === 'string' ? null : c && c.id;
  const g = id && drawFromSheet(id);
  if (g) {
    // Creatures carry a light above them; it is how you spot one at night.
    const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), glow(0xffffff, 2.2));
    spark.position.y = g.userData.height + 14;
    g.add(spark);
    g.userData.spark = spark;
    return g;
  }
  return blobCreature(typeof c === 'string' ? c : (c && c.kind));
}

function blobCreature(kind) {
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

export function buildMonster(m) {
  const boss = m === true || !!(m && m.boss);
  return (m && m.id && drawFromSheet(m.id)) || blobMonster(boss);
}

/* The one place that knows which builder an id belongs to. Adding an animal is
   a row in BEASTS or FLIERS and nothing else - no dispatch to remember, and
   `drawn()` below reads the same two tables, so the viewer cannot disagree
   with the game about what has been drawn. */
function drawFromSheet(id) {
  if (BEASTS[id]) return buildBeast(BEASTS[id]);
  if (FLIERS[id]) return buildFlier(FLIERS[id]);
  if (UPRIGHT[id]) return buildUpright(UPRIGHT[id]);
  if (BUGS[id]) return buildBug(BUGS[id]);
  if (id === 'dustdevil') return buildVortex();
  if (id === 'guardian') return buildGuardian();
  return null;
}

function blobMonster(boss) {
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
  /* Frogs, rabbits and bats. They are the same animals as the ones that fight,
     drawn at a third of the size, so they are the same sheets - which is the
     whole argument for sheets. A rabbit reads as a rabbit at twenty units tall
     or at seventy; it does not read at all as a sphere with a nose. */
  const g = drawFromSheet('critter' + kind);
  if (g) return g;
  return blobCritter(kind);
}

function blobCritter(kind) {
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
/* The cast, in the order it is worth looking at: him and Luna, then the six
   creatures, then the sixteen monsters, then the small wildlife. The names and
   ids are the game's own - if a monster is added to index.html and given a
   sheet here, it turns up in the viewer without anybody remembering to add it
   in a second place. `note` says whether it has been drawn yet, so it is never
   a mystery which of these are finished. */
const CREATURE_LIST = [
  ['mossling', 'Mossling', 'forest'], ['brookfin', 'Brookfin', 'water'],
  ['sunmoth', 'Sunmoth', 'sky'], ['larkspark', 'Larkspark', 'spark'],
  ['stonepup', 'Stonepup', 'stone'], ['glimmercat', 'Glimmercat', 'magic']
];
const MONSTER_LIST = [
  ['thornback', 'Thornback'], ['bramblebear', 'Bramblebear'], ['bogling', 'Bogling'],
  ['owlshade', 'Owl Shade'], ['shadowbat', 'Shadow Bat'], ['dusthare', 'Dust Hare'],
  ['dustdevil', 'Dust Devil'], ['thistlebull', 'Thistle Bull'], ['scarecrow', 'Old Scarecrow'],
  ['haywraith', 'Hay Wraith'], ['golem', 'Stone Golem'], ['tombbeetle', 'Tomb Beetle'],
  ['rubblecrab', 'Rubble Crab'], ['shadehound', 'Shade Hound'], ['nightfox', 'Night Fox'],
  ['guardian', 'Gate Guardian', true]
];
const drawn = id => (BEASTS[id] || FLIERS[id] || UPRIGHT[id] || BUGS[id]
  || id === 'dustdevil' || id === 'guardian')
  ? 'drawn from its own sheet' : 'not yet drawn — still the old shape';

export const FIGURES = [
  { id: 'player', name: 'The Wanderer', note: 'rebuilt on the kit', make: () => buildPlayer() },
  { id: 'luna', name: 'Luna', note: 'rebuilt on the kit', make: () => buildLuna() },
  ...CREATURE_LIST.map(([id, name, kind]) => ({
    id, name: name + ' (creature)', note: drawn(id), make: () => buildCreature({ id, kind })
  })),
  ...MONSTER_LIST.map(([id, name, boss]) => ({
    id, name, note: drawn(id), make: () => buildMonster({ id, boss: !!boss })
  })),
  ...['frog', 'rabbit', 'bat'].map(k => ({
    id: k, name: k[0].toUpperCase() + k.slice(1) + ' (critter)',
    note: drawn('critter' + k), make: () => buildCritter(k)
  }))
];
