// Plant World on a little Game Boy Advance SP in the browser. The emulator is binjgb by
// Ben Smith (MIT), compiled to WebAssembly (vendor/). This file hands it the
// cartridge, draws its frames, plays its sound, keeps its save, and passes
// it your button presses.

const ROM = "plant-world.gb";
const SAVE_KEY = "plant-world:save";

const TICKS_PER_SECOND = 4194304;
const MAX_STEP = 5 / 60; // never run more than 5 frames to catch up
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY = 0.1;
const VOLUME = 0.5;
const NEW_FRAME = 1;
const AUDIO_FULL = 2;
const REACHED = 4;

const $ = (sel) => document.querySelector(sel);
const canvas = $("#screen");
const screen = canvas.getContext("2d");
const image = screen.createImageData(160, 144);
const note = $("#note");

function say(text) {
  note.textContent = text;
  note.hidden = !text;
}

// ---- Sound ----

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audio = AudioCtx ? new AudioCtx() : null;
let soundOn = true;
let audioAt = 0;

// Browsers only allow sound after you press something.
function wake() {
  if (audio && audio.state !== "running") audio.resume().catch(() => {});
}
for (const type of ["keydown", "pointerdown"]) window.addEventListener(type, wake, true);

function playSound(samples) {
  if (!audio || audio.state !== "running" || !soundOn) {
    audioAt = 0;
    return;
  }
  const now = audio.currentTime;
  if (audioAt < now) audioAt = now + AUDIO_LATENCY;
  const buffer = audio.createBuffer(2, AUDIO_FRAMES, audio.sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < AUDIO_FRAMES; i++) {
    left[i] = (samples[2 * i] * VOLUME) / 255;
    right[i] = (samples[2 * i + 1] * VOLUME) / 255;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start(audioAt);
  audioAt += AUDIO_FRAMES / audio.sampleRate;
}

const soundBtn = $("#sound");
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
  soundBtn.setAttribute("aria-pressed", String(soundOn));
});

// ---- The emulator ----

let m = null; // the WebAssembly module
let e = 0; // the emulator
let frame = null;
let samples = null;

const view = (ptr, size) => new Uint8Array(m.HEAPU8.buffer, ptr, size);

// binjgb passes save files through a scratch buffer it owns.
function withSaveBuffer(fn) {
  const file = m._ext_ram_file_data_new(e);
  try {
    return fn(file, view(m._get_file_data_ptr(file), m._get_file_data_size(file)));
  } finally {
    m._file_data_delete(file);
  }
}

// ---- The save (high scores and unlocked levels), kept in this browser ----

function loadSave() {
  let saved = null;
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text) saved = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return;
  }
  if (!saved) return;
  withSaveBuffer((file, buffer) => {
    if (buffer.length !== saved.length) return;
    buffer.set(saved);
    m._emulator_read_ext_ram(e, file);
  });
}

let saveDirty = false;
function writeSave() {
  if (!e || !saveDirty) return;
  saveDirty = false;
  const bytes = withSaveBuffer((file, buffer) => {
    m._emulator_write_ext_ram(e, file);
    return buffer.slice();
  });
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  try {
    localStorage.setItem(SAVE_KEY, btoa(text));
  } catch {
    // Private windows can refuse; the game still plays.
  }
}
setInterval(writeSave, 1000);
window.addEventListener("pagehide", writeSave);

// ---- Buttons ----

const BUTTONS = ["up", "down", "left", "right", "A", "B", "start", "select"];
const sources = { keys: new Set(), touch: new Map(), pad: new Set() };
const held = new Set();
const onScreen = {};
for (const el of document.querySelectorAll("[data-dir], [data-button]")) {
  onScreen[el.dataset.dir ?? el.dataset.button] = el;
}

// The game reads the buttons once a frame, so even the quickest tap is held
// for two frames.
let frames = 0;
const pressedAt = {};

