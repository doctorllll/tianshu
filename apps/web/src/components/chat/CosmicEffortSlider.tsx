import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUiText } from "~/i18n/useUiText";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import "./composerV9.css";
import { CelestialParticles } from "./celestialParticles";
import {
  type CelestialStage,
  celestialAccentAt,
  celestialLayersAt,
  celestialPowerAt,
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
// The bodies and sparks live on a page-level canvas this much bigger than the track on each side,
// so the big ones can spill out of the track and over the panel; its edges fade out over FEATHER.
const OVER_X = 130;
const OVER_Y = 110;
const FEATHER = 34;
// Idle open-popover repaint cadence (~24fps keeps fluid motion silky while staying light on GPU);
// the bodies that spill out of the track keep emitting, so they repaint faster.
const IDLE_FRAME_MS = 1000 / 24;
const IDLE_FRAME_FREE_MS = 1000 / 50;
// Over the popover (z 100), never in the way of the pointer; shown once it is placed.
const OVERLAY_STYLE = {
  position: "fixed",
  top: 0,
  left: 0,
  zIndex: 101,
  display: "block",
  pointerEvents: "none",
  transformOrigin: "0 0",
  visibility: "hidden",
} as const;
// Auto-sleep the canvas loop after 2s of settled idle (pointer away) to drop idle cost to zero.
const IDLE_SLEEP_MS = 2000;

let sharedAudioCtx: AudioContext | null = null;
function playSubtleCosmicChime(ratio: number, boom: boolean) {
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
    if (boom) {
      // A low thump under the chime when the body grows into a black hole or a galaxy.
      const sub = sharedAudioCtx.createOscillator();
      const subGain = sharedAudioCtx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(86, now);
      sub.frequency.exponentialRampToValueAtTime(38, now + 0.32);
      subGain.gain.setValueAtTime(0.0001, now);
      subGain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
      subGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.36);
      sub.connect(subGain);
      subGain.connect(sharedAudioCtx.destination);
      sub.start(now);
      sub.stop(now + 0.38);
    }
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
  /** How hard the level just reached hits, 0–1, and whether its shock may leave the track. */
  shockPower: number;
  shockFree: boolean;
}

/** The hit when the level changes; the higher the level reached, the harder it lands. */
function applyShiftJuice(
  st: ShiftJuice,
  nextIdx: number,
  prevIdx: number,
  stage: CelestialStage | undefined,
): void {
  const up = nextIdx > prevIdx;
  const power = stage?.power ?? 0.3;
  st.hitstop = up ? 0.028 + power * 0.07 : 0;
  st.shake = up ? 0.8 + power * 2.6 : 0.2 + power * 0.4;
  st.recoil = up ? -(5 + power * 6) : 2.2;
  st.shock = up ? 1 : 0;
  st.kick = up ? 1 : -1;
  st.shockPower = power;
  st.shockFree = Boolean(stage?.free);
}

