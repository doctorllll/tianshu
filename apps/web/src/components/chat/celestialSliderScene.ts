/** Tianshu's reasoning-effort scene: each level is a body on the way from stardust to a galaxy. */

import { GALAXY_SQUASH, GALAXY_TILT, type Rgb } from "./celestialParticles";

interface Occluder {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * `size` is the sprite's drawn size in CSS px; `occlude` is the dark disc (as fractions of the
 * sprite) laid under it so stars do not shine through the night side. `free` bodies are too big
 * for the track and spill out of it; `power` (0–1) is how hard their sparks and shocks hit.
 */
const CELESTIAL_STAGES = [
  {
    id: "stardust",
    line: "Stardust · barely thinking",
    accent: "#8fd3ff",
    size: 64,
    occlude: null,
    free: false,
    power: 0.15,
  },
  {
    id: "asteroid",
    line: "Asteroid · quick and light",
    accent: "#b9c4d6",
    size: 56,
    occlude: { x: 0.5, y: 0.46, r: 0.22 },
    free: false,
    power: 0.25,
  },
  {
    id: "planet",
    line: "Planet · steady reasoning",
    accent: "#5cc2ff",
    size: 56,
    occlude: { x: 0.475, y: 0.485, r: 0.325 },
    free: false,
    power: 0.4,
  },
  {
    id: "star",
    line: "Star · burning bright",
    accent: "#ffb547",
    size: 66,
    occlude: { x: 0.5, y: 0.5, r: 0.34 },
    free: true,
    power: 0.62,
  },
  {
    id: "blackhole",
    line: "Black hole · deep collapse",
    accent: "#ff7a3a",
    size: 150,
    occlude: { x: 0.5, y: 0.5, r: 0.14 },
    free: true,
    power: 0.88,
  },
  {
    id: "galaxy",
    line: "Galaxy · everything turns on the pivot",
    accent: "#b68cff",
    size: 150,
    occlude: null,
    free: true,
    power: 1,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  line: string;
  accent: string;
  size: number;
  occlude: Occluder | null;
  free: boolean;
  power: number;
}>;

export type CelestialStage = (typeof CELESTIAL_STAGES)[number];
export type CelestialStageId = CelestialStage["id"];

const byId = (id: CelestialStageId): CelestialStage =>
  CELESTIAL_STAGES.find((stage) => stage.id === id)!;

/** Asteroid always opens and a galaxy always closes; the bodies between fill in by count. */
const STAGES_BY_COUNT: Readonly<Record<number, ReadonlyArray<CelestialStageId>>> = {
  1: ["star"],
  2: ["asteroid", "galaxy"],
  3: ["asteroid", "star", "galaxy"],
  4: ["asteroid", "planet", "star", "galaxy"],
  5: ["asteroid", "planet", "star", "blackhole", "galaxy"],
  6: ["stardust", "asteroid", "planet", "star", "blackhole", "galaxy"],
};

export function celestialStagesFor(count: number): ReadonlyArray<CelestialStage> {
  const n = Math.max(1, Math.round(count));
  const fixed = STAGES_BY_COUNT[n];
  if (fixed) return fixed.map(byId);
  const last = CELESTIAL_STAGES.length - 1;
  return Array.from({ length: n }, (_, i) => CELESTIAL_STAGES[Math.round((i / (n - 1)) * last)]!);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The two stages around `ratio` and how far it is from the first to the second. */
export function celestialBlendAt(
  ratio: number,
  stages: ReadonlyArray<CelestialStage>,
): { readonly from: CelestialStage; readonly to: CelestialStage; readonly mix: number } {
  if (stages.length <= 1) return { from: stages[0]!, to: stages[0]!, mix: 0 };
  const position = clamp01(ratio) * (stages.length - 1);
  const index = Math.min(stages.length - 2, Math.floor(position));
  return { from: stages[index]!, to: stages[index + 1]!, mix: position - index };
}

export function celestialStageAt(
  ratio: number,
  stages: ReadonlyArray<CelestialStage>,
): CelestialStage {
  const { from, to, mix } = celestialBlendAt(ratio, stages);
  return mix < 0.5 ? from : to;
}

/** How hard the body at `ratio` hits, 0 to 1, blended between levels. */
export function celestialPowerAt(ratio: number, stages: ReadonlyArray<CelestialStage>): number {
  const { from, to, mix } = celestialBlendAt(ratio, stages);
  return from.power + (to.power - from.power) * mix;
}

export interface CelestialLayer {
  readonly stage: CelestialStage;
  /** Drawn size in CSS px. */
  readonly size: number;
  readonly weight: number;
}

/** The bodies at the knob: between levels the old one shrinks away as the next one grows in. */
export function celestialLayersAt(
  ratio: number,
  stages: ReadonlyArray<CelestialStage>,
  grip: number,
): ReadonlyArray<CelestialLayer> {
  const { from, to, mix } = celestialBlendAt(ratio, stages);
  const lift = 1 + grip * 0.06;
  if (from === to || mix <= 0) return [{ stage: from, size: from.size * lift, weight: 1 }];
  const ease = mix * mix * (3 - 2 * mix);
  return [
    { stage: from, size: from.size * lift * (1 - ease * 0.3), weight: 1 - ease },
    { stage: to, size: to.size * lift * (0.7 + ease * 0.3), weight: ease },
  ];
}

/** The galaxy turns in its own tilted plane, slowly, against the way its arms wind. */
const GALAXY_SPIN = -0.14;

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function celestialRgbAt(ratio: number, stages: ReadonlyArray<CelestialStage>): Rgb {
  const { from, to, mix } = celestialBlendAt(ratio, stages);
  const [ar, ag, ab] = hexToRgb(from.accent);
  const [br, bg, bb] = hexToRgb(to.accent);
  return [
    Math.round(ar + (br - ar) * mix),
    Math.round(ag + (bg - ag) * mix),
    Math.round(ab + (bb - ab) * mix),
  ];
}

export function celestialAccentAt(
  ratio: number,
  stages: ReadonlyArray<CelestialStage>,
  alpha = 1,
): string {
  const [r, g, b] = celestialRgbAt(ratio, stages);
  return `rgba(${r},${g},${b},${alpha})`;
}

const rgba = ([r, g, b]: Rgb, alpha: number) =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

/** Side of the canvases gradients are baked into; the gradients are soft, so they scale up cleanly. */
const BAKED_PX = 256;
const bakedGradients = new Map<string, HTMLCanvasElement | null>();

function bakedCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

/**
 * A radial gradient (from `inner` of the radius out) drawn once into a small canvas. Frames stamp
 * it and set its strength with globalAlpha instead of building the same gradient every frame.
 */
function bakedGradient(
  key: string,
  inner: number,
  stops: ReadonlyArray<readonly [offset: number, rgb: Rgb, alpha: number]>,
): HTMLCanvasElement | null {
  const cached = bakedGradients.get(key);
  if (cached !== undefined) return cached;
  const canvas = bakedCanvas(BAKED_PX, BAKED_PX);
  const c = canvas?.getContext("2d");
  if (canvas && c) {
    const half = BAKED_PX / 2;
    const fill = c.createRadialGradient(half, half, inner * half, half, half, half);
    for (const [offset, rgb, alpha] of stops) fill.addColorStop(offset, rgba(rgb, alpha));
    c.fillStyle = fill;
    c.fillRect(0, 0, BAKED_PX, BAKED_PX);
  }
  const sprite = canvas && c ? canvas : null;
  bakedGradients.set(key, sprite);
  return sprite;
}

/** Stamps a baked gradient centred on (x, y) out to `radius`, at `alpha` of its baked strength. */
function stamp(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement | null,
  x: number,
  y: number,
  radius: number,
  alpha: number,
) {
  if (!sprite || alpha <= 0.001 || radius <= 0) return;
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * Math.min(1, alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = base;
}

const featherMasks = new Map<string, HTMLCanvasElement | null>();

/**
 * The page-level canvas's edge fade as one mask, drawn once per size. Applied with destination-in
 * it fades all four edges in one pass, where two full-canvas gradient fills a frame did before.
 */
export function celestialFeatherMask(
  w: number,
  h: number,
  scale: number,
  feather: number,
): HTMLCanvasElement | null {
  const key = `${w}x${h}@${scale}/${feather}`;
  const cached = featherMasks.get(key);
  if (cached !== undefined) return cached;
  if (featherMasks.size > 4) featherMasks.clear();
  const canvas = bakedCanvas(w * scale, h * scale);
  const c = canvas?.getContext("2d");
  if (canvas && c) {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    const across = c.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, "rgba(0,0,0,0)");
    across.addColorStop(feather / w, "rgba(0,0,0,1)");
    across.addColorStop(1 - feather / w, "rgba(0,0,0,1)");
    across.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = across;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "destination-in";
    const down = c.createLinearGradient(0, 0, 0, h);
    down.addColorStop(0, "rgba(0,0,0,0)");
    down.addColorStop(feather / h, "rgba(0,0,0,1)");
    down.addColorStop(1 - feather / h, "rgba(0,0,0,1)");
    down.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = down;
    c.fillRect(0, 0, w, h);
  }
  const mask = canvas && c ? canvas : null;
  featherMasks.set(key, mask);
  return mask;
}

/** Public path of a body's render; the composer chip uses it too. */
export const celestialSpriteUrl = (id: CelestialStageId) => `/celestial/${id}.webp?v=2`;

const sprites = new Map<CelestialStageId, HTMLImageElement>();
const waiting = new Set<() => void>();

/** The body renders, loaded once; `onReady` fires as each arrives so a sleeping canvas repaints. */
export function celestialSprites(
  onReady?: () => void,
): ReadonlyMap<CelestialStageId, HTMLImageElement> {
  if (onReady) waiting.add(onReady);
  if (sprites.size === 0 && typeof Image !== "undefined") {
    for (const stage of CELESTIAL_STAGES) {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => {
        for (const wake of waiting) wake();
      });
      image.src = celestialSpriteUrl(stage.id);
      sprites.set(stage.id, image);
    }
  }
  return sprites;
}

export function forgetCelestialWake(onReady: () => void) {
  waiting.delete(onReady);
}

/** A seeded generator, so every fixed field (sky, debris, disk) is the same on each open. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface SkyStar {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly threshold: number;
  readonly phase: number;
  readonly speed: number;
}

function skyLayer(seed: number, count: number, big: number): ReadonlyArray<SkyStar> {
  const random = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: random(),
    y: random(),
    size: 0.3 + random() * random() * big,
    threshold: random(),
    phase: random() * Math.PI * 2,
    speed: 0.6 + random() * 2.4,
  }));
}

const FAR_SKY = skyLayer(0x7a3b19, 90, 0.8);
const NEAR_SKY = skyLayer(0x19c0de, 26, 1.5);

/** The Big Dipper across the track, handle to the left, bowl to the right; the last is Tianshu. */
const DIPPER: ReadonlyArray<readonly [number, number]> = [
  [0.07, 0.62],
  [0.2, 0.4],
  [0.33, 0.34],
  [0.46, 0.42],
  [0.6, 0.62],
  [0.8, 0.58],
  [0.86, 0.24],
];

export interface CelestialFrame {
  readonly w: number;
  readonly h: number;
  /** Where the knob is along the track, 0 to 1. */
  readonly ratio: number;
  readonly t: number;
  readonly stages: ReadonlyArray<CelestialStage>;
  readonly detents: ReadonlyArray<number>;
  readonly selected: number;
  readonly kx: number;
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  layer: ReadonlyArray<SkyStar>,
  w: number,
  h: number,
  shift: number,
  lit: number,
  t: number,
  bright: number,
) {
  for (const star of layer) {
    if (star.threshold > lit) continue;
    const twinkle = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
    const x = (((star.x * w + shift) % w) + w) % w;
    const y = 3 + star.y * (h - 6);
    dot(ctx, x, y, star.size, "rgb(222,232,255)", (0.18 + 0.6 * twinkle) * bright);
  }
}

function fillHorizonBody(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const radius = w * 3;
  const body = ctx.createLinearGradient(0, h * 0.78, 0, h);
  body.addColorStop(0, "rgba(10,14,30,0.92)");
  body.addColorStop(1, "rgba(2,3,8,1)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.8 + radius, radius, 0, Math.PI * 2);
  ctx.fill();
}

const horizonBodies = new Map<string, HTMLCanvasElement | null>();

/** The planet's dark body is the same for a track size, so it is drawn once per size. */
function horizonBody(w: number, h: number, scale: number): HTMLCanvasElement | null {
  const key = `${w}x${h}@${scale}`;
  const cached = horizonBodies.get(key);
  if (cached !== undefined) return cached;
  if (horizonBodies.size > 4) horizonBodies.clear();
  const canvas = bakedCanvas(w * scale, h * scale);
  const c = canvas?.getContext("2d");
  if (canvas && c) {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    fillHorizonBody(c, w, h);
  }
  const layer = canvas && c ? canvas : null;
  horizonBodies.set(key, layer);
  return layer;
}

/** A giant planet's limb low across the track, lit where the knob's body hangs over it. */
function drawHorizon(ctx: CanvasRenderingContext2D, w: number, h: number, kx: number, tint: Rgb) {
  const radius = w * 3;
  const cx = w / 2;
  const cy = h * 0.8 + radius;
  ctx.save();
  const scale = ctx.getTransform().a;
  const body = horizonBody(w, h, scale);
  if (body) ctx.drawImage(body, 0, 0, body.width / scale, body.height / scale);
  else fillHorizonBody(ctx, w, h);

  const lit = ctx.createLinearGradient(0, 0, w, 0);
  const at = clamp01(kx / w);
  lit.addColorStop(0, rgba(tint, 0.1));
  lit.addColorStop(Math.max(0, at - 0.22), rgba(tint, 0.18));
  lit.addColorStop(at, rgba(tint, 0.85));
  lit.addColorStop(Math.min(1, at + 0.22), rgba(tint, 0.18));
  lit.addColorStop(1, rgba(tint, 0.1));
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = lit;
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 1.5, Math.PI * 1.25, Math.PI * 1.75);
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI * 1.25, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();
}

const CLEAR: Rgb = [0, 0, 0];
const NEBULA_VIOLET = () =>
  bakedGradient("nebula-violet", 0, [
    [0, [118, 84, 255], 0.07],
    [1, CLEAR, 0],
  ]);
const NEBULA_BLUE = () =>
  bakedGradient("nebula-blue", 0, [
    [0, [40, 130, 255], 0.06],
    [1, CLEAR, 0],
  ]);

/** Everything behind the body: deep sky with parallax stars, nebula light, horizon, Dipper, marks. */
export function drawCelestialSky(ctx: CanvasRenderingContext2D, frame: CelestialFrame) {
  const { w, h, ratio, t, stages, detents, selected, kx } = frame;
  const tint = celestialRgbAt(ratio, stages);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#02040b");
  sky.addColorStop(1, "#070a19");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  stamp(ctx, NEBULA_VIOLET(), w * 0.84 + Math.sin(t * 0.07) * 8, h * 0.15, h * 2.4, 1);
  stamp(ctx, NEBULA_BLUE(), w * 0.18 + Math.cos(t * 0.05) * 8, h * 0.95, h * 2.1, 1);
  const near = ctx.createRadialGradient(kx, h * 0.45, 0, kx, h * 0.45, h * 2.8);
  near.addColorStop(0, rgba(tint, 0.16 + ratio * 0.1));
  near.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = near;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const lit = 0.35 + ratio * 0.65;
  drawStars(ctx, FAR_SKY, w, h, -(kx / w) * 8 - t * 0.9, lit, t, 0.75);
  drawStars(ctx, NEAR_SKY, w, h, -(kx / w) * 22 - t * 2.4, lit, t, 1);

  ctx.strokeStyle = "rgba(160,190,255,0.07)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  DIPPER.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * w, y * h);
    else ctx.lineTo(x * w, y * h);
  });
  ctx.lineTo(DIPPER[3]![0] * w, DIPPER[3]![1] * h);
  ctx.stroke();
  DIPPER.forEach(([x, y], index) => {
    const tianshu = index === DIPPER.length - 1;
    ctx.fillStyle = tianshu ? "rgba(255,206,110,0.7)" : "rgba(200,220,255,0.3)";
    ctx.beginPath();
    ctx.arc(x * w, y * h, tianshu ? 1.4 : 1, 0, Math.PI * 2);
    ctx.fill();
    if (tianshu) {
      const glint = 3.5 + Math.sin(t * 1.6) * 0.8;
      ctx.strokeStyle = "rgba(255,214,130,0.35)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x * w - glint, y * h);
      ctx.lineTo(x * w + glint, y * h);
      ctx.moveTo(x * w, y * h - glint);
      ctx.lineTo(x * w, y * h + glint);
      ctx.stroke();
    }
  });

  drawHorizon(ctx, w, h, kx, tint);

  // The orbit the knob runs on, lit up to the knob, with a mark at each level.
  const y = h / 2;
  const first = detents[0] ?? kx;
  const last = detents.at(-1) ?? kx;
  ctx.save();
  ctx.setLineDash([1.5, 3.5]);
  ctx.strokeStyle = "rgba(190,210,255,0.16)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(first, y);
  ctx.lineTo(last, y);
  ctx.stroke();
  ctx.setLineDash([]);
  const run = ctx.createLinearGradient(first, 0, Math.max(first + 1, kx), 0);
  run.addColorStop(0, rgba(tint, 0));
  run.addColorStop(1, rgba(tint, 0.55));
  ctx.strokeStyle = run;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(first, y);
  ctx.lineTo(kx, y);
  ctx.stroke();
  detents.forEach((x, index) => {
    if (Math.abs(x - kx) < 14) return;
    const reached = index <= selected;
    const stageTint = hexToRgb(stages[index]?.accent ?? "#ffffff");
    ctx.strokeStyle = reached ? rgba(stageTint, 0.7) : "rgba(200,215,255,0.22)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.fillStyle = reached ? rgba(stageTint, 0.95) : "rgba(200,215,255,0.35)";
    ctx.beginPath();
    ctx.arc(x, y, reached ? 1.3 : 1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

interface Orbiter {
  readonly a: number;
  readonly r: number;
  readonly s: number;
  readonly w: number;
  readonly phase: number;
}

function orbiters(
  seed: number,
  count: number,
  make: (random: () => number) => Orbiter,
): ReadonlyArray<Orbiter> {
  const random = seeded(seed);
  return Array.from({ length: count }, () => make(random));
}

const DEBRIS = orbiters(0xa57e01d, 16, (random) => ({
  a: random() * Math.PI * 2,
  r: 0.36 + random() * 0.14,
  s: 0.45 + random() * random() * 1.2,
  w: 0.25 + random() * 0.2,
  phase: random(),
}));

const DISK = orbiters(0xb1ac4, 160, (random) => {
  const r = 0.17 + Math.pow(random(), 0.8) * 0.45;
  return {
    a: random() * Math.PI * 2,
    r,
    s: 0.35 + random() * 0.8,
    w: 1.1 * Math.pow(0.17 / r, 1.5),
    phase: random(),
  };
});

const ARMS = orbiters(0x6a1a, 120, (random) => {
  const d = 0.05 + Math.pow(random(), 0.75) * 0.4;
  const arm = random() < 0.5 ? 0 : Math.PI;
  return {
    a: arm + d * 7.5 + (random() - 0.5) * 0.6,
    r: d,
    s: 0.35 + random() * 0.7,
    w: 0.05 + 0.16 * (1 - d / 0.45),
    phase: random(),
  };
});

// Each grain's colour and thinning depend only on its radius: hotter inside, thinner outside.
const DISK_LOOK = DISK.map((grain) => {
  const hot = Math.max(0, 1 - (grain.r - 0.17) / 0.3);
  return {
    fill: `rgb(255,${Math.round(150 + hot * 80)},${Math.round(70 + hot * 90)})`,
    thin: grain.r > 0.45 ? 1 - ((grain.r - 0.45) / 0.17) * 0.75 : 1,
  };
});

const armLook = (star: Orbiter) =>
  star.r < 0.11
    ? { fill: "rgb(255,226,186)", strength: 0.5 }
    : star.phase < 0.16
      ? { fill: "rgb(255,140,226)", strength: 0.5 }
      : { fill: "rgb(176,196,255)", strength: 0.42 };

const MOTES = orbiters(0x57a2d, 30, (random) => ({
  a: random() * Math.PI * 2,
  r: Math.pow(random(), 0.6) * 0.3,
  s: 0.35 + random() * 0.6,
  w: 0.1 + random() * 0.3,
  phase: random() * Math.PI * 2,
}));

const EJECTA = orbiters(0x5e7a, 18, (random) => ({
  a: random() * Math.PI * 2,
  r: 0,
  s: 0.4 + random() * 0.6,
  w: 0.25 + random() * 0.35,
  phase: random(),
}));

const frac = (value: number) => value - Math.floor(value);

/** Tilted-ellipse position, and whether it is on the near side of the body. */
function onEllipse(angle: number, rx: number, ry: number, tilt: number) {
  const ex = Math.cos(angle) * rx;
  const ey = Math.sin(angle) * ry;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return { x: ex * c - ey * s, y: ex * s + ey * c, front: Math.sin(angle) > 0 };
}

/** A dot in an opaque colour at `alpha`, so no colour string is built for every dot of a frame. */
function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  alpha: number,
) {
  if (alpha <= 0.001) return;
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * Math.min(1, alpha);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = base;
}

/** Motion layered over a body's render: debris, a moon, corona, accretion, arms, motes. */
function drawBodyMotion(
  ctx: CanvasRenderingContext2D,
  id: CelestialStageId,
  x: number,
  y: number,
  size: number,
  t: number,
  weight: number,
  layer: "back" | "front",
) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  switch (id) {
    case "stardust": {
      if (layer === "back") break;
      for (const mote of MOTES) {
        const angle = mote.a + t * mote.w;
        const px = x + Math.cos(angle) * mote.r * size;
        const py = y + Math.sin(angle) * mote.r * size * 0.7;
        const twinkle = Math.pow(0.5 + 0.5 * Math.sin(t * (1.2 + mote.w * 5) + mote.phase), 3);
        dot(ctx, px, py, mote.s, "rgb(200,235,255)", twinkle * 0.9 * weight);
        if (twinkle > 0.85) {
          ctx.strokeStyle = `rgba(200,235,255,${(0.5 * weight).toFixed(3)})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(px - 2.5, py);
          ctx.lineTo(px + 2.5, py);
          ctx.moveTo(px, py - 2.5);
          ctx.lineTo(px, py + 2.5);
          ctx.stroke();
        }
      }
      break;
    }
    case "asteroid": {
      ctx.globalCompositeOperation = "source-over";
      for (const rock of DEBRIS) {
        const p = onEllipse(rock.a + t * rock.w, rock.r * size, rock.r * size * 0.26, -0.35);
        if (p.front !== (layer === "front")) continue;
        const shade = p.front ? 1 : 0.55;
        dot(ctx, x + p.x, y + p.y, rock.s, "rgb(70,76,88)", 0.9 * weight);
        dot(
          ctx,
          x + p.x - rock.s * 0.3,
          y + p.y - rock.s * 0.3,
          rock.s * 0.6,
          "rgb(214,222,236)",
          0.85 * shade * weight,
        );
      }
      break;
    }
    case "planet": {
      const p = onEllipse(t * 0.5, size * 0.56, size * 0.12, -0.36);
      if (p.front === (layer === "front")) {
        const mx = x + p.x;
        const my = y + p.y;
        const moon = ctx.createRadialGradient(mx - 0.7, my - 0.7, 0, mx, my, 2);
        moon.addColorStop(0, `rgba(236,242,252,${weight.toFixed(3)})`);
        moon.addColorStop(1, `rgba(60,66,80,${(0.6 * weight).toFixed(3)})`);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = moon;
        ctx.beginPath();
        ctx.arc(mx, my, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "lighter";
      }
      if (layer === "front") {
        const breathe = 0.12 + 0.07 * Math.sin(t * 1.3);
        ctx.strokeStyle = `rgba(110,200,255,${(breathe * weight).toFixed(3)})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x - size * 0.025, y - size * 0.015, size * 0.335, Math.PI * 0.55, Math.PI * 1.5);
        ctx.stroke();
      }
      break;
    }
    case "star": {
      if (layer === "back") {
        const breathe = 0.3 + 0.1 * Math.sin(t * 2.1) + 0.05 * Math.sin(t * 5.3);
        stamp(ctx, CORONA(), x, y, size * 0.95, breathe * weight);
        break;
      }
      const flicker = 0.75 + 0.25 * Math.sin(t * 3.7) * Math.sin(t * 1.9);
      const streak = ctx.createLinearGradient(x - size * 1.5, 0, x + size * 1.5, 0);
      streak.addColorStop(0, "rgba(255,200,140,0)");
      streak.addColorStop(0.5, `rgba(255,226,180,${(0.5 * flicker * weight).toFixed(3)})`);
      streak.addColorStop(1, "rgba(255,200,140,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(x - size * 1.5, y - 0.6, size * 3, 1.2);
      for (const spark of EJECTA) {
        const phase = frac(t * spark.w + spark.phase);
        const reach = size * (0.36 + phase * 0.6);
        const px = x + Math.cos(spark.a) * reach;
        const py = y + Math.sin(spark.a) * reach;
        dot(ctx, px, py, spark.s, "rgb(255,190,110)", (1 - phase) * 0.8 * weight);
      }
      break;
    }
    case "blackhole": {
      if (layer === "back") {
        // Relativistic jets out of both poles, flickering, with knots running up them.
        const jet = size * (0.52 + 0.06 * Math.sin(t * 7.3) + 0.04 * Math.sin(t * 12.1));
        for (const dir of [-1, 1]) {
          const beam = ctx.createLinearGradient(x, y, x, y + dir * jet);
          beam.addColorStop(0, `rgba(210,230,255,${(0.6 * weight).toFixed(3)})`);
          beam.addColorStop(0.35, `rgba(170,200,255,${(0.3 * weight).toFixed(3)})`);
          beam.addColorStop(1, "rgba(140,170,255,0)");
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(x - 1.4, y);
          ctx.lineTo(x - size * 0.035, y + dir * jet);
          ctx.lineTo(x + size * 0.035, y + dir * jet);
          ctx.lineTo(x + 1.4, y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = beam;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + dir * jet * 0.9);
          ctx.stroke();
          for (let k = 0; k < 3; k++) {
            const phase = frac(t * 1.5 + k / 3 + (dir > 0 ? 0.17 : 0));
            const fade = (1 - phase) * Math.min(1, phase * 6) * 0.85 * weight;
            dot(ctx, x, y + dir * jet * phase, 1.4 * (1 - phase * 0.5), "rgb(225,238,255)", fade);
          }
        }
        ctx.globalCompositeOperation = "source-over";
        stamp(ctx, PULL(), x, y, size * 0.55, weight);
        ctx.globalCompositeOperation = "lighter";
      }
      const grit = Math.sqrt(size / 76);
      DISK.forEach((grain, index) => {
        const angle = grain.a + t * grain.w;
        const p = onEllipse(angle, grain.r * size, grain.r * size * 0.085, 0);
        if (p.front !== (layer === "front")) return;
        // The side turning toward us burns brighter.
        const doppler = 0.55 + 0.45 * -Math.cos(angle);
        const look = DISK_LOOK[index]!;
        dot(ctx, x + p.x, y + p.y, grain.s * grit, look.fill, 0.75 * doppler * look.thin * weight);
      });
      if (layer === "front") {
        for (let i = 0; i < 6; i++) {
          const phase = frac(t * 0.3 + i / 6);
          const reach = size * (0.42 - phase * 0.29);
          const angle = i * 1.7 + phase * 7;
          const px = x + Math.cos(angle) * reach;
          const py = y + Math.sin(angle) * reach * 0.12;
          const fade = Math.sin(phase * Math.PI) * 0.7 * weight;
          dot(ctx, px, py, 0.7, "rgb(255,220,170)", fade);
        }
        const shimmer = 0.26 + 0.16 * Math.sin(t * 2.6);
        ctx.strokeStyle = `rgba(255,228,190,${(shimmer * weight).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.155, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "galaxy": {
      const spin = t * GALAXY_SPIN;
      if (layer === "back") {
        // A faint halo of old stars around the whole disc.
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(GALAXY_TILT);
        ctx.scale(1, GALAXY_SQUASH);
        const breathe = 0.16 + 0.04 * Math.sin(t * 0.9);
        stamp(ctx, GALAXY_HALO(), 0, 0, size * 0.78, breathe * weight);
        ctx.restore();
        break;
      }
      for (const star of ARMS) {
        const p = onEllipse(
          star.a + spin - t * star.w * 0.15,
          star.r * size,
          star.r * size * GALAXY_SQUASH,
          GALAXY_TILT,
        );
        const twinkle = 0.45 + 0.55 * Math.sin(t * (1 + star.phase * 3) + star.phase * 9);
        const look = armLook(star);
        dot(ctx, x + p.x, y + p.y, star.s, look.fill, look.strength * twinkle * weight);
      }
      stamp(ctx, GALAXY_CORE(), x, y, size * 0.16, (0.3 + 0.1 * Math.sin(t * 1.7)) * weight);
      break;
    }
  }
  ctx.restore();
}

// Gradients that change only in strength from frame to frame, baked once at full strength.
const CORONA = () =>
  bakedGradient("corona", 0.3 / 0.95, [
    [0, [255, 170, 70], 1],
    [0.45, [255, 130, 50], 0.35],
    [1, [255, 120, 40], 0],
  ]);
const PULL = () =>
  bakedGradient("pull", 0.1 / 0.55, [
    [0, CLEAR, 0.7],
    [1, CLEAR, 0],
  ]);
const GALAXY_HALO = () =>
  bakedGradient("galaxy-halo", 0.2 / 0.78, [
    [0, [150, 128, 255], 1],
    [0.5, [90, 110, 255], 0.4],
    [1, [90, 110, 255], 0],
  ]);
const GALAXY_CORE = () =>
  bakedGradient("galaxy-core", 0, [
    [0, [255, 232, 196], 1],
    [1, [255, 232, 196], 0],
  ]);
const VOID = () =>
  bakedGradient("void", 0, [
    [0, [3, 4, 12], 0.82],
    [0.6, [3, 4, 12], 0.5],
    [1, [3, 4, 12], 0],
  ]);
const SHADE = () =>
  bakedGradient("shade", 0.8, [
    [0, [2, 3, 9], 0.96],
    [1, [2, 3, 9], 0],
  ]);

/** A pocket of deep space the big bodies carry with them, so they read on any panel behind. */
function drawVoid(
  ctx: CanvasRenderingContext2D,
  stage: CelestialStage,
  x: number,
  y: number,
  size: number,
  weight: number,
) {
  if (stage.id !== "blackhole" && stage.id !== "galaxy") return;
  ctx.save();
  ctx.translate(x, y);
  if (stage.id === "galaxy") {
    ctx.rotate(GALAXY_TILT);
    ctx.scale(1, GALAXY_SQUASH * 1.2);
  } else {
    ctx.scale(1, 0.62);
  }
  stamp(ctx, VOID(), 0, 0, size * 0.6, weight);
  ctx.restore();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  stage: CelestialStage,
  x: number,
  y: number,
  size: number,
  weight: number,
  t: number,
) {
  if (weight <= 0.002) return;
  const tint = hexToRgb(stage.accent);
  const image = celestialSprites().get(stage.id);

  drawVoid(ctx, stage, x, y, size, weight);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = bakedGradient(`halo:${stage.id}`, 0, [
    [0, tint, 0.2],
    [1, tint, 0],
  ]);
  stamp(ctx, halo, x, y, size * 0.62, weight);
  ctx.restore();

  drawBodyMotion(ctx, stage.id, x, y, size, t, weight, "back");

  const occlude: Occluder | null = stage.occlude;
  if (occlude) {
    const ox = x + (occlude.x - 0.5) * size;
    const oy = y + (occlude.y - 0.5) * size;
    stamp(ctx, SHADE(), ox, oy, occlude.r * size, weight);
  }

  if (image && image.complete && image.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha *= weight;
    if (stage.id === "galaxy") {
      // Turn the disc within its own tilted plane: unproject, rotate, project back.
      ctx.translate(x, y);
      ctx.rotate(GALAXY_TILT);
      ctx.scale(1, GALAXY_SQUASH);
      ctx.rotate(t * GALAXY_SPIN);
      ctx.scale(1, 1 / GALAXY_SQUASH);
      ctx.rotate(-GALAXY_TILT);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
  }

  drawBodyMotion(ctx, stage.id, x, y, size, t, weight, "front");
}

/**
 * The body at the knob. `free` picks which bodies to draw: the ones that stay in the track (drawn
 * clipped to it) or the big ones that spill out of it.
 */
export function drawCelestialBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ratio: number,
  t: number,
  stages: ReadonlyArray<CelestialStage>,
  grip: number,
  free: boolean,
) {
  for (const layer of celestialLayersAt(ratio, stages, grip)) {
    if (layer.stage.free !== free) continue;
    drawOne(ctx, layer.stage, x, y, layer.size, layer.weight, t);
  }
}

/** A thin targeting ring around the body, so the knob reads as something to grab. */
export function drawCelestialReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  tint: Rgb,
  grip: number,
) {
  const radius = 20.5 - grip * 1.5;
  ctx.save();
  ctx.strokeStyle = rgba(tint, 0.42 + grip * 0.35);
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const spin = t * 0.7;
  for (const start of [spin, spin + Math.PI]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, start, start + 0.85);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba([235, 242, 255], 0.3 + grip * 0.3);
  ctx.lineWidth = 0.8;
  const turn = -t * 0.25;
  for (let i = 0; i < 4; i++) {
    const angle = turn + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * (radius + 1.5), y + Math.sin(angle) * (radius + 1.5));
    ctx.lineTo(x + Math.cos(angle) * (radius + 3.5), y + Math.sin(angle) * (radius + 3.5));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The ring of light that runs out from the knob when the level goes up; the higher the level, the
 * wider and rounder it gets, with a second ring and a lens flare across the panel at the top.
 */
export function drawCelestialShock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shock: number,
  tint: Rgb,
  power = 0,
) {
  if (shock <= 0.01) return;
  const spread = 1 - shock;
  const reach = 70 + power * 150;
  const flat = 0.36 + power * 0.3;
  const radius = 18 + spread * (2 - spread) * reach;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = rgba(tint, shock * shock * 0.75);
  ctx.lineWidth = 0.5 + shock * (0.9 + power * 1.8);
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * flat, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (power > 0.5) {
    const lag = clamp01(spread * 1.3 - 0.18);
    if (lag > 0 && lag < 1) {
      const inner = 14 + lag * (2 - lag) * reach * 0.7;
      ctx.strokeStyle = `rgba(255,255,255,${(Math.pow(1 - lag, 2) * 0.55).toFixed(3)})`;
      ctx.lineWidth = 0.6 + (1 - lag) * 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, inner, inner * flat, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // An anamorphic streak through the knob.
    const strength = Math.pow(shock, 1.5);
    const half = 60 + power * 240 * Math.sqrt(spread + 0.05);
    const core = ctx.createLinearGradient(x - half, 0, x + half, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.5, `rgba(255,255,255,${(strength * 0.85).toFixed(3)})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    const thick = 0.6 + power;
    ctx.fillRect(x - half, y - thick, half * 2, thick * 2);
    const wash = ctx.createLinearGradient(x - half * 1.2, 0, x + half * 1.2, 0);
    wash.addColorStop(0, rgba(tint, 0));
    wash.addColorStop(0.5, rgba(tint, strength * 0.35));
    wash.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = wash;
    const band = 4 + power * 4;
    ctx.fillRect(x - half * 1.2, y - band, half * 2.4, band * 2);
  }

  const bloom = 40 + power * 70;
  const flash = ctx.createRadialGradient(x, y, 0, x, y, bloom);
  flash.addColorStop(0, rgba(tint, shock * shock * (0.4 + power * 0.3)));
  flash.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = flash;
  ctx.fillRect(x - bloom, y - bloom, bloom * 2, bloom * 2);
  ctx.restore();
}
