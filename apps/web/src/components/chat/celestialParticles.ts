/**
 * Sparks for the effort slider: drag trail, level-up burst and nova, dust, and each body's own
 * emissions. `power` (0–1) is how high the level is and everything grows with it; `free` sparks
 * may leave the track, the others are drawn clipped to it.
 */

export type Rgb = readonly [number, number, number];

/** A spark that circles the body in a tilted plane, drifting in or out as it goes. */
interface Orbit {
  a: number;
  r: number;
  readonly r0: number;
  readonly w: number;
  vr: number;
  readonly squash: number;
  readonly tilt: number;
  /** Swallowed at this radius (0: never). */
  readonly kill: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  rgb: Rgb;
  drag: number;
  ambient: boolean;
  free: boolean;
  /** Soft halo around the spark, 0–1. */
  glow: number;
  /** Pull toward the body, px/s². */
  gravity: number;
  /** Dies when it falls back inside this radius of the body (with gravity). */
  floor: number;
  orbit: Orbit | null;
  /** A star flaring up: a glow with a cross glint instead of a dot. */
  flash: boolean;
  /** The body that gave it off; it circles or falls toward that body while it is on the knob. */
  source: string | null;
  tethered: boolean;
  cx: number;
  cy: number;
}

const MAX_SPARKS = 1100;
const WHITE: Rgb = [255, 255, 255];

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft round glow in one colour, drawn once and stamped wherever a spark glows. */
function glowSprite([r, g, b]: Rgb): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${r >> 3},${g >> 3},${b >> 3}`;
  let sprite = glowCache.get(key);
  if (!sprite) {
    if (glowCache.size > 120) glowCache.clear();
    sprite = document.createElement("canvas");
    sprite.width = 64;
    sprite.height = 64;
    const ctx = sprite.getContext("2d");
    if (!ctx) return null;
    const fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fill.addColorStop(0, `rgba(${r},${g},${b},1)`);
    fill.addColorStop(0.22, `rgba(${r},${g},${b},0.5)`);
    fill.addColorStop(0.55, `rgba(${r},${g},${b},0.12)`);
    fill.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 64);
    glowCache.set(key, sprite);
  }
  return sprite;
}

const pick = <T>(items: ReadonlyArray<T>): T => items[Math.floor(Math.random() * items.length)]!;

/** The galaxy render's disc plane: its long axis (radians, y down) and how flat it looks. */
export const GALAXY_TILT = -0.627;
export const GALAXY_SQUASH = 0.57;

export class CelestialParticles {
  private sparks: Spark[] = [];
  private debts = new Map<string, number>();
  private anchorX = 0;
  private anchorY = 0;

  /** True while sparks other than background dust and emissions are alive, so the canvas stays awake. */
  get busy(): boolean {
    return this.sparks.some((spark) => !spark.ambient);
  }

  clear() {
    this.sparks = [];
    this.debts.clear();
  }

  /** Where the body is now; orbiting and falling sparks follow it. */
  setAnchor(x: number, y: number) {
    this.anchorX = x;
    this.anchorY = y;
  }

  private add(spark: Partial<Spark> & Pick<Spark, "x" | "y" | "ttl" | "size" | "rgb">) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    this.sparks.push({
      vx: 0,
      vy: 0,
      age: 0,
      drag: 0,
      ambient: false,
      free: false,
      glow: 0,
      gravity: 0,
      floor: 0,
      orbit: null,
      flash: false,
      source: null,
      tethered: false,
      cx: this.anchorX,
      cy: this.anchorY,
      ...spark,
    });
  }

  /** Bodies no longer on the knob let go of their matter, which stays where it was and fades. */
  release(active: ReadonlyArray<string>) {
    for (const spark of this.sparks) {
      if (spark.tethered && spark.source !== null && !active.includes(spark.source)) {
        spark.tethered = false;
      }
    }
  }

  /** Calls `make` `rate` times a second on average, carrying the remainder between frames. */
  private every(key: string, dt: number, rate: number, make: () => void) {
    let debt = (this.debts.get(key) ?? 0) + dt * rate;
    while (debt >= 1) {
      debt -= 1;
      make();
    }
    this.debts.set(key, debt);
  }

  /** Dust shed behind a dragged body, thrown back against the direction of travel. */
  trail(x: number, y: number, dx: number, rgb: Rgb, power: number, free: boolean) {
    const count = Math.min(
      3 + Math.round(power * 8),
      Math.floor(Math.abs(dx) * 0.3 * (1 + power * 2)) + 1,
    );
    const lift = free ? 1 + power * 2.2 : 1;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2;
      this.add({
        x: x - dx * Math.random() + (Math.random() - 0.5) * 4,
        y: y + spread * 6 * lift,
        vx: -dx * (3 + Math.random() * 6) * (1 + power * 0.6) + (Math.random() - 0.5) * 8,
        vy: spread * 6 * lift + (Math.random() - 0.5) * 4,
        ttl: (0.4 + Math.random() * 0.5) * (1 + power),
        size: (0.35 + Math.random() * Math.random() * 0.8) * (1 + power * 0.8),
        rgb: Math.random() < 0.4 ? WHITE : rgb,
        drag: 2.8 - power * 1.2,
        free,
        glow: power > 0.5 ? 0.45 : 0,
      });
    }
  }

  /** A ring of sparks thrown out when the body grows to the next level. */
  burst(x: number, y: number, rgb: Rgb, power: number, free: boolean) {
    const count = Math.round(24 + power * 110);
    const squash = free ? 0.55 + power * 0.35 : 0.42;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = (45 + Math.random() * 95) * (1 + power * 1.8);
      this.add({
        x: x + Math.cos(angle) * 6,
        y: y + Math.sin(angle) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * squash,
        ttl: (0.4 + Math.random() * 0.55) * (1 + power * 0.9),
        size: (0.4 + Math.random() * 0.7) * (1 + power * 0.6),
        rgb: Math.random() < 0.4 ? WHITE : rgb,
        drag: 3.6 - power * 1.6,
        free,
        glow: power > 0.5 ? 0.5 : 0,
      });
    }
  }

  /** On the way into the top levels: a flash, fast shards and slow embers, all leaving the track. */
  nova(x: number, y: number, rgb: Rgb, power: number) {
    this.add({ x, y, ttl: 0.42, size: 12 + power * 16, rgb: WHITE, free: true, flash: true });
    this.add({ x, y, ttl: 0.7, size: 18 + power * 22, rgb, free: true, flash: true });
    const shards = Math.round(16 + power * 40);
    for (let i = 0; i < shards; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (260 + Math.random() * 260) * (0.7 + power * 0.5);
      this.add({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7,
        ttl: 0.35 + Math.random() * 0.3,
        size: 0.7 + Math.random() * 0.6,
        rgb: Math.random() < 0.5 ? WHITE : rgb,
        drag: 2.2,
        free: true,
        glow: 0.7,
      });
    }
    const embers = Math.round(20 + power * 40);
    for (let i = 0; i < embers; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 60;
      this.add({
        x: x + Math.cos(angle) * 8,
        y: y + Math.sin(angle) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.8,
        ttl: 1.2 + Math.random() * 1,
        size: 0.6 + Math.random() * 0.8,
        rgb: pick<Rgb>([rgb, WHITE, [255, 214, 140]]),
        drag: 0.6,
        free: true,
        glow: 0.9,
      });
    }
  }

  /** Sparks drawn in toward the body when it shrinks to a lower level. */
  implode(x: number, y: number, rgb: Rgb, power: number, free: boolean) {
    const count = Math.round(18 + power * 40);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = (22 + Math.random() * 16) * (1 + power * 1.5);
      const ttl = 0.32 + Math.random() * 0.2 + power * 0.15;
      const squash = free ? 0.7 : 0.5;
      this.add({
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius * squash,
        vx: (-Math.cos(angle) * radius) / ttl,
        vy: (-Math.sin(angle) * radius * squash) / ttl,
        ttl,
        size: (0.4 + Math.random() * 0.5) * (1 + power * 0.5),
        rgb,
        free,
        glow: power > 0.5 ? 0.4 : 0,
      });
    }
  }

  /** Fine dust drifting across the whole track; more of it at higher levels. */
  drift(w: number, h: number, dt: number, rate: number, rgb: Rgb) {
    this.every("dust", dt, rate, () => {
      this.add({
        x: Math.random() * w,
        y: 4 + Math.random() * (h - 8),
        vx: -3 - Math.random() * 7,
        vy: (Math.random() - 0.5) * 2,
        ttl: 2.2 + Math.random() * 2.6,
        size: 0.3 + Math.random() * 0.45,
        rgb: Math.random() < 0.5 ? [210, 225, 255] : rgb,
        ambient: true,
      });
    });
  }

  /** What a body gives off on its own, `weight` of it while it fades in or out between levels. */
  emit(id: string, x: number, y: number, size: number, dt: number, weight: number) {
    if (weight < 0.02) return;
    switch (id) {
      case "star": {
        // Prominences: plasma thrown off the limb that arcs back under gravity.
        const limb = size * 0.36;
        this.every("star", dt, 10 * weight, () => {
          const angle = Math.random() * Math.PI * 2;
          const out = 28 + Math.random() * 40;
          const side = (Math.random() - 0.5) * 50;
          this.add({
            x: x + Math.cos(angle) * limb,
            y: y + Math.sin(angle) * limb,
            vx: Math.cos(angle) * out - Math.sin(angle) * side,
            vy: Math.sin(angle) * out + Math.cos(angle) * side,
            ttl: 1 + Math.random() * 0.8,
            size: 0.5 + Math.random() * 0.8,
            rgb: Math.random() < 0.3 ? [255, 236, 190] : [255, 150, 60],
            drag: 0.3,
            ambient: true,
            free: true,
            glow: 0.8,
            gravity: 75,
            floor: limb * 0.92,
            source: id,
            tethered: true,
          });
        });
        // Now and then a coronal mass ejection: a cone of fast sparks.
        this.every("star:cme", dt, 0.4 * weight, () => {
          const angle = Math.random() * Math.PI * 2;
          for (let i = 0; i < 16; i++) {
            const a = angle + (Math.random() - 0.5) * 0.7;
            const speed = 80 + Math.random() * 110;
            this.add({
              x: x + Math.cos(a) * limb,
              y: y + Math.sin(a) * limb,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              ttl: 0.7 + Math.random() * 0.5,
              size: 0.5 + Math.random() * 0.7,
              rgb: Math.random() < 0.4 ? [255, 240, 200] : [255, 170, 80],
              drag: 1.2,
              ambient: true,
              free: true,
              glow: 0.7,
            });
          }
        });
        break;
      }
      case "blackhole": {
        // Matter falling in from far outside the track, spinning faster as it nears the horizon.
        this.every("blackhole", dt, 60 * weight, () => {
          const r0 = size * (0.5 + Math.random() * 0.45);
          const hot = Math.random();
          this.add({
            x,
            y,
            ttl: 8,
            size: 0.4 + Math.random() * 0.8,
            rgb: [255, Math.round(150 + hot * 90), Math.round(70 + hot * 120)],
            ambient: true,
            free: true,
            glow: 0.45,
            source: id,
            tethered: true,
            orbit: {
              a: Math.random() * Math.PI * 2,
              r: r0,
              r0,
              w: 0.9 + Math.random() * 0.7,
              vr: -(10 + Math.random() * 16),
              squash: 0.15,
              tilt: 0,
              kill: size * 0.13,
            },
          });
        });
        // Polar jets, straight up and down out of the track.
        this.every("blackhole:jet", dt, 70 * weight, () => {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const speed = 190 + Math.random() * 170;
          this.add({
            x: x + (Math.random() - 0.5) * 2,
            y: y + dir * size * 0.06,
            vx: (Math.random() - 0.5) * 12,
            vy: dir * speed,
            ttl: 0.26 + Math.random() * 0.22,
            size: 0.4 + Math.random() * 0.6,
            rgb: Math.random() < 0.5 ? [190, 220, 255] : WHITE,
            drag: 0.8,
            ambient: true,
            free: true,
            glow: 0.9,
          });
        });
        break;
      }
      case "galaxy": {
        // Stars flung out along the arms, past the edge of the track.
        this.every("galaxy", dt, 38 * weight, () => {
          const r0 = size * (0.26 + Math.random() * 0.2);
          this.add({
            x,
            y,
            ttl: 1.6 + Math.random() * 1.2,
            size: 0.4 + Math.random() * 0.7,
            rgb: pick<Rgb>([
              [176, 196, 255],
              [176, 196, 255],
              [255, 140, 226],
              [255, 240, 220],
            ]),
            ambient: true,
            free: true,
            glow: 0.6,
            source: id,
            tethered: true,
            orbit: {
              a: Math.random() * Math.PI * 2,
              r: r0,
              r0,
              w: -(0.25 + Math.random() * 0.3),
              vr: 14 + Math.random() * 24,
              squash: GALAXY_SQUASH,
              tilt: GALAXY_TILT,
              kill: 0,
            },
          });
        });
        // Supernovae: a star in the disc flares and fades.
        this.every("galaxy:sn", dt, 1.8 * weight, () => {
          const a = Math.random() * Math.PI * 2;
          const r = size * (0.12 + Math.random() * 0.34);
          const ex = Math.cos(a) * r;
          const ey = Math.sin(a) * r * GALAXY_SQUASH;
          const c = Math.cos(GALAXY_TILT);
          const s = Math.sin(GALAXY_TILT);
          this.add({
            x: x + ex * c - ey * s,
            y: y + ex * s + ey * c,
            ttl: 0.6 + Math.random() * 0.4,
            size: 2.5 + Math.random() * 3,
            rgb: Math.random() < 0.5 ? [255, 236, 250] : [200, 220, 255],
            ambient: true,
            free: true,
            flash: true,
          });
        });
        break;
      }
    }
  }

  step(dt: number) {
    const next: Spark[] = [];
    for (const spark of this.sparks) {
      spark.age += dt;
      if (spark.age >= spark.ttl) continue;
      if (spark.tethered) {
        spark.cx = this.anchorX;
        spark.cy = this.anchorY;
      }
      const orbit = spark.orbit;
      if (orbit) {
        orbit.r += orbit.vr * dt;
        if (orbit.vr < 0) orbit.vr *= 1 + dt * 1.4;
        if (orbit.kill > 0 && orbit.r <= orbit.kill) continue;
        // Kepler: closer in, faster round.
        const spin = Math.min(
          14,
          Math.abs(orbit.w) * Math.pow(orbit.r0 / Math.max(4, orbit.r), 1.5),
        );
        orbit.a += Math.sign(orbit.w) * spin * dt;
        const ex = Math.cos(orbit.a) * orbit.r;
        const ey = Math.sin(orbit.a) * orbit.r * orbit.squash;
        const c = Math.cos(orbit.tilt);
        const s = Math.sin(orbit.tilt);
        const ox = ex * c - ey * s;
        const oy = ex * s + ey * c;
        // Speed along the orbit only, so a body dragged across the track does not smear its matter.
        if (spark.age > dt) {
          spark.vx = (ox - (spark.x - spark.cx)) / dt;
          spark.vy = (oy - (spark.y - spark.cy)) / dt;
        }
        spark.x = spark.cx + ox;
        spark.y = spark.cy + oy;
        next.push(spark);
        continue;
      }
      if (spark.gravity > 0) {
        const dx = spark.cx - spark.x;
        const dy = spark.cy - spark.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        if (spark.age > 0.15 && d < spark.floor) continue;
        spark.vx += (dx / d) * spark.gravity * dt;
        spark.vy += (dy / d) * spark.gravity * dt;
      }
      const damp = Math.exp(-spark.drag * dt);
      spark.vx *= damp;
      spark.vy *= damp;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      next.push(spark);
    }
    this.sparks = next;
  }

  /** Draws the sparks that stay in the track (`free` false) or the ones that may leave it. */
  draw(ctx: CanvasRenderingContext2D, free: boolean) {
    if (this.sparks.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const spark of this.sparks) {
      if (spark.free !== free) continue;
      const life = spark.age / spark.ttl;
      // Orbiting matter fades in, then burns until it is swallowed.
      const alpha = spark.orbit
        ? Math.min(1, life * 6) * (spark.orbit.kill > 0 ? 0.95 : 1 - life)
        : Math.min(1, life * 10) * (1 - life) * (spark.ambient && !spark.glow ? 0.45 : 0.95);
      if (alpha <= 0.01) continue;
      const [r, g, b] = spark.rgb;

      if (spark.flash) {
        const sprite = glowSprite(spark.rgb);
        const bloom = spark.size * (1 + life * 1.4);
        const strength = Math.pow(1 - life, 1.6);
        if (sprite) {
          ctx.globalAlpha = strength;
          ctx.drawImage(sprite, spark.x - bloom * 2, spark.y - bloom * 2, bloom * 4, bloom * 4);
          ctx.globalAlpha = 1;
        }
        const reach = bloom * 2.4;
        ctx.strokeStyle = `rgba(${r},${g},${b},${(strength * 0.8).toFixed(3)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(spark.x - reach, spark.y);
        ctx.lineTo(spark.x + reach, spark.y);
        ctx.moveTo(spark.x, spark.y - reach * 0.6);
        ctx.lineTo(spark.x, spark.y + reach * 0.6);
        ctx.stroke();
        continue;
      }

      if (spark.glow > 0) {
        const sprite = glowSprite(spark.rgb);
        if (sprite) {
          const halo = spark.size * 5;
          ctx.globalAlpha = alpha * spark.glow * 0.55;
          ctx.drawImage(sprite, spark.x - halo, spark.y - halo, halo * 2, halo * 2);
          ctx.globalAlpha = 1;
        }
      }
      const color = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      const speed = Math.hypot(spark.vx, spark.vy);
      if (speed > 25) {
        // Fast sparks draw as short streaks along their path.
        const tail = Math.min(0.05, 22 / speed);
        ctx.strokeStyle = color;
        ctx.lineWidth = spark.size * 1.4;
        ctx.beginPath();
        ctx.moveTo(spark.x - spark.vx * tail, spark.y - spark.vy * tail);
        ctx.lineTo(spark.x, spark.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