/**
 * Tianshu's reasoning-effort slider: the knob is a body that grows from an asteroid to a galaxy,
 * over a deep sky with the Big Dipper, shedding sparks as it moves. The small bodies stay in the
 * track; from the star up they spill out of it over the panel, on a canvas laid over the page.
 * Level radios come in as `children` and render under the track for keyboard and screen readers.
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
  const overlayRef = useRef<HTMLCanvasElement>(null);
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
    shockPower: 0,
    shockFree: false,
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
        applyShiftJuice(st, selectedIndex, st.lastIdx, celestialStagesFor(count)[selectedIndex]);
        st.lastIdx = selectedIndex;
      }
      st.target = targetRatio;
      wakeLoopRef.current?.();
    }
  }, [selectedIndex, targetRatio, count]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns imperative Canvas 2D render loop & resize/visibility listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const overlay = overlayRef.current;
    const octx = overlay?.getContext("2d") ?? null;
    let placed = "";
    let popup: HTMLElement | null = null;

    // Keep the page-level canvas over the track: same place, same open/close scale and fade.
    const placeOverlay = (layoutW: number, ow: number, oh: number) => {
      if (!overlay) return;
      const rect = wrap.getBoundingClientRect();
      const scale = layoutW > 0 ? rect.width / layoutW : 1;
      popup ??= wrap.closest<HTMLElement>('[data-slot="popover-popup"]');
      const opacity = popup ? getComputedStyle(popup).opacity : "1";
      const left = (rect.left - OVER_X * scale).toFixed(2);
      const top = (rect.top - OVER_Y * scale).toFixed(2);
      const next = `${left} ${top} ${scale.toFixed(4)} ${opacity} ${ow} ${oh}`;
      if (next === placed) return;
      placed = next;
      overlay.style.width = `${ow}px`;
      overlay.style.height = `${oh}px`;
      overlay.style.transform = `translate3d(${left}px,${top}px,0) scale(${scale.toFixed(4)})`;
      overlay.style.opacity = opacity;
      overlay.style.visibility = "visible";
    };
    const hideOverlay = () => {
      if (!overlay || placed === "hidden") return;
      placed = "hidden";
      overlay.style.visibility = "hidden";
    };

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
        hideOverlay();
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
      const ow = cssW + OVER_X * 2;
      const oh = cssH + OVER_Y * 2;
      const ocw = Math.round(ow * dpr);
      const och = Math.round(oh * dpr);
      const needsResize =
        canvas.width !== cw ||
        canvas.height !== ch ||
        (overlay !== null && (overlay.width !== ocw || overlay.height !== och));
      placeOverlay(layoutW, ow, oh);

      const busy = st.dragging || st.kick !== 0 || particles.busy || st.shock > 0.01;
      const idleFrameMs = celestialStageAt(st.val, sceneStages).free
        ? IDLE_FRAME_FREE_MS
        : IDLE_FRAME_MS;
      if (
        !reducedMotion &&
        !busy &&
        !needsResize &&
        st.hasPainted &&
        Math.abs(st.target - st.val) <= 0.001 &&
        now - st.lastIdlePaintMs < idleFrameMs
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
        if (overlay) {
          overlay.width = ocw;
          overlay.height = och;
        }
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
        // The top levels' shock rolls out longer.
        st.shock = Math.max(0, st.shock - dt * (3.2 - st.shockPower * 1.6));
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
      const power = celestialPowerAt(st.val, sceneStages);
      const free = celestialStageAt(st.val, sceneStages).free;
      const layers = celestialLayersAt(st.val, sceneStages, st.grip);

      particles.setAnchor(kx, ky);
      if (!reducedMotion) {
        // A level change goes off where the new body lands, in its colour.
        if (st.kick !== 0) {
          const landX = PAD + st.target * (cssW - PAD * 2);
          const landTint = celestialRgbAt(st.target, sceneStages);
          if (st.kick === 1) {
            particles.burst(landX, ky, landTint, st.shockPower, st.shockFree);
            if (st.shockFree && st.shockPower >= 0.6) {
              particles.nova(landX, ky, landTint, st.shockPower);
            }
          } else {
            particles.implode(landX, ky, landTint, st.shockPower, st.shockFree);
          }
        }
        const moved = Number.isNaN(st.prevKx) ? 0 : kx - st.prevKx;
        if (st.dragging && Math.abs(moved) > 0.35) {
          particles.trail(kx, ky, moved, tint, power, free);
        }
        particles.drift(cssW, cssH, dt, 2 + st.val * 6, tint);
        for (const layer of layers) {
          particles.emit(layer.stage.id, kx, ky, layer.size, dt, layer.weight);
        }
        particles.release(layers.filter((layer) => layer.weight > 0.02).map((l) => l.stage.id));
      }
      st.kick = 0;
      st.prevKx = kx;

      const detents = Array.from({ length: count }, (_, i) =>
        count <= 1 ? cssW / 2 : PAD + (i / (count - 1)) * (cssW - PAD * 2),
      );

      // The track itself holds only the sky.
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
      ctx.restore();

      // Bodies and sparks go on the page-level canvas, in track coordinates.
      const bodyCtx = octx ?? ctx;
      if (octx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, ow, oh);
        octx.translate(OVER_X, OVER_Y);
      }
      bodyCtx.save();
      bodyCtx.beginPath();
      bodyCtx.roundRect(0, 0, cssW, cssH, cssH / 2);
      bodyCtx.clip();
      drawCelestialBody(bodyCtx, kx, ky, st.val, st.t, sceneStages, st.grip, false);
      particles.draw(bodyCtx, false);
      if (!reducedMotion && !st.shockFree) {
        drawCelestialShock(bodyCtx, kx, ky, st.shock, tint, st.shockPower);
      }
      if (!octx) {
        // No page-level canvas: everything stays in the track.
        drawCelestialBody(bodyCtx, kx, ky, st.val, st.t, sceneStages, st.grip, true);
        particles.draw(bodyCtx, true);
      }
      bodyCtx.restore();
      if (octx) {
        drawCelestialBody(octx, kx, ky, st.val, st.t, sceneStages, st.grip, true);
        particles.draw(octx, true);
        if (!reducedMotion && st.shockFree) {
          drawCelestialShock(octx, kx, ky, st.shock, tint, st.shockPower);
        }
      }
      drawCelestialReticle(bodyCtx, kx, ky, st.t, tint, st.grip);
      if (!octx && !reducedMotion && st.shockFree) {
        drawCelestialShock(bodyCtx, kx, ky, st.shock, tint, st.shockPower);
      }
      if (octx) {
        // Fade the canvas's own edges so nothing that leaves the track ends on a hard line.
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.globalCompositeOperation = "destination-in";
        const across = octx.createLinearGradient(0, 0, ow, 0);
        across.addColorStop(0, "rgba(0,0,0,0)");
        across.addColorStop(FEATHER / ow, "rgba(0,0,0,1)");
        across.addColorStop(1 - FEATHER / ow, "rgba(0,0,0,1)");
        across.addColorStop(1, "rgba(0,0,0,0)");
        octx.fillStyle = across;
        octx.fillRect(0, 0, ow, oh);
        const down = octx.createLinearGradient(0, 0, 0, oh);
        down.addColorStop(0, "rgba(0,0,0,0)");
        down.addColorStop(FEATHER / oh, "rgba(0,0,0,1)");
        down.addColorStop(1 - FEATHER / oh, "rgba(0,0,0,1)");
        down.addColorStop(1, "rgba(0,0,0,0)");
        octx.fillStyle = down;
        octx.fillRect(0, 0, ow, oh);
        octx.globalCompositeOperation = "source-over";
      }

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
    // The page-level canvas has to follow the track when anything scrolls or the window resizes.
    window.addEventListener("scroll", wake, { capture: true, passive: true });
    window.addEventListener("resize", wake);

    return () => {
      forgetCelestialWake(wake);
      wakeLoopRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      if (wellRef.current) wellRef.current.style.transform = "";
      stopObserve();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      window.removeEventListener("scroll", wake, { capture: true });
      window.removeEventListener("resize", wake);
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
      if (withSound) {
        const boom = idx > selectedIndex && (stages[idx]?.power ?? 0) >= 0.8;
        playSubtleCosmicChime(count <= 1 ? 0 : idx / (count - 1), boom);
      }
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
              applyShiftJuice(stateRef.current, idx, stateRef.current.lastIdx, stages[idx]);
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
              applyShiftJuice(stateRef.current, idx, stateRef.current.lastIdx, stages[idx]);
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
      {typeof document === "undefined"
        ? null
        : createPortal(
            <canvas
              ref={overlayRef}
              aria-hidden="true"
              data-cosmic-overlay
              // Inline, so it never takes a click even where the stylesheet has not loaded.
              style={OVERLAY_STYLE}
            />,
            document.body,
          )}
    </div>
  );
}
