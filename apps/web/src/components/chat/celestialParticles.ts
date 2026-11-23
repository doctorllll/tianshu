/** Sparks for the effort slider: a comet trail while dragging, a burst on level-up, drifting dust. */

export type Rgb = readonly [number, number, number];

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
}

const MAX_SPARKS = 420;

export class CelestialParticles {
  private sparks: Spark[] = [];
  private dustDebt = 0;

  /** True while sparks other than background dust are alive, so the canvas stays awake. */
  get busy(): boolean {
    return this.sparks.some((spark) => !spark.ambient);
  }

  clear() {
    this.sparks = [];
  }

  private add(spark: Spark) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    this.sparks.push(spark);
  }

  /** Dust shed behind a dragged body, thrown back against the direction of travel. */
  trail(x: number, y: number, dx: number, rgb: Rgb) {
    const count = Math.min(3, Math.floor(Math.abs(dx) * 0.3) + 1);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2;
      this.add({
        x: x - dx * Math.random() + (Math.random() - 0.5) * 4,
        y: y + spread * 6,
        vx: -dx * (3 + Math.random() * 6) + (Math.random() - 0.5) * 8,
        vy: spread * 6 + (Math.random() - 0.5) * 4,
        age: 0,
        ttl: 0.4 + Math.random() * 0.5,
        size: 0.35 + Math.random() * Math.random() * 0.8,
        rgb: Math.random() < 0.4 ? [255, 255, 255] : rgb,
        drag: 2.8,
        ambient: false,
      });
    }
  }

  /** A ring of sparks thrown out when the body grows to the next level. */
  burst(x: number, y: number, rgb: Rgb, power = 1) {
    const count = Math.round(24 * power);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = (45 + Math.random() * 95) * power;
      this.add({
        x: x + Math.cos(angle) * 6,
        y: y + Math.sin(angle) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.42,
        age: 0,
        ttl: 0.4 + Math.random() * 0.55,
        size: 0.4 + Math.random() * 0.7,
        rgb: Math.random() < 0.4 ? [255, 255, 255] : rgb,
        drag: 3.6,
        ambient: false,
      });
    }
  }

  /** Sparks drawn in toward the body when it shrinks to a lower level. */
  implode(x: number, y: number, rgb: Rgb) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 22 + Math.random() * 16;
      const ttl = 0.32 + Math.random() * 0.2;
      this.add({
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius * 0.5,
        vx: (-Math.cos(angle) * radius) / ttl,
        vy: (-Math.sin(angle) * radius * 0.5) / ttl,
        age: 0,
        ttl,
        size: 0.4 + Math.random() * 0.5,
        rgb,
        drag: 0,
        ambient: false,
      });
    }
  }

  /** Fine dust drifting across the whole track; more of it at higher levels. */
  drift(w: number, h: number, dt: number, rate: number, rgb: Rgb) {
    this.dustDebt += dt * rate;
    while (this.dustDebt >= 1) {
      this.dustDebt -= 1;
      this.add({
        x: Math.random() * w,
        y: 4 + Math.random() * (h - 8),
        vx: -3 - Math.random() * 7,
        vy: (Math.random() - 0.5) * 2,
        age: 0,
        ttl: 2.2 + Math.random() * 2.6,
        size: 0.3 + Math.random() * 0.45,
        rgb: Math.random() < 0.5 ? [210, 225, 255] : rgb,
        drag: 0,
        ambient: true,
      });
    }
  }

  step(dt: number) {
    const next: Spark[] = [];
    for (const spark of this.sparks) {
      spark.age += dt;
      if (spark.age >= spark.ttl) continue;
      const damp = Math.exp(-spark.drag * dt);
      spark.vx *= damp;
      spark.vy *= damp;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      next.push(spark);
    }
    this.sparks = next;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.sparks.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const spark of this.sparks) {
      const life = spark.age / spark.ttl;
      // Ease in over the first tenth, then fade out.
      const alpha = Math.min(1, life * 10) * (1 - life) * (spark.ambient ? 0.45 : 0.9);
      if (alpha <= 0.01) continue;
      const [r, g, b] = spark.rgb;
      const color = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      const speed = Math.hypot(spark.vx, spark.vy);
      if (speed > 25) {
        // Fast sparks draw as short streaks along their path.
        ctx.strokeStyle = color;
        ctx.lineWidth = spark.size * 1.4;
        ctx.beginPath();
        ctx.moveTo(spark.x - spark.vx * 0.035, spark.y - spark.vy * 0.035);
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
