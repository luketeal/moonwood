/* ---------------------------------------------------------------------------
   DRAWING MOONWOOD

   The game still thinks in a flat map: everything has an x, a y and a heading.
   This file is the only part that knows the world is round-shouldered and lit.
   It takes the game's state once a frame and paints it.

   What does the work here, in order of how much it matters to how it looks:

     the moon        one directional light, low and cold, casting real shadows
     the fog         distance eats colour, so far trees go blue and soft
     the bloom       anything brighter than daylight spills - shards, fires, the
                     gate, the moon itself
     the ground      rolling rather than flat, with the paths and the river cut
                     into it rather than painted on top

   Each land is built the first time it is walked into and then kept, so going
   back through the gate is instant.
--------------------------------------------------------------------------- */
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import * as W from './world3d.js';

/* ---------------------------------------------------------------------------
   THE THREE MOODS

   The same moon hangs over all three lands - it is one night - but it sits at a
   different height and a different colour over each, and that, with the fog and
   the exposure, is what makes them feel like different places rather than the
   same wood painted three colours.

     el     how high the moon sits. Low means long raking shadows and a lot of
            sky; high means short shadows and nowhere to hide
     fog    how fast distance eats the picture. Moonwood is close and enclosed,
            Sunfield is open and you can see across it, the Ruins are smothered
     wind   how hard the grass leans
     mist   whether the ground holds mist that drifts about his knees
--------------------------------------------------------------------------- */
const MOOD = {
  moonwood: {          // a cold clear night under pines
    az: 2.30, el: 0.62, key: 0xbcd6ff, keyI: 3.4, moonCol: [0.93, 0.95, 1.00], moonGain: 6.0,
    hemiSky: 0x4878c4, hemiGnd: 0x22422f, hemiI: 1.95, rim: 0x6f86c8, rimI: 0.85,
    fog: 0.00135, exposure: 1.30, wind: 0.3, undergrowth: 1.0, mist: 0
  },
  sunfield: {          // a big warm low moon over open country, almost dusk
    az: 2.55, el: 0.30, key: 0xffcf9a, keyI: 3.2, moonCol: [1.00, 0.88, 0.70], moonGain: 7.0,
    hemiSky: 0x8f6fa8, hemiGnd: 0x5c5a2e, hemiI: 2.00, rim: 0xd6a173, rimI: 0.70,
    fog: 0.00075, exposure: 1.36, wind: 0.75, undergrowth: 1.7, grass: 1.35, mist: 0
  },
  ruins: {             // high, colourless and smothered
    az: 2.10, el: 0.75, key: 0x9db4d8, keyI: 2.1, moonCol: [0.86, 0.90, 0.98], moonGain: 4.0,
    hemiSky: 0x3d4c68, hemiGnd: 0x2c2b2f, hemiI: 1.55, rim: 0x55647e, rimI: 0.55,
    fog: 0.00175, exposure: 1.27, wind: 0.1, undergrowth: 0.55, mist: 1
  }
};
const KEY = new THREE.Vector3();          // which way the moonlight comes from, now
let mood = MOOD.moonwood;
function aimKey(m) {
  KEY.set(Math.cos(m.el) * Math.cos(m.az), Math.sin(m.el), Math.cos(m.el) * Math.sin(m.az)).normalize();
}
aimKey(mood);

const QUALITY = {
  high: { shadow: 1536, bloom: true, dpr: 2, undergrowth: 4200, shadowDist: 660 },
  med: { shadow: 1024, bloom: true, dpr: 1.75, undergrowth: 1800, shadowDist: 520 },
  low: { shadow: 0, bloom: false, dpr: 1.3, undergrowth: 900, shadowDist: 0 }
};

