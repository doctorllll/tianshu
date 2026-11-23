import { type ReactNode, useEffect, useRef, useState } from "react";
import { useUiText } from "~/i18n/useUiText";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import "./composerV9.css";
import { CelestialParticles } from "./celestialParticles";
import {
  celestialAccentAt,
  celestialRgbAt,
  celestialSprites,
  celestialStageAt,
  celestialStagesFor,
  drawCelestialBody,
  drawCelestialReticle,
  drawCelestialShock,
  drawCelestialSky,
  forgetCelestialWake,
} from "./celestialSliderScene";

export interface CosmicEffortOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly isDefault?: boolean | undefined;
}

// 50px canvas (+ 3px bevel = 56px track); the body sits on the knob with nothing around it.
const TRACK_H = 50;
const PAD = 40;
const SNAP = 0.032;
// Idle open-popover repaint cadence (~24fps keeps fluid motion silky while staying light on GPU).
const IDLE_FRAME_MS = 1000 / 24;
// Auto-sleep the canvas loop after 2s of settled idle (pointer away) to drop idle cost to zero.
const IDLE_SLEEP_MS = 2000;

let sharedAudioCtx: AudioContext | null = null;
function playSubtleCosmicChime(ratio: number) {
  if (typeof window === "undefined") return;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtor();
    if (sharedAudioCtx.state === "suspended") void sharedAudioCtx.resume();
    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const osc2 = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.type = "sine";
    osc2.type = "triangle";
    const freq = 360 + ratio * 620;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.045);
    osc2.frequency.setValueAtTime(freq * 1.5, now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.08);
    osc2.stop(now + 0.08);
  } catch {
    // Ignore audio context restrictions in headless/restricted environments.
  }
}

interface ShiftJuice {
  hitstop: number;
  shake: number;
  recoil: number;
  shock: number;
  kick: number;
}

function applyShiftJuice(st: ShiftJuice, nextIdx: number, prevIdx: number): void {
  const up = nextIdx > prevIdx;
  st.hitstop = up ? 0.028 : 0;
  st.shake = up ? 0.8 : 0.2;
  st.recoil = up ? -5 : 2.2;
  st.shock = up ? 1 : 0;
  st.kick = up ? 1 : -1;
}

/**
 * Tianshu's reasoning-effort slider: the knob is a body that grows from an asteroid to a galaxy,
 * over a deep sky with the Big Dipper, shedding sparks as it moves. Level radios come in as
 * `children` and render under the track for keyboard and screen readers.
 */
