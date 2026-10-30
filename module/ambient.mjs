/* Фоновый звук места миссии и гром. Всё синтезируется в браузере (шум и синусы через фильтры), файлов не нужно:
   пустыня — тёплый низкий ветер, Север — порывистая метель, море — накат волн, горы — тонкий свист ветра в скалах,
   тропики — влажный шелест, цикады и редкие птицы. Через секунду-две после вспышки молнии в окне карты
   раскатывается гром: чем ближе к центру экрана, тем громче. Громкость у каждого своя («Фоновый звук места»),
   её умножает ползунок «Окружение» Foundry. Браузер даёт играть звук только после первого щелчка или клавиши. */
import { SYSTEM_ID } from "./config.mjs";
import { onFlash } from "./weather-fx.mjs";

/**
 * Рецепт фона места: слои шума через фильтр с медленной волной громкости и частоты.
 * { type, f (Гц), q, gain, lfo: { rate (Гц), depth (доля громкости), sweep (Гц качания частоты) } }; chirps — птицы и цикады.
 */
export const BEDS = {
  desert: { layers: [
    { type: "lowpass", f: 380, q: 0.7, gain: 0.5, lfo: { rate: 0.07, depth: 0.45, sweep: 120 } },
    { type: "bandpass", f: 900, q: 1.2, gain: 0.12, lfo: { rate: 0.11, depth: 0.8, sweep: 260 } }
  ] },
  cold: { layers: [
    { type: "bandpass", f: 850, q: 1.4, gain: 0.32, lfo: { rate: 0.13, depth: 0.7, sweep: 420 } },
    { type: "bandpass", f: 2300, q: 9, gain: 0.05, lfo: { rate: 0.09, depth: 0.9, sweep: 500 } },
    { type: "lowpass", f: 220, q: 0.7, gain: 0.25, lfo: { rate: 0.05, depth: 0.4, sweep: 40 } }
  ] },
  sea: { layers: [
    { type: "lowpass", f: 520, q: 0.6, gain: 0.55, lfo: { rate: 0.12, depth: 0.85, sweep: 360 } },
    { type: "highpass", f: 2600, q: 0.5, gain: 0.06, lfo: { rate: 0.12, depth: 0.9, sweep: 0 } }
  ] },
  mountain: { layers: [
    { type: "bandpass", f: 1250, q: 14, gain: 0.07, lfo: { rate: 0.06, depth: 0.85, sweep: 380 } },
    { type: "lowpass", f: 300, q: 0.7, gain: 0.3, lfo: { rate: 0.08, depth: 0.6, sweep: 90 } }
  ] },
  jungle: { layers: [
    { type: "highpass", f: 3200, q: 0.6, gain: 0.05, lfo: { rate: 0.2, depth: 0.3, sweep: 0 } },
    { type: "lowpass", f: 600, q: 0.7, gain: 0.12, lfo: { rate: 0.05, depth: 0.3, sweep: 80 } }
  ], chirps: true }
};

/** Гром по вспышке: задержка (с), громкость и длина раската. near 0..1 — близость к центру экрана. */
export function thunderPlan(near, rnd = Math.random) {
  const k = Math.max(0, Math.min(1, near));
  return { delay: 0.6 + (1 - k) * 1.6 + rnd() * 0.4, gain: 0.15 + k * 0.55, dur: 2.2 + (1 - k) * 1.8 + rnd() * 0.8, cut: 160 + k * 260 };
}

const setting = (scope, k, d) => { try { return game.settings.get(scope, k); } catch { return d; } };
/** Итоговая громкость 0..1: своя настройка × «Окружение» Foundry. */
export const ambientVolume = (own = setting(SYSTEM_ID, "ambientVolume", 40), core = setting("core", "globalAmbientVolume", 1)) =>
  Math.max(0, Math.min(1, Number(own) / 100 * Number(core ?? 1)));

let ctx = null, out = null, noise = null, bed = null, chirpTimer = null, lastThunder = 0, unlockWait = null;

function audio() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain(); out.gain.value = ambientVolume() * 0.6; out.connect(ctx.destination);
    // 4 с розоватого шума: белый через простой интегратор, чтобы не шипело
    noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 3.2; }
  } catch { ctx = null; }
  return ctx;
}

/** Запустить звук после первого щелчка или клавиши (до этого браузер молчит). */
function whenUnlocked(f) {
  const c = audio();
  if (!c) return;
  if (c.state === "running") return f();
  c.resume?.().then(() => { if (c.state === "running") f(); }).catch(() => null);
  if (unlockWait) { unlockWait.f = f; return; }
  unlockWait = { f };
  const go = () => {
    for (const ev of ["pointerdown", "keydown"]) document.removeEventListener(ev, go, true);
    const w = unlockWait; unlockWait = null;
    c.resume?.().then(() => w?.f?.()).catch(() => null);
  };
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, go, true);
}

function stopBed(fade = 1.5) {
  clearTimeout(chirpTimer); chirpTimer = null;
  const b = bed; bed = null;
  if (!b || !ctx) return;
  const t = ctx.currentTime;
  b.gain.gain.cancelScheduledValues(t); b.gain.gain.setValueAtTime(b.gain.gain.value, t); b.gain.gain.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => b.nodes.forEach(n => { try { n.stop?.(); n.disconnect(); } catch { /* уже снят */ } }), fade * 1000 + 100);
}