export function createRenderer(canvas, opts) {
  const curveOf = opts.curveOf;
  let quality = opts.quality || 'high';
  let Q = QUALITY[quality];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x06080f, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;   // counted by hand, so the post passes are included

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 8, 7000);

  /* -------------------------------------------------------------------------
     THE SKY

     One inside-out ball that travels with the camera, painted by a small shader
     rather than a picture: dark overhead, paler at the horizon, and the moon
     burned into it with a wash of light around it.
  ------------------------------------------------------------------------- */
  const skyUniforms = {
    topCol: { value: new THREE.Color(0x060a16) },
    lowCol: { value: new THREE.Color(0x26365a) },
    fogCol: { value: new THREE.Color(0x26365a) },
    moonDir: { value: KEY.clone() },
    moonCol: { value: new THREE.Color(0.93, 0.95, 1.0) },
    // How fiercely the moon burns. Full strength in the sky you look at; turned
    // right down for the copy that gets baked into the reflection map, because
    // a mirror-bright moon lying on the water is blinding at the one angle where
    // it lines up.
    moonGain: { value: 6.0 }
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3200, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topCol, lowCol, fogCol, moonDir, moonCol;
        uniform float moonGain;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 col = mix(lowCol, topCol, pow(clamp(h, 0.0, 1.0), 0.55));
          col = mix(fogCol, col, smoothstep(-0.05, 0.14, h));
          float m = max(dot(d, normalize(moonDir)), 0.0);
          col += moonCol * pow(m, 340.0) * moonGain;                 // the moon
          col += moonCol * 0.6 * pow(m, 9.0) * 0.16;                 // the wash around it
          gl_FragColor = vec4(col, 1.0);
        }`
    })
  );
  sky.renderOrder = -1000;
  scene.add(sky);

  // Stars, on the same ball. They are points rather than shader tricks so they
  // stay crisp and never shimmer when he turns.
  const starGeo = new THREE.BufferGeometry();
  {
    const n = 520, pos = new Float32Array(n * 3), bright = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const az = i * 2.399963, el = 0.04 + ((i * 37) % 100) / 100 * 1.2;
      const ce = Math.cos(el);
      pos[i * 3] = Math.cos(az) * ce * 3000;
      pos[i * 3 + 1] = Math.sin(el) * 3000;
      pos[i * 3 + 2] = Math.sin(az) * ce * 3000;
      bright[i] = .25 + ((i * 17) % 70) / 100;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
  }
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float bright; varying float vB;
      void main(){ vB = bright; gl_PointSize = 1.0 + bright * 1.6;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying float vB;
      void main(){ gl_FragColor = vec4(vec3(0.89,0.92,1.0) * vB, 1.0); }`
  }));
  stars.renderOrder = -999;
  scene.add(stars);

  /* -------------------------------------------------------------------------
     THE SKY, AS SOMETHING TO REFLECT

     The night sky is baked into a small reflection map once per land. It does
     two jobs: the river gets a real sky and a real moon lying on it, and every
     other surface picks up a little cold light from above, which is most of the
     difference between "flat colour" and "lit".
  ------------------------------------------------------------------------- */
  let pmrem = null, envRT = null;
  function bakeSky() {
    if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
    if (envRT) envRT.dispose();
    const envScene = new THREE.Scene();
    const ball = new THREE.Mesh(sky.geometry, sky.material);
    envScene.add(ball);
    skyUniforms.moonGain.value = mood.moonGain * 0.15;
    envRT = pmrem.fromScene(envScene, 0, 100, 6000);
    skyUniforms.moonGain.value = mood.moonGain;
    scene.environment = envRT.texture;
    scene.environmentIntensity = 1.0;
  }

  /* -------------------------------------------------------------------------
     THE LIGHT
  ------------------------------------------------------------------------- */
  const moon = new THREE.DirectionalLight(0xbcd6ff, 3.4);
  moon.castShadow = true;
  moon.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
  moon.shadow.camera.near = 20;
  moon.shadow.camera.far = 2600;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 1.2;
  moon.shadow.intensity = 0.52;
  scene.add(moon, moon.target);

  const hemi = new THREE.HemisphereLight(0x4878c4, 0x22422f, 1.95);
  scene.add(hemi);

  // A second, much weaker light from the far side. Nothing in a night wood is
  // lit from there - it is here so that trees keep an edge against the trees
  // behind them instead of merging into one dark mass.
  const rim = new THREE.DirectionalLight(0x6f86c8, 0.85);
  rim.position.copy(KEY).multiplyScalar(-1).setY(0.45).normalize().multiplyScalar(1000);
  scene.add(rim);

  /* The soft light that travels with him. Nothing in the story is casting it,
     so it has no business making a reflection: on water it was burning a hole
     in the picture wherever he walked near the river. Everything except the
     water is also on WET's layer; the water is ONLY on it, and this one light
     is not, so it lights the world and leaves the river alone. */
  const WET = 1;
  const heroGlow = new THREE.PointLight(0x9dbcff, 2600, 380, 2);
  scene.add(heroGlow);
  camera.layers.enable(WET);
  rim.layers.enable(WET);

  // The sky light gets its own, quieter copy for the water. Looked at along its
  // length a smooth surface mirrors nearly everything that lands on it, which is
  // true and also a white screen, so the river is given rather less to mirror.
  const hemiOnWater = new THREE.HemisphereLight(0x4878c4, 0x22422f, 0.55);
  hemiOnWater.layers.set(WET);
  scene.add(hemiOnWater);

  /* The moon does NOT light the water directly. A directional light on a
     surface this smooth puts a mirror of itself on it, and at the one heading
     where that lines up with the camera it is a white hole in the screen -
     which is exactly what it was doing on the riverbank. The water gets its own
     moon instead, a sixth of the strength, so there is a glimmer and a moonpath
     but nothing to look away from. The soft reflection of the whole sky still
     comes from the reflection map, which is where it should come from. */
  const moonOnWater = new THREE.DirectionalLight(0xbcd6ff, 0.17);
  moonOnWater.position.copy(KEY).multiplyScalar(1000);
  moonOnWater.layers.set(WET);
  scene.add(moonOnWater);

  // Four lamps, moved about each frame to whichever fires, shards and gates are
  // nearest. Keeping the COUNT fixed matters: adding or removing a light makes
  // the browser rebuild every shader, and that is a visible hiccup.
  const lampPool = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 700, 2);
    l.visible = true;
    l.layers.enable(WET);
    scene.add(l);
    lampPool.push(l);
  }

  /* -------------------------------------------------------------------------
     MIST

     Five big sheets of cloud lying flat at about knee and waist height, drifting
     at different speeds and turning against each other. They travel with the
     camera, so he is always walking through them rather than up to them. It is
     the cheapest thing in this whole file and it does more for the Ruins than
     anything else in it.
  ------------------------------------------------------------------------- */
  let mistTex = null;
  function mistTexture() {
    if (mistTex) return mistTex;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const px = (i * 97.3) % 256, py = (i * 151.7) % 256, r = 16 + (i * 37) % 44;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, 6.3); x.fill();
    }
    // Fade the sheet away at its own edges, so you never see where it stops.
    x.globalCompositeOperation = 'destination-in';
    const e = x.createRadialGradient(128, 128, 26, 128, 128, 126);
    e.addColorStop(0, 'rgba(255,255,255,1)');
    e.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = e; x.fillRect(0, 0, 256, 256);
    mistTex = new THREE.CanvasTexture(c);
    return mistTex;
  }

  const mist = { group: new THREE.Group(), sheets: [] };
  for (let i = 0; i < 5; i++) {
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(1900, 1900),
      new THREE.MeshBasicMaterial({
        map: mistTexture(), color: 0xc3cede, transparent: true, opacity: .06,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 26 + i * 24;
    sheet.renderOrder = 3;
    mist.group.add(sheet);
    mist.sheets.push({ m: sheet, spin: (i % 2 ? 1 : -1) * (.006 + i * .004), drift: 26 + i * 15 });
  }
  mist.group.visible = false;
  scene.add(mist.group);

  /* -------------------------------------------------------------------------
     THE PICTURE PASSES
  ------------------------------------------------------------------------- */
  let composer = null, bloomPass = null;
  function buildComposer() {
    if (composer) composer.dispose();
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // The threshold sits ABOVE white on purpose. Only things that are genuinely
    // brighter than daylight - the shards, the fires, the fireflies, the moon -
    // are built that bright, so only they bloom. Lit surfaces never do, however
    // brightly the moon happens to be catching them, which is what stopped the
    // river turning into a white hole when you look along it.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 1.05);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  if (Q.bloom) buildComposer();

  /* -------------------------------------------------------------------------
     A LAND, BUILT ONCE

     Trees, rocks and grass all go into instanced meshes: one shape, one
     material, hundreds of copies, one draw call. That is what lets a Moonwood
     with six hundred pines in it run on a phone.
  ------------------------------------------------------------------------- */
  /* Grass leans. The lean is worked out in the shader from where each blade
     stands, so a whole field of it costs nothing extra to move - and it is
     turned back into a world direction first, otherwise every clump leans
     whichever way it happens to be facing and the field shimmers instead of
     bending one way together. */
  const windMats = [];
  function windify(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uWind = { value: 0 };
      mat.userData.sh = sh;
      sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float _ph = instanceMatrix[3].x * .011 + instanceMatrix[3].z * .008;
           float _h  = clamp(transformed.y / 17.0, 0.0, 2.0);
           float _s  = (sin(uTime * 1.9 + _ph) + .4 * sin(uTime * 3.6 + _ph * 1.7)) * uWind * _h * 2.6;
           vec2 _w   = vec2(_s, _s * .45);
           transformed.x += dot(normalize(instanceMatrix[0].xyz).xz, _w);
           transformed.z += dot(normalize(instanceMatrix[2].xyz).xz, _w);
         #endif`
      );
    };
    mat.customProgramCacheKey = () => 'wind';
    windMats.push(mat);
    return mat;
  }

  const builtLands = {};
  const dummy = new THREE.Object3D();
  const tmpCol = new THREE.Color();

  function instanced(geo, mat, count, shadows) {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    m.castShadow = !!shadows;
    m.receiveShadow = !!shadows;
    m.frustumCulled = false;   // one mesh covers the whole land, so never cull it
    return m;
  }

  function placeTrees(list, geo, mat, terrain, heightOf, root) {
    if (!list.length) return null;
    const mesh = instanced(geo, mat, list.length, true);
    const cols = new Float32Array(list.length * 3);
    list.forEach((t, i) => {
      const s = t.s * heightOf / W.TREE_H;
      dummy.position.set(t.x, terrain.height(t.x, t.y) - 2, t.y);
      dummy.rotation.set(0, (t.x * 0.7 + t.y * 1.3) % 6.283, 0);
      dummy.scale.set(s, s * (0.9 + ((t.x * 7 + t.y) % 40) / 160), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // A little colour drift, so no two trees are quite the same green.
      const n = ((t.x * 13 + t.y * 7) % 100) / 100;
      tmpCol.setRGB(0.86 + n * 0.3, 0.9 + n * 0.22, 0.88 + n * 0.28);
      tmpCol.toArray(cols, i * 3);
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
    root.add(mesh);
    return mesh;
  }

  function buildLand(L) {
    const t0 = performance.now();
    const root = new THREE.Group();
    const terrain = W.makeTerrain(L, curveOf);
    const ground = W.groundMesh(L, terrain, quality);
    root.add(ground);

    const water = terrain.hasWater ? buildWater(L) : null;
    if (water) root.add(water);

    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, flatShading: true });
    const windMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }));
    const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, flatShading: true });

    // Trees. Moonwood mixes pines with round ones; the Ruins only has dead ones.
    const all = L.trees.concat(L.scenery);
    const dead = all.filter(t => t.dead), pines = all.filter(t => !t.dead && t.pine), round = all.filter(t => !t.dead && !t.pine);
    placeTrees(pines, W.pineGeometry(), leafMat, terrain, 4.6, root);
    placeTrees(round, W.broadleafGeometry(), leafMat, terrain, 3.6, root);
    placeTrees(dead, W.deadTreeGeometry(), stoneMat, terrain, 3.6, root);

    // Rocks.
    if (L.rocks.length) {
      const rocks = instanced(W.rockGeometry(), stoneMat, L.rocks.length, true);
      L.rocks.forEach((r, i) => {
        dummy.position.set(r.x, terrain.height(r.x, r.y) - r.s * .07, r.y);
        dummy.rotation.set(((r.x % 17) / 17 - .5) * .4, (r.x * 1.7 + r.y) % 6.283, ((r.y % 13) / 13 - .5) * .4);
        dummy.scale.setScalar(r.s * .55);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
      });
      root.add(rocks);
    }

    // Whatever else the land grows, one instanced mesh per kind.
    const byType = {};
    for (const o of L.props) (byType[o.type] = byType[o.type] || []).push(o);
    for (const type in byType) {
      const list = byType[type];
      const soft = type === 'grass' || type === 'flower';
      const mesh = instanced(W.propGeometry(type), soft ? windMat : leafMat, list.length, !soft);
      // Standing stones all exactly the same height, all exactly upright, read as
      // a fence. Broken ones lean, and they broke at different heights.
      const lean = type === 'column' ? .1 : type === 'arch' ? .05 : 0;
      const tall = type === 'column' ? .8 : 0;
      list.forEach((o, i) => {
        const n = ((o.x * 7 + o.y * 13) % 100) / 100;
        dummy.position.set(o.x, terrain.height(o.x, o.y) - 1, o.y);
        dummy.rotation.set((n - .5) * lean, o.r, (((o.y * 5) % 100) / 100 - .5) * lean);
        dummy.scale.set(o.s, o.s * (tall ? .55 + n * tall : 1), o.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      root.add(mesh);
    }

    // The forest floor. The game's own tufts are sparse, so the renderer sows a
    // lot more of them in clumps - this is most of what makes the ground read as
    // ground rather than as a coloured surface.
    const tufts = [];
    const gm = L.grass.match(/[\d.]+/g) || [120, 140, 100];
    const grassCol = new THREE.Color().setRGB(gm[0] / 255, gm[1] / 255, gm[2] / 255, THREE.SRGBColorSpace);
    for (const t of L.tufts) tufts.push({ x: t.x, y: t.y, s: t.s / 9 });
    const sow = Math.round(Q.undergrowth * (MOOD[L.id] ? MOOD[L.id].undergrowth : 1));
    for (let i = 0; i < sow; i++) {
      const x = (i * 733.7) % L.w, y = (i * 419.3) % L.h;
      if (W.fbm(x / 340 + 5, y / 340 + 9, 2) < .46) continue;   // they grow in patches, not evenly
      if (terrain.height(x, y) < -12) continue;                 // and not in the river
      tufts.push({ x, y, s: (.95 + ((i * 11) % 70) / 100) * (MOOD[L.id] ? (MOOD[L.id].grass || 1) : 1) });
    }
    if (tufts.length) {
      const mesh = instanced(W.tuftGeometry(0xffffff), windify(new THREE.MeshStandardMaterial({
        color: grassCol.multiplyScalar(1.75), vertexColors: true, roughness: 1, flatShading: true
      })), tufts.length, false);
      tufts.forEach((t, i) => {
        dummy.position.set(t.x, terrain.height(t.x, t.y) - 1, t.y);
        dummy.rotation.set(0, (t.x + t.y) % 6.283, 0);
        dummy.scale.set(t.s, t.s * (.8 + ((t.x % 30) / 50)), t.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      root.add(mesh);
    }

    // The landmark.
    const landmark = W.buildLandmark(L.landmark.type);
    W.setPos(landmark, L.landmark.x, L.landmark.y, terrain.height(L.landmark.x, L.landmark.y) - 4);
    root.add(landmark);

    // The gate.
    const gate = W.buildGate();
    W.setPos(gate.group, L.gate.x, L.gate.y, terrain.height(L.gate.x, L.gate.y));
    root.add(gate.group);

    // Fireflies.
    const flies = buildFireflies(L, terrain);
    root.add(flies.points);

    const land = { root, terrain, landmark, gate, flies, water, actors: {} };
    buildActors(L, land);
    scene.add(root);
    root.visible = false;
    stat.buildMs = Math.round(performance.now() - t0);
    return land;
  }

  /* -------------------------------------------------------------------------
     WATER

     One sheet lying across the whole land, low enough that it only shows where
     the river has cut the ground away. The waves are done in the shader, and the
     surface normal is worked out from the same waves, so the moon's reflection
     actually moves with them.
  ------------------------------------------------------------------------- */
  function buildWater(L) {
    const apron = 1600;
    const geo = new THREE.PlaneGeometry(L.w + apron * 2, L.h + apron * 2, 150, 110);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a6480, roughness: .46, metalness: .08,
      transparent: true, opacity: .88
    });
    mat.envMapIntensity = .38;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 };
      mat.userData.shader = sh;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float dx = cos(position.x*0.021 + uTime*1.5)*0.0336
                   + cos((position.x+position.z)*0.013 + uTime*0.7)*0.0286;
          float dz = -cos(position.z*0.028 - uTime*1.1)*0.0364
                   + cos((position.x+position.z)*0.013 + uTime*0.7)*0.0286;
          objectNormal = normalize(vec3(-dx, 1.0, -dz));`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y += sin(position.x*0.021 + uTime*1.5)*1.6
                         + sin(position.z*0.028 - uTime*1.1)*1.3
                         + sin((position.x+position.z)*0.013 + uTime*0.7)*2.2;`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(L.w / 2, W.WATER_LEVEL, L.h / 2);
    mesh.layers.set(WET);
    mesh.renderOrder = 2;
    return mesh;
  }

  /* -------------------------------------------------------------------------
     FIREFLIES - points of light that drift, and bloom because they are brighter
     than anything else at ground level.
  ------------------------------------------------------------------------- */
  let flyTex = null;
  function softDot() {
    if (flyTex) return flyTex;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(.35, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    flyTex = new THREE.CanvasTexture(c);
    return flyTex;
  }

  function buildFireflies(L, terrain) {
    const n = L.fireflies.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const a = new THREE.Color(L.flies[0]), b = new THREE.Color(L.flies[1]);
    L.fireflies.forEach((f, i) => {
      (f.hue ? b : a).toArray(col, i * 3);
      f.base = terrain.height(f.x, f.y);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() } },
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 color; varying vec3 vC;
        void main(){
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(1100.0 / max(-mv.z, 1.0), 2.0, 15.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vC;
        void main(){
          float a = texture2D(map, gl_PointCoord).a;
          gl_FragColor = vec4(vC * 2.4, 1.0) * a;
        }`
    }));
    points.frustumCulled = false;
    return { points, list: L.fireflies, geo };
  }

  /* -------------------------------------------------------------------------
     EVERYTHING THAT MOVES OR CAN BE PICKED UP
  ------------------------------------------------------------------------- */
  function buildActors(L, land) {
    const A = land.actors;
    const h = (x, y) => land.terrain.height(x, y);

    A.player = W.buildPlayer();
    land.root.add(A.player);

    A.luna = null;
    A.creatures = {}; A.monsters = {}; A.critters = []; A.shards = {}; A.finds = {}; A.berries = {};

    for (const c of L.creatures) {
      const g = W.buildCreature(c.kind);
      W.setPos(g, c.x, c.y, h(c.x, c.y));
      g.rotation.y = (c.x % 6.283);
      land.root.add(g); A.creatures[c.id] = g;
    }
    for (const m of L.monsters) {
      const g = W.buildMonster(false);
      W.setPos(g, m.x, m.y, h(m.x, m.y));
      g.rotation.y = (m.x % 6.283);
      land.root.add(g); A.monsters[m.id] = g;
    }
    for (const c of L.critters) {
      const g = W.buildCritter(c.kind);
      W.setPos(g, c.x, c.y, h(c.x, c.y));
      land.root.add(g); A.critters.push({ g, c });
    }
    for (const s of L.shards) {
      const g = W.buildShard();
      W.setPos(g, s.x, s.y, h(s.x, s.y) + 40);
      land.root.add(g); A.shards[s.id] = g;
    }
    for (const f of L.finds) {
      const g = f.type === 'seed' ? W.buildSeed() : f.type === 'fire' ? W.buildFire()
        : f.type === 'stone' ? W.buildStone() : W.buildBoots();
      W.setPos(g, f.x, f.y, h(f.x, f.y) + (f.type === 'seed' ? 32 : 0));
      if (f.type === 'stone') g.rotation.y = (f.x % 6.283);
      land.root.add(g); A.finds[f.id] = g;
    }
    for (const b of L.berries) {
      const g = W.buildBerryBush();
      W.setPos(g, b.x, b.y, h(b.x, b.y));
      g.rotation.y = (b.x % 6.283);
      land.root.add(g); A.berries[b.id] = g;
    }
    A.boss = null;
  }

  /* -------------------------------------------------------------------------
     THE CAMERA

     The game works out where the camera wants to be; all that happens here is
     that it is pointed the right way and pulled in if a tree gets between it and
     him, which is the one thing that would otherwise leave him hidden.
  ------------------------------------------------------------------------- */
  let camPull = 1e4;          // how far back the trees are letting the camera sit

  function placeCamera(s) {
    const cam = s.cam, p = s.p, dt = s.dt || 1;

    // The camera is always looking at something: him, or - in a fight - the
    // point between him and the monster. Anything standing between the camera
    // and THAT is what has to be got out of the way.
    let tx = p.x, ty = p.y;
    if (s.battle) { tx = (p.x + s.battle.m.x) / 2; ty = (p.y + s.battle.m.y) / 2; }

    const dx = tx - cam.x, dy = ty - cam.y, dist = Math.hypot(dx, dy) || 1;
    const bx = dx / dist, by = dy / dist;
    const gnd = curLand ? curLand.terrain : null;
    const eyeZ = cam.z;
    const lookZ = (gnd ? gnd.height(tx, ty) : 0) + (s.battle ? 32 : cam.aim);

    let allow = dist;
    const trees = s.L.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const rx = t.x - cam.x, ry = t.y - cam.y;
      const along = rx * bx + ry * by;
      if (along < 40 || along > dist - 30) continue;
      // A tree beside the camera covers far more of the screen than one the
      // same width standing next to him, so what counts as "in the way" widens
      // the closer to the camera it is.
      const near = 1 - along / dist;
      if (Math.abs(rx * by - ry * bx) > t.s * .7 + 18 + 40 * near) continue;
      // The camera looks DOWN from well above his head, so most trees pass
      // harmlessly underneath the line of sight. Only one tall enough to break
      // that line is actually in the way.
      const sight = eyeZ + (lookZ - eyeZ) * (along / dist);
      const top = (gnd ? gnd.height(t.x, t.y) : 0) + t.s * (t.pine ? 4.6 : 3.6);
      if (top > sight) allow = Math.min(allow, along - 26);
    }
    // Never closer than a bit over half way in. Past that the cure is worse than
    // the tree: a camera in his pocket is more disorienting than a branch.
    allow = Math.max(dist * .55, allow);

    // Moving the camera straight to wherever the trees allow makes it jump every
    // time one passes the test - and in a wood, one always is. So it ducks in
    // quickly when something is in the way and drifts back out slowly after.
    const rate = camPull > allow ? .4 : .05;
    camPull += (allow - camPull) * (1 - Math.pow(1 - rate, dt));
    const use = Math.min(dist, camPull);
    const cx = tx - bx * use, cy = ty - by * use;

    const under = curLand ? curLand.terrain.height(cx, cy) : 0;
    const cz = Math.max(cam.z, under + 46);
    camera.position.set(cx, cz, cy);

    // Pointed AT what it is framing, rather than along a fixed heading. The flat
    // game could use a fixed heading because the camera never moved off its
    // circle; this one ducks in past trees, and from closer in the same heading
    // would look straight over the top of him.
    const aim = (curLand ? curLand.terrain.height(tx, ty) : 0) + (s.battle ? 32 : cam.aim);
    camera.lookAt(tx, aim, ty);
  }

  /* -------------------------------------------------------------------------
     ONE FRAME
  ------------------------------------------------------------------------- */
  let curLand = null, curId = null;
  const lampWants = [];

  const stat = { draws: 0, tris: 0, buildMs: 0 };

  function render(s) {
    const L = s.L, t = s.now / 1000;
    renderer.info.reset();

    if (curId !== L.id) {
      if (curLand) curLand.root.visible = false;
      curLand = builtLands[L.id] || (builtLands[L.id] = buildLand(L));
      curLand.root.visible = true;
      curId = L.id;
      skyUniforms.topCol.value.set(L.skyTop);
      skyUniforms.lowCol.value.set(L.skyLow);
      const fog = L.fog.split(',').map(Number);
      const fogCol = new THREE.Color().setRGB(fog[0] / 255, fog[1] / 255, fog[2] / 255, THREE.SRGBColorSpace);
      skyUniforms.fogCol.value.copy(fogCol);

      mood = MOOD[L.id] || MOOD.moonwood;
      aimKey(mood);
      skyUniforms.moonDir.value.copy(KEY);
      skyUniforms.moonCol.value.setRGB(mood.moonCol[0], mood.moonCol[1], mood.moonCol[2]);
      skyUniforms.moonGain.value = mood.moonGain;
      moon.color.setHex(mood.key);
      hemi.color.setHex(mood.hemiSky); hemi.groundColor.setHex(mood.hemiGnd);
      hemiOnWater.color.setHex(mood.hemiSky); hemiOnWater.groundColor.setHex(mood.hemiGnd);
      rim.color.setHex(mood.rim); rim.intensity = mood.rimI;
      rim.position.copy(KEY).multiplyScalar(-1).setY(0.45).normalize().multiplyScalar(1000);
      moonOnWater.position.copy(KEY).multiplyScalar(1000);
      renderer.toneMappingExposure = mood.exposure;
      mist.group.visible = mood.mist > 0;

      scene.fog = new THREE.FogExp2(0x000000, mood.fog);
      scene.fog.color.copy(fogCol);
      renderer.setClearColor(fogCol, 1);
      bakeSky();
    }

    const land = curLand, A = land.actors, terrain = land.terrain;
    const gh = (x, y) => terrain.height(x, y);
    const gh0 = (x, z) => terrain.height(x, z);   // scene x/z map straight onto map x/y

    placeCamera(s);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);

    if (mood.mist > 0) {
      const mx = camera.position.x, mz = camera.position.z;
      mist.group.position.set(mx, gh0(mx, mz), mz);
      for (const sh of mist.sheets) {
        sh.m.rotation.z = t * sh.spin;
        sh.m.position.x = Math.sin(t * .07) * sh.drift;
        sh.m.position.z = Math.cos(t * .05) * sh.drift;
        sh.m.material.opacity = mood.mist * (.052 + Math.sin(t * .23 + sh.drift) * .014);
      }
    }

    // The moon follows him about so its shadows are always crisp where he is.
    if (Q.shadow) {
      moon.target.position.set(s.p.x, gh(s.p.x, s.p.y), s.p.y);
      moon.position.copy(moon.target.position).addScaledVector(KEY, 1400);
      const d = Q.shadowDist;
      const c = moon.shadow.camera;
      c.left = -d; c.right = d; c.top = d; c.bottom = -d;
      c.updateProjectionMatrix();
    }

    // Him.
    const pz = gh(s.p.x, s.p.y);
    A.player.position.set(s.p.x, pz, s.p.y);
    heroGlow.position.set(s.p.x, pz + 150, s.p.y);
    A.player.rotation.y = W.yaw(s.p.a);
    {
      const step = Math.sin(s.p.bob), u = A.player.userData;
      u.legs[0].rotation.z = step * .55;
      u.legs[1].rotation.z = -step * .55;
      u.arms[0].rotation.z = -step * .45;      // arms swing against the legs
      u.arms[1].rotation.z = step * .45;
      u.cloak.position.y = 36 + Math.abs(step) * 1.6;
      u.cloak.rotation.z = Math.sin(s.p.bob * .5) * .05;
    }

    // Luna waits in Moonwood.
    if (s.npc.land === L.id) {
      if (!A.luna) {
        A.luna = W.buildLuna();
        W.setPos(A.luna, s.npc.x, s.npc.y, gh(s.npc.x, s.npc.y));
        land.root.add(A.luna);
      }
      A.luna.rotation.y = W.yaw(Math.atan2(s.p.y - s.npc.y, s.p.x - s.npc.x));
      A.luna.userData.orb.position.y = 54 + Math.sin(t * 2.6) * 2;
      A.luna.userData.orb.scale.setScalar(1 + Math.sin(t * 2.6) * .12);
    }

    // Creatures still to be found, monsters still standing.
    for (const c of L.creatures) {
      const g = A.creatures[c.id];
      g.visible = !s.discovered.has(c.id);
      if (!g.visible) continue;
      g.position.y = gh(c.x, c.y) + Math.sin(t * 2.4 + c.x) * 2;
      turnToward(g, c, s.p, 300, s.dt || 1);
      g.userData.spark.position.y = 52 + Math.sin(t * 3.3 + c.x) * 3;
    }
    for (const m of L.monsters) {
      const g = A.monsters[m.id];
      g.visible = !s.defeated.has(m.id);
      if (!g.visible) continue;
      g.position.y = gh(m.x, m.y) + Math.sin(t * 1.9 + m.x) * 2.5;
      turnToward(g, m, s.p, (s.battle && s.battle.m === m) ? 1e9 : 340, s.dt || 1);
      const pulse = .7 + Math.sin(t * 4 + m.x) * .3;
      for (const e of g.userData.eyes) e.scale.setScalar(pulse);
    }

    // The Guardian, which only exists once it has been woken.
    if (s.battle && s.battle.m.boss) {
      const m = s.battle.m;
      if (!A.boss) { A.boss = W.buildMonster(true); land.root.add(A.boss); }
      A.boss.visible = true;
      A.boss.position.set(m.x, gh(m.x, m.y) + Math.sin(t * 1.4) * 4, m.y);
      turnToward(A.boss, m, s.p, 1e9, s.dt || 1);
      if (A.boss.userData.ring) A.boss.userData.ring.rotation.y = t * .8;
    } else if (A.boss) A.boss.visible = false;

    // Frogs, rabbits and bats.
    for (const { g, c } of A.critters) {
      const ph = t * 3.8 + c.ph;
      g.position.set(c.x, gh(c.x, c.y) + Math.abs(Math.sin(ph)) * (3 + c.hop * 7), c.y);
      g.rotation.y = W.yaw(c.dir || 0);
      if (g.userData.wings) {
        const w = Math.sin(ph * 3) * .8;
        g.userData.wings[0].rotation.x = w;
        g.userData.wings[1].rotation.x = -w;
      }
    }

    // Shards turning in the air.
    for (const sh of L.shards) {
      const g = A.shards[sh.id];
      g.visible = !s.picked.has(sh.id);
      if (!g.visible) continue;
      g.position.y = gh(sh.x, sh.y) + 40 + Math.sin(t * 2 + sh.x) * 7;
      g.rotation.y = t * 1.1;
      g.rotation.x = Math.sin(t * .7) * .3;
    }

    // The small finds.
    for (const f of L.finds) {
      const g = A.finds[f.id];
      if (f.type === 'seed' || f.type === 'boots') g.visible = !s.found.has(f.id);
      if (!g.visible) continue;
      if (f.type === 'seed') {
        g.position.y = gh(f.x, f.y) + 32 + Math.sin(t * 2 + f.x) * 4;
        g.rotation.y = t * 1.6;
      } else if (f.type === 'fire') {
        const flick = .82 + Math.sin(t * 11 + f.x) * .12 + Math.sin(t * raw7(f.x)) * .06;
        g.userData.flame.scale.set(1, flick, 1);
        g.userData.core.scale.set(1, flick * 1.05, 1);
        g.userData.flame.rotation.y = t * 2.2;
      } else if (f.type === 'boots') {
        g.userData.spark.position.y = 34 + Math.sin(t * 2.4 + f.x) * 2;
      }
    }

    // Berry bushes lose their fruit when he eats them, and grow it back when he
    // leaves the land and comes back - so this is checked every frame.
    for (const b of L.berries) {
      const g = A.berries[b.id];
      if (g) g.userData.fruit.visible = !s.eaten.has(b.id);
    }

    // The gate brightens as the shards come home.
    {
      const lit = s.picked.size / 9, full = s.picked.size >= 9;
      const gate = land.gate;
      gate.portal.material.opacity = .22 + lit * .5;
      gate.portal.material.color.setHex(full ? 0xe8dcff : 0x6d5ab2);
      gate.light.intensity = (28 + lit * 420) * (1 + Math.sin(t * 1.6) * .06);
      gate.light.color.setHex(full ? 0xe0d2ff : 0xa08cf0);
    }

    if (land.landmark.userData.spin) land.landmark.userData.spin.rotation.z = t * .34;

    // Fireflies.
    {
      const pos = land.flies.geo.attributes.position.array;
      land.flies.list.forEach((f, i) => {
        const ph = t + f.ph;
        pos[i * 3] = f.x + Math.sin(ph) * 22;
        pos[i * 3 + 1] = f.base + f.z + Math.sin(ph * 1.7) * 9;
        pos[i * 3 + 2] = -(f.y + Math.cos(ph * .8) * 22);
      });
      land.flies.geo.attributes.position.needsUpdate = true;
    }

    // Water.
    for (const m of windMats) {
      if (!m.userData.sh) continue;
      m.userData.sh.uniforms.uTime.value = t;
      m.userData.sh.uniforms.uWind.value = mood.wind;
    }

    if (land.water && land.water.material.userData.shader) {
      land.water.material.userData.shader.uniforms.uTime.value = t;
    }

    /* The lamps. Campfires, shards, the gate and Luna all want to cast light;
       there are only four to go round, so the nearest win. */
    lampWants.length = 0;
    for (const f of L.finds) {
      if (f.type !== 'fire') continue;
      const flick = 1 + Math.sin(t * 11 + f.x) * .13;
      lampWants.push({ x: f.x, y: f.y, z: gh(f.x, f.y) + 26, c: 0xffa94d, i: 5200 * flick, d: 620 });
    }
    for (const sh of L.shards) {
      if (s.picked.has(sh.id)) continue;
      lampWants.push({ x: sh.x, y: sh.y, z: gh(sh.x, sh.y) + 46, c: 0xf7df78, i: 1300, d: 420 });
    }
    if (s.battle && s.battle.m.boss) {
      const m = s.battle.m;
      lampWants.push({ x: m.x, y: m.y, z: gh(m.x, m.y) + 90, c: 0xc0a6ff, i: 9000, d: 900 });
    }
    const cx = camera.position.x, cz = camera.position.z;
    for (const l of lampWants) l._d = (l.x - cx) * (l.x - cx) + (l.y - cz) * (l.y - cz);
    lampWants.sort((a, b) => a._d - b._d);
    for (let i = 0; i < lampPool.length; i++) {
      const want = lampWants[i];
      const lamp = lampPool[i];
      if (want && want._d < 1500 * 1500) {
        lamp.position.set(want.x, want.z, want.y);
        lamp.color.setHex(want.c);
        lamp.intensity = want.i;
        lamp.distance = want.d;
      } else lamp.intensity = 0;
    }

    /* A fight darkens the land around him: the moon drops back, the fog closes
       in, and what light is left is on the two of them. */
    const fighting = !!s.battle;
    moon.intensity += ((fighting ? mood.keyI * .38 : mood.keyI) - moon.intensity) * .08;
    if (!moonOnWater.userData.hold) moonOnWater.intensity = moon.intensity * .05;
    hemi.intensity += ((fighting ? mood.hemiI * .41 : mood.hemiI) - hemi.intensity) * .08;
    if (!hemiOnWater.userData.hold) hemiOnWater.intensity = hemi.intensity * .28;
    if (scene.fog) {
      const want = fighting ? mood.fog * 1.7 : mood.fog;
      scene.fog.density += (want - scene.fog.density) * .06;
    }

    if (composer && Q.bloom) composer.render();
    else renderer.render(scene, camera);
    stat.draws = renderer.info.render.calls;
    stat.tris = renderer.info.render.triangles;
  }

  // A tiny helper so the campfire flicker is not one clean sine wave.
  function raw7(x) { return 7 + (x % 5); }

  /* Everything that is built facing along its own +x turns to look at him when
     he is within `range` - and in a fight, always. It swings round rather than
     snapping, so a monster noticing him reads as it noticing him. */
  function turnToward(g, from, p, range, dt) {
    const dx = p.x - from.x, dy = p.y - from.y;
    if (dx * dx + dy * dy > range * range) return;
    const want = W.yaw(Math.atan2(dy, dx));
    let d = want - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * (1 - Math.pow(1 - .14, dt));
  }

  /* -------------------------------------------------------------------------
     SIZE, QUALITY AND THE WAY BACK OUT
  ------------------------------------------------------------------------- */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.dpr));
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    // Match the framing the flat game had, so nothing jumps.
    const f = Math.min(h * .95, w * 1.35);
    camera.fov = 2 * Math.atan((h / 2) / f) * 180 / Math.PI;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setQuality(q) {
    if (!QUALITY[q] || q === quality) return;
    quality = q; Q = QUALITY[q];
    renderer.shadowMap.enabled = !!Q.shadow;
    moon.castShadow = !!Q.shadow;
    if (Q.shadow) moon.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (Q.bloom && !composer) buildComposer();
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    resize();
  }

  // Where a spot in the world lands on the screen, for the name plates.
  const projV = new THREE.Vector3();
  function project(x, y, z) {
    projV.set(x, z || 0, y).project(camera);
    if (projV.z > 1) return null;
    return {
      x: (projV.x * .5 + .5) * canvas.clientWidth,
      y: (-projV.y * .5 + .5) * canvas.clientHeight
    };
  }

  function groundHeight(x, y) { return curLand ? curLand.terrain.height(x, y) : 0; }

  resize();
  // A look inside, for when something is not where it should be.
  function debug() {
    const i = renderer.info;
    const out = {
      land: curId, water: null, objects: 0, quality: quality,
      drawCalls: stat.draws, triangles: stat.tris, buildMs: stat.buildMs,
      geometries: i.memory.geometries, textures: i.memory.textures,
      programs: i.programs ? i.programs.length : 0
    };
    scene.traverse(o => {
      out.objects++;
      if (curLand && o === curLand.water) out.water = { y: o.position.y, visible: o.visible, frustum: o.frustumCulled };
    });
    return out;
  }

  // A way to switch one thing off at a time from the console, for when
  // something is too bright and it is not obvious what is doing it.
  function debugSet(what, v) {
    if (what === 'hero') heroGlow.intensity = v;
    else if (what === 'env') scene.environmentIntensity = v;
    else if (what === 'bloom' && bloomPass) bloomPass.strength = v ? 0.55 : 0;
    else if (what === 'water' && curLand && curLand.water) curLand.water.visible = !!v;
    else if (what === 'moonlight') moon.intensity = v;
    else if (what === 'rim') rim.intensity = v;
    else if (what === 'moonwater') { moonOnWater.intensity = v; moonOnWater.userData.hold = true; }
    else if (what === 'hemiwater') { hemiOnWater.intensity = v; hemiOnWater.userData.hold = true; }
  }

  return { render, resize, setQuality, project, groundHeight, debug, debugSet, get quality() { return quality; } };
}