export function CosmicEffortSlider(props: {
  readonly label: string;
  readonly options: ReadonlyArray<CosmicEffortOption>;
  readonly value: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (id: string) => void;
  readonly children?: ReactNode;
}) {
  const uiText = useUiText();
  const { options, value, disabled = false, onChange } = props;
  const wellRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<CelestialParticles | null>(null);

  const foundIndex = options.findIndex((o) => o.id === value);
  const selectedIndex = Math.max(0, foundIndex);
  const count = Math.max(1, options.length);
  const targetRatio = count <= 1 ? 0 : selectedIndex / (count - 1);
  const stages = celestialStagesFor(count);

  const [dragging, setDragging] = useState(false);
  const [dragStory, setDragStory] = useState<string | null>(null);

  const stateRef = useRef({
    val: targetRatio,
    target: targetRatio,
    dragging: false,
    hovering: false,
    grip: 0,
    lastIdx: selectedIndex,
    t: 2.4,
    hitstop: 0,
    shake: 0,
    recoil: 0,
    shock: 0,
    kick: 0,
    prevKx: Number.NaN,
    lastIdlePaintMs: 0,
    lastActivityMs: 0,
    hasPainted: false,
  });

  const wakeLoopRef = useRef<(() => void) | null>(null);

  // Sync external selection changes into the spring target & upshift juice.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives imperative Canvas 2D spring & shift juice when selection prop changes
  useEffect(() => {
    const st = stateRef.current;
    if (!st.dragging) {
      if (st.lastIdx !== selectedIndex) {
        applyShiftJuice(st, selectedIndex, st.lastIdx);
        st.lastIdx = selectedIndex;
      }
      st.target = targetRatio;
      wakeLoopRef.current?.();
    }
  }, [selectedIndex, targetRatio]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns imperative Canvas 2D render loop & resize/visibility listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!particlesRef.current) particlesRef.current = new CelestialParticles();
    const particles = particlesRef.current;
    const sceneStages = celestialStagesFor(count);

    const reducedMotion =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

    let raf = 0;
    let lastTs = performance.now();

    const drawFrame = (now: number) => {
      if (typeof document !== "undefined" && document.hidden) {
        raf = 0;
        canvas.dataset.renderState = "sleeping";
        return;
      }

      // Use untransformed layout clientWidth so CSS scale() popover open animations never resize/clear the canvas.
      const layoutW = wrap.clientWidth;
      if (layoutW < 2) {
        raf = 0;
        return;
      }

      const st = stateRef.current;
      const activeMotion =
        st.dragging ||
        st.hovering ||
        st.hitstop > 0 ||
        st.shake > 0.02 ||
        Math.abs(st.recoil) > 0.08 ||
        st.shock > 0.01 ||
        st.kick !== 0 ||
        Math.abs(st.grip - (st.dragging ? 1 : 0)) > 0.01 ||
        particles.busy ||
        Math.abs(st.target - st.val) > 0.001;

      if (activeMotion) {
        st.lastActivityMs = now;
      } else if (!reducedMotion && st.hasPainted && now - st.lastActivityMs >= IDLE_SLEEP_MS) {
        // Settled & idle for 2s: stop scheduling frames until the user interacts again.
        raf = 0;
        canvas.dataset.renderState = "sleeping";
        return;
      }

      const cssW = Math.max(120, Math.min(720, Math.round(layoutW)));
      const cssH = TRACK_H;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(cssW * dpr);
      const ch = Math.round(cssH * dpr);
      const needsResize = canvas.width !== cw || canvas.height !== ch;

      const busy = st.dragging || st.kick !== 0 || particles.busy || st.shock > 0.01;
      if (
        !reducedMotion &&
        !busy &&
        !needsResize &&
        st.hasPainted &&
        Math.abs(st.target - st.val) <= 0.001 &&
        now - st.lastIdlePaintMs < IDLE_FRAME_MS
      ) {
        raf = window.requestAnimationFrame(drawFrame);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      st.lastIdlePaintMs = now;

      if (needsResize) {
        canvas.width = cw;
        canvas.height = ch;
      }

      if (reducedMotion) {
        st.val = st.target;
        st.hitstop = 0;
        st.shake = 0;
        st.recoil = 0;
        st.shock = 0;
        st.kick = 0;
        st.grip = st.dragging ? 1 : 0;
        particles.clear();
      } else if (st.hitstop > 0) {
        st.hitstop = Math.max(0, st.hitstop - dt);
      } else {
        st.t += dt;
        st.val += (st.target - st.val) * (st.dragging ? 0.45 : 0.24);
        if (Math.abs(st.target - st.val) < 0.0005) st.val = st.target;
        st.grip += ((st.dragging ? 1 : 0) - st.grip) * Math.min(1, dt * 12);
        st.shake = Math.max(0, st.shake - dt * 6.4);
        st.recoil *= Math.pow(0.0008, dt);
        if (Math.abs(st.recoil) < 0.05) st.recoil = 0;
        st.shock = Math.max(0, st.shock - dt * 3.2);
        particles.step(dt);
      }

      const well = wellRef.current;
      if (well) {
        if (!reducedMotion && st.shake > 0.02) {
          const dx = (Math.sin(now * 0.095) * 1.5 * st.shake).toFixed(2);
          const dy = (Math.cos(now * 0.13) * 1 * st.shake).toFixed(2);
          well.style.transform = `translate3d(${dx}px,${dy}px,0)`;
        } else if (well.style.transform) {
          well.style.transform = "";
        }
      }

      const kx = PAD + st.val * (cssW - PAD * 2) + st.recoil;
      const ky = cssH / 2;
      const tint = celestialRgbAt(st.val, sceneStages);

      if (!reducedMotion) {
        if (st.kick === 1) particles.burst(kx, ky, tint, 1);
        if (st.kick === -1) particles.implode(kx, ky, tint);
        const moved = Number.isNaN(st.prevKx) ? 0 : kx - st.prevKx;
        if (st.dragging && Math.abs(moved) > 0.35) particles.trail(kx, ky, moved, tint);
        particles.drift(cssW, cssH, dt, 2 + st.val * 6, tint);
      }
      st.kick = 0;
      st.prevKx = kx;

      const detents = Array.from({ length: count }, (_, i) =>
        count <= 1 ? cssW / 2 : PAD + (i / (count - 1)) * (cssW - PAD * 2),
      );

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, cssW, cssH, cssH / 2);
      ctx.clip();
      drawCelestialSky(ctx, {
        w: cssW,
        h: cssH,
        ratio: st.val,
        t: st.t,
        stages: sceneStages,
        detents,
        selected: st.lastIdx,
        kx,
      });
      drawCelestialBody(ctx, kx, ky, st.val, st.t, sceneStages, st.grip);
      particles.draw(ctx);
      drawCelestialReticle(ctx, kx, ky, st.t, tint, st.grip);
      if (!reducedMotion) drawCelestialShock(ctx, kx, ky, st.shock, tint);
      ctx.restore();

      st.hasPainted = true;
      canvas.dataset.renderState = reducedMotion ? "sleeping" : "active";
      raf = reducedMotion ? 0 : window.requestAnimationFrame(drawFrame);
    };

    const wake = () => {
      const now = performance.now();
      stateRef.current.lastActivityMs = now;
      canvas.dataset.renderState = reducedMotion ? "sleeping" : "active";
      if (!raf) {
        lastTs = now;
        raf = window.requestAnimationFrame(drawFrame);
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) wake();
    };

    wakeLoopRef.current = wake;
    // Bodies arrive after the first frames; each one wakes a sleeping canvas to show it.
    celestialSprites(wake);
    wake();
    const stopObserve = observeResize(wrap, wake);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      forgetCelestialWake(wake);
      wakeLoopRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      if (wellRef.current) wellRef.current.style.transform = "";
      stopObserve();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [count]);

  const pointerToIndex = (clientX: number): { ratio: number; idx: number } => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || count <= 1) return { ratio: targetRatio, idx: selectedIndex };
    let raw = Math.max(
      0,
      Math.min(1, (clientX - rect.left - PAD) / Math.max(20, rect.width - PAD * 2)),
    );
    for (let i = 0; i < count; i++) {
      const det = i / (count - 1);
      if (Math.abs(raw - det) < SNAP) {
        raw = det;
        break;
      }
    }
    return { ratio: raw, idx: Math.round(raw * (count - 1)) };
  };

  const commitIndex = (idx: number, withSound = true) => {
    const opt = options[idx];
    if (!opt || disabled) return;
    if (opt.id !== value) {
      if (withSound) playSubtleCosmicChime(count <= 1 ? 0 : idx / (count - 1));
      onChange(opt.id);
    }
  };

  const activeOpt = foundIndex >= 0 ? options[foundIndex] : undefined;
  const activeColor = celestialAccentAt(targetRatio, stages);
  const levelLabel = activeOpt?.label ?? props.label;
  const storyKey = dragStory ?? celestialStageAt(targetRatio, stages).line;

  return (
    <div
      data-cosmic-effort-slider
      data-cosmic-scene="celestial"
      className={cn(disabled && "opacity-60")}
      onPointerEnter={() => {
        stateRef.current.hovering = true;
        wakeLoopRef.current?.();
      }}
      onPointerLeave={() => {
        stateRef.current.hovering = false;
      }}
      onFocus={() => wakeLoopRef.current?.()}
    >
      <div data-cosmic-embed-head>
        <b>
          <span
            aria-hidden="true"
            data-cosmic-state-dot
            style={{ background: activeColor, boxShadow: `0 0 8px ${activeColor}` }}
          />
          <span className="truncate" data-cosmic-level-heading>
            {uiText("Reasoning effort · {level}", { level: uiText(levelLabel) })}
          </span>
        </b>
      </div>
      <div data-cosmic-sub-row>
        <span key={storyKey} className="truncate" data-cosmic-story={storyKey}>
          {uiText(storyKey)}
        </span>
        <span className="shrink-0 tabular-nums" data-cosmic-stage>
          {uiText("{count} levels", { count })}
        </span>
      </div>

      <div ref={wellRef} data-cosmic-stage-well>
        <div
          ref={wrapRef}
          role="slider"
          tabIndex={-1}
          aria-label={props.label}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={selectedIndex}
          aria-valuetext={activeOpt?.label}
          aria-disabled={disabled || undefined}
          data-cosmic-track
          className={cn(
            disabled ? "pointer-events-none" : dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            stateRef.current.dragging = true;
            const { ratio, idx } = pointerToIndex(event.clientX);
            stateRef.current.target = ratio;
            stateRef.current.val = ratio;
            setDragStory(celestialStageAt(ratio, stages).line);
            wakeLoopRef.current?.();
            if (idx !== stateRef.current.lastIdx) {
              applyShiftJuice(stateRef.current, idx, stateRef.current.lastIdx);
              stateRef.current.lastIdx = idx;
              commitIndex(idx, true);
            }
          }}
          onPointerMove={(event) => {
            if (!stateRef.current.dragging || disabled) return;
            const { ratio, idx } = pointerToIndex(event.clientX);
            stateRef.current.target = ratio;
            const nextStory = celestialStageAt(ratio, stages).line;
            setDragStory((prev) => (prev === nextStory ? prev : nextStory));
            if (idx !== stateRef.current.lastIdx) {
              applyShiftJuice(stateRef.current, idx, stateRef.current.lastIdx);
              stateRef.current.lastIdx = idx;
              commitIndex(idx, true);
            }
          }}
          onPointerUp={() => {
            if (!stateRef.current.dragging) return;
            stateRef.current.dragging = false;
            setDragging(false);
            setDragStory(null);
            const idx = Math.round(stateRef.current.target * (count - 1));
            stateRef.current.target = count <= 1 ? 0 : idx / (count - 1);
            commitIndex(idx, false);
            wakeLoopRef.current?.();
          }}
          onPointerCancel={() => {
            if (!stateRef.current.dragging) return;
            stateRef.current.dragging = false;
            setDragging(false);
            setDragStory(null);
            stateRef.current.target = targetRatio;
            wakeLoopRef.current?.();
          }}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block size-full rounded-full"
          />
        </div>
      </div>
      {props.children}
    </div>
  );
}