function startBed(place) {
  const recipe = BEDS[place], c = ctx;
  if (!recipe || !c) return;
  const t = c.currentTime, gain = c.createGain(), nodes = [gain];
  gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + 3);
  gain.connect(out);
  for (const L of recipe.layers) {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noise; src.loop = true; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    f.type = L.type; f.frequency.value = L.f; f.Q.value = L.q;
    g.gain.value = L.gain * (1 - L.lfo.depth / 2);
    // медленная волна: громкость и частота фильтра качаются, как порывы или накат
    const lfo = c.createOscillator(), lg = c.createGain(), lf = c.createGain();
    lfo.frequency.value = L.lfo.rate * (0.85 + Math.random() * 0.3);
    lg.gain.value = L.gain * L.lfo.depth / 2; lf.gain.value = L.lfo.sweep;
    lfo.connect(lg).connect(g.gain); lfo.connect(lf).connect(f.frequency);
    src.connect(f).connect(g).connect(gain);
    src.start(t, Math.random() * 3); lfo.start(t);
    nodes.push(src, f, g, lfo, lg, lf);
  }
  bed = { place, gain, nodes };
  if (recipe.chirps) chirpLoop();
}

/* Тропики: пачка коротких свистов птицы или стрёкот цикады, раз в несколько секунд. */
function chirpLoop() {
  chirpTimer = setTimeout(() => {
    if (!bed || !ctx) return;
    const c = ctx, t = c.currentTime;
    if (Math.random() < 0.6) {
      const base = 2600 + Math.random() * 1800, count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const o = c.createOscillator(), g = c.createGain(), at = t + i * (0.12 + Math.random() * 0.05);
        o.frequency.setValueAtTime(base, at); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), at + 0.08);
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.025, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
        o.connect(g).connect(bed.gain); o.start(at); o.stop(at + 0.12);
      }
    } else {
      const o = c.createOscillator(), am = c.createOscillator(), ag = c.createGain(), g = c.createGain(), dur = 1.2 + Math.random() * 1.5;
      o.frequency.value = 4200 + Math.random() * 900; am.frequency.value = 28 + Math.random() * 10;
      ag.gain.value = 0.5; am.connect(ag).connect(g.gain);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012, t + 0.3); g.gain.setValueAtTime(0.012, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(bed.gain); o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
    }
    chirpLoop();
  }, 2000 + Math.random() * 5000);
  chirpTimer?.unref?.();
}

/** Раскат грома: глухой удар и несколько затухающих перекатов низкого шума. */
function thunder(near) {
  if (ambientVolume() <= 0 || !ctx || ctx.state !== "running") return;
  const now = performance.now();
  if (now - lastThunder < 1800) return;
  lastThunder = now;
  const p = thunderPlan(near), c = ctx, t = c.currentTime + p.delay;
  for (let i = 0; i < 4; i++) {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    const at = t + (i ? i * (0.25 + Math.random() * 0.45) : 0), peak = p.gain * (i ? 0.75 - i * 0.12 : 1), dur = p.dur * (i ? 0.6 : 1);
    src.buffer = noise; src.playbackRate.value = 0.5 + Math.random() * 0.2;
    f.type = "lowpass"; f.frequency.setValueAtTime(p.cut * (i ? 0.8 : 1.3), at); f.frequency.exponentialRampToValueAtTime(70, at + dur);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + (i ? 0.15 : 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out); src.start(at, Math.random() * 2); src.stop(at + dur + 0.1);
  }
}

/** Привести фон в соответствие сцене и громкости. */
export function refreshAmbient() {
  const vol = ambientVolume(), place = canvas?.ready ? canvas.scene?.getFlag?.(SYSTEM_ID, "place") : null;
  if (out && ctx) out.gain.setTargetAtTime(vol * 0.6, ctx.currentTime, 0.3);
  if (vol <= 0 || !BEDS[place]) return stopBed();
  if (bed?.place === place) return;
  whenUnlocked(() => { if (bed?.place === place) return; stopBed(); startBed(place); });
}

export function registerAmbient() {
  game.settings.register(SYSTEM_ID, "ambientVolume", {
    name: "Фоновый звук места", hint: "Ветер пустыни, метель, прибой, свист в горах, тропики и гром от молний на карте. У каждого своя громкость, 0 — тишина. Ползунок «Окружение» во вкладке плейлистов тоже влияет.",
    scope: "client", config: true, type: Number, range: { min: 0, max: 100, step: 10 }, default: 40, onChange: () => refreshAmbient()
  });
  Hooks.on("canvasReady", () => refreshAmbient());
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.place`)) refreshAmbient();
  });
  Hooks.on("updateSetting", s => { if (s.key === "core.globalAmbientVolume") refreshAmbient(); });
  Hooks.on("clientSettingChanged", key => { if (key === "core.globalAmbientVolume") refreshAmbient(); });
  // гром только когда звук уже разрешён: до первого щелчка раскаты не копятся
  onFlash(({ near }) => thunder(near));
}