// Combine the keyboard, touch and controllers, and tell the emulator what
// changed.
function syncButtons() {
  const now = new Set([...sources.keys, ...sources.pad]);
  for (const set of sources.touch.values()) for (const b of set) now.add(b);
  for (const b of BUTTONS) {
    let down = now.has(b);
    if (!down && held.has(b) && frames - pressedAt[b] < 2) down = true;
    if (down === held.has(b)) continue;
    if (down) {
      held.add(b);
      pressedAt[b] = frames;
    } else {
      held.delete(b);
    }
    if (e) m[`_set_joyp_${b}`](e, down ? 1 : 0);
    onScreen[b]?.classList.toggle("pressed", down);
  }
}

const KEYS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  KeyX: "A",
  KeyK: "A",
  Space: "A",
  KeyZ: "B",
  KeyJ: "B",
  Enter: "start",
  ShiftLeft: "select",
  ShiftRight: "select",
  Backspace: "select",
};

window.addEventListener("keydown", (ev) => {
  if ((ev.code === "KeyL" || ev.code === "KeyR") && !ev.repeat && !ev.metaKey && !ev.ctrlKey) {
    toggleStretch();
    return;
  }
  const b = KEYS[ev.code];
  if (!b || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  // Leave Enter and Space to links and page buttons that have focus.
  if ((ev.code === "Enter" || ev.code === "Space") && ev.target.closest?.("a, button")) return;
  ev.preventDefault();
  sources.keys.add(b);
  syncButtons();
});
window.addEventListener("keyup", (ev) => {
  const b = KEYS[ev.code];
  if (!b) return;
  sources.keys.delete(b);
  syncButtons();
});
window.addEventListener("blur", () => {
  sources.keys.clear();
  syncButtons();
});

// Touch: each finger holds whatever it's on. The pad reads which way your
// thumb leans from its middle, so you can roll between directions (and
// diagonals) without lifting.
function padDirections(pad, ev) {
  const r = pad.getBoundingClientRect();
  const x = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const y = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const dirs = new Set();
  if (Math.hypot(x, y) < 0.2) return dirs;
  if (x > 0.2 && x > Math.abs(y) * 0.5) dirs.add("right");
  if (x < -0.2 && -x > Math.abs(y) * 0.5) dirs.add("left");
  if (y > 0.2 && y > Math.abs(x) * 0.5) dirs.add("down");
  if (y < -0.2 && -y > Math.abs(x) * 0.5) dirs.add("up");
  return dirs;
}

// Keep getting a finger's moves and lift even if it slides off the button.
function capture(el, ev) {
  try {
    el.setPointerCapture(ev.pointerId);
  } catch {
    // Not every pointer can be captured; the window still hears the lift.
  }
}

function touchDown(ev, buttons) {
  const before = sources.touch.get(ev.pointerId);
  const fresh = [...buttons].some((b) => !before?.has(b));
  if (fresh && navigator.vibrate) navigator.vibrate(8);
  sources.touch.set(ev.pointerId, buttons);
  syncButtons();
}

const pad = $("[data-pad]");
pad.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  capture(pad, ev);
  touchDown(ev, padDirections(pad, ev));
});
pad.addEventListener("pointermove", (ev) => {
  if (sources.touch.has(ev.pointerId)) touchDown(ev, padDirections(pad, ev));
});

for (const el of document.querySelectorAll("[data-button]")) {
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    capture(el, ev);
    touchDown(ev, new Set([el.dataset.button]));
  });
}

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  window.addEventListener(type, (ev) => {
    if (sources.touch.delete(ev.pointerId)) syncButtons();
  });
}

// ---- The SP's own buttons ----

const lcd = $("#lcd");
const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem("plant-world:screen")) ?? {};
  } catch {
    return {};
  }
})();
function keepPrefs() {
  try {
    localStorage.setItem("plant-world:screen", JSON.stringify(prefs));
  } catch {
    // Fine to forget.
  }
}

// L or R stretches a Game Boy game to fill the SP's wider screen, like the
// real one.
function toggleStretch() {
  prefs.stretched = !prefs.stretched;
  lcd.classList.toggle("stretched", prefs.stretched);
  keepPrefs();
}
lcd.classList.toggle("stretched", Boolean(prefs.stretched));

