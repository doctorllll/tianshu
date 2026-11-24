"use strict";

/**
 * Plays the 天枢 launch intro over the page once per window, while the app loads underneath, and
 * lifts it once the app has rendered (or right away on a boot error, a key press or a click).
 * `?intro` forces it, for checking, and `?intro=<ms>` holds the frame at that time, for reviewing
 * it frame by frame; automated browsers and reduced motion skip it.
 */
(() => {
  const KEY = "tianshu:launch-intro";
  const MIN_MS = 2900;
  const MAX_MS = 9000;
  const EXIT_MS = 560;
  const param = new URLSearchParams(location.search).get("intro");
  const forced = param !== null;
  const seek = param && /^\d+$/.test(param) ? Number(param) : undefined;
  try {
    if (!forced && sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage may be unavailable; the intro then plays on every load.
  }
  if (!forced && (navigator.webdriver || matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    return;
  }

  const start = Date.now();
  const overlay = document.createElement("div");
  overlay.id = "tianshu-launch-intro";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483646",
    "background:#000",
    "overflow:hidden",
    `transition:opacity ${EXIT_MS}ms ease,transform ${EXIT_MS}ms cubic-bezier(.2,.7,.2,1)`,
  ].join(";");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  overlay.append(canvas);
  document.body.append(overlay);

  const size = () => {
    const w = innerWidth;
    const h = innerHeight;
    let dpr = Math.min(devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 7e6) dpr = Math.max(1, Math.sqrt(7e6 / (w * h)));
    return { w, h, dpr };
  };

  let worker = null;
  let page = null;
  let finished = false;
  let timer = 0;
  const send = (message) => {
    if (worker) worker.postMessage(message);
    else page?.message(message);
  };

  const cleanup = () => {
    overlay.remove();
    worker?.terminate();
    page?.stop();
  };

  const finish = (immediate) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    removeEventListener("keydown", skip, true);
    removeEventListener("resize", onResize);
    send({ type: "exit" });
    if (immediate) {
      cleanup();
      return;
    }
    overlay.style.pointerEvents = "none";
    overlay.style.opacity = "0";
    overlay.style.transform = "scale(1.035)";
    setTimeout(cleanup, EXIT_MS + 40);
  };

  const onEvent = (message) => {
    if (message.type === "failed") finish(true);
    else if (message.type === "held") document.documentElement.dataset.introHeld = "true";
  };

  const skip = () => {
    if (Date.now() - start > 250) finish(false);
  };

  const onResize = () => {
    const s = size();
    send({ type: "resize", w: s.w, h: s.h, dpr: s.dpr });
  };

  const startOnPage = () => {
    const script = document.createElement("script");
    script.src = "/boot-intro-render.js";
    script.addEventListener("load", () => {
      if (finished || !globalThis.TianshuIntro) return;
      const s = size();
      page = globalThis.TianshuIntro.start(canvas, { ...s, start, seek }, onEvent);
    });
    script.addEventListener("error", () => finish(true));
    document.head.append(script);
  };

  try {
    if (typeof OffscreenCanvas !== "function" || !canvas.transferControlToOffscreen) {
      throw new Error("no offscreen canvas");
    }
    worker = new Worker("/boot-intro-render.js");
    const offscreen = canvas.transferControlToOffscreen();
    worker.addEventListener("message", (event) => onEvent(event.data));
    worker.addEventListener("error", () => finish(true));
    const s = size();
    worker.postMessage({ type: "init", canvas: offscreen, ...s, start, seek }, [offscreen]);
  } catch {
    worker?.terminate();
    worker = null;
    startOnPage();
  }

  if (seek !== undefined) return;
  timer = setInterval(() => {
    const t = Date.now() - start;
    if (document.getElementById("boot-error")) finish(true);
    else if ((t >= MIN_MS && !document.getElementById("boot-shell")) || t >= MAX_MS) finish(false);
  }, 80);
  addEventListener("keydown", skip, true);
  overlay.addEventListener("pointerdown", skip);
  addEventListener("resize", onResize);
})();