// The light button turns the screen light off and on.
lcd.classList.toggle("dim", Boolean(prefs.dim));
function toggleLight() {
  prefs.dim = !prefs.dim;
  lcd.classList.toggle("dim", prefs.dim);
  keepPrefs();
}

function tapButton(el, action) {
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.classList.add("pressed");
    if (navigator.vibrate) navigator.vibrate(8);
    action();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    el.addEventListener(type, () => el.classList.remove("pressed"));
  }
}
for (const el of document.querySelectorAll("[data-shoulder]")) tapButton(el, toggleStretch);
tapButton($("[data-light]"), toggleLight);

// Game controllers, laid out like a Game Boy: the right face button is A,
// the bottom one B.
const padShoulders = new Map();
function readGamepads() {
  const pads = navigator.getGamepads?.() ?? [];
  sources.pad.clear();
  for (const p of pads) {
    if (!p) continue;
    const on = (i) => p.buttons[i]?.pressed;
    const [ax = 0, ay = 0] = p.axes;
    if (on(12) || ay < -0.5) sources.pad.add("up");
    if (on(13) || ay > 0.5) sources.pad.add("down");
    if (on(14) || ax < -0.5) sources.pad.add("left");
    if (on(15) || ax > 0.5) sources.pad.add("right");
    if (on(1) || on(3)) sources.pad.add("A");
    if (on(0) || on(2)) sources.pad.add("B");
    if (on(9)) sources.pad.add("start");
    if (on(8)) sources.pad.add("select");
    const shoulder = on(4) || on(5);
    if (shoulder && !padShoulders.get(p.index)) toggleStretch();
    padShoulders.set(p.index, shoulder);
  }
  syncButtons();
}

// ---- Running ----

let lastSec = 0;
let leftover = 0;

function runUntil(ticks) {
  let drew = false;
  for (;;) {
    const event = m._emulator_run_until_f64(e, ticks);
    if (event & NEW_FRAME) {
      image.data.set(frame);
      drew = true;
      frames += 1;
    }
    if (event & AUDIO_FULL) playSound(samples);
    if (event & REACHED) break;
  }
  if (drew) screen.putImageData(image, 0, 0);
  if (m._emulator_was_ext_ram_updated(e)) saveDirty = true;
}

function tick(ms) {
  requestAnimationFrame(tick);
  const sec = ms / 1000;
  const step = Math.min(Math.max(sec - (lastSec || sec), 0), MAX_STEP);
  lastSec = sec;
  readGamepads();
  const target = m._emulator_get_ticks_f64(e) + step * TICKS_PER_SECOND - leftover;
  runUntil(target);
  leftover = m._emulator_get_ticks_f64(e) - target;
  syncButtons();
}

// Coming back to the tab shouldn't fast-forward to catch up.
document.addEventListener("visibilitychange", () => {
  lastSec = 0;
  if (document.hidden) writeSave();
});

async function start() {
  say("Loading...");
  try {
    const [module, rom] = await Promise.all([
      window.Binjgb(),
      fetch(ROM).then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    m = module;
    // The SP plays it in color, as a Game Boy Color would.
    const cart = new Uint8Array(rom);
    const size = (cart.length + 0x7fff) & ~0x7fff;
    const ptr = m._malloc(size);
    view(ptr, size).fill(0).set(cart);
    e = m._emulator_new_simple(ptr, size, audio?.sampleRate ?? 44100, AUDIO_FRAMES, 0);
    if (!e) throw new Error("The emulator couldn't read the cartridge.");
    m._emulator_set_default_joypad_callback(e, m._joypad_new());
    frame = view(m._get_frame_buffer_ptr(e), m._get_frame_buffer_size(e));
    samples = view(m._get_audio_buffer_ptr(e), m._get_audio_buffer_capacity(e));
    loadSave();
    for (const b of held) m[`_set_joyp_${b}`](e, 1);
    say("");
    $("#led").classList.add("on");
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    say("The game couldn't start in this browser. Try another, or download the ROM.");
  }
}

start();
