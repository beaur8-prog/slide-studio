import { test, expect } from "@playwright/test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { createPresentationWindowController } = createRequire(import.meta.url)(
  "../electron/presentation-window.cjs",
);

class WindowDouble extends EventEmitter {
  fullscreen = false;
  menu = true;
  throttled = true;
  pending: boolean | null = null;
  requests: boolean[] = [];
  minimum: [number, number] = [1080, 720];
  getMinimumSize() {
    return [...this.minimum];
  }
  setMinimumSize(width: number, height: number) {
    this.minimum = [width, height];
  }
  webContents = {
    setBackgroundThrottling: (value: boolean) => {
      this.throttled = value;
    },
  };
  isDestroyed() {
    return false;
  }
  isFullScreen() {
    return this.fullscreen;
  }
  isMenuBarVisible() {
    return this.menu;
  }
  setMenuBarVisibility(value: boolean) {
    this.menu = value;
  }
  setFullScreen(value: boolean) {
    if (this.pending !== null)
      throw new Error("Overlapping native fullscreen requests");
    this.pending = value;
    this.requests.push(value);
  }
  resizeBeforeEvent() {
    this.fullscreen = this.pending!;
  }
  finish() {
    const value = this.pending;
    if (value === null) throw new Error("No pending fullscreen transition");
    this.fullscreen = value;
    this.pending = null;
    this.emit(value ? "enter-full-screen" : "leave-full-screen");
  }
  finishBeforeState() {
    const value = this.pending;
    if (value === null) throw new Error("No pending fullscreen transition");
    this.pending = null;
    this.emit(value ? "enter-full-screen" : "leave-full-screen");
    this.fullscreen = value;
  }
}
function setup() {
  const window = new WindowDouble();
  let ended = 0,
    entered = 0;
  const controller = createPresentationWindowController(window, {
    onEnded: () => ended++,
    onEntered: () => entered++,
  });
  return { window, controller, ended: () => ended, entered: () => entered };
}

test("stopping before initial fullscreen entry waits for entry before requesting exit", async () => {
  const { window, controller, ended, entered } = setup();
  controller.set(true);
  controller.set(false);
  expect(window.requests).toEqual([true]);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.requests).toEqual([true, false]);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(false);
  expect(controller.isPresenting).toBe(false);
  expect(ended()).toBe(0);
  expect(entered()).toBe(0);
  expect(window.menu).toBe(true);
  expect(window.throttled).toBe(true);
});

test("restart during an exit ignores its stale leave event and preserves the new show", async () => {
  const { window, controller, ended } = setup();
  controller.set(true);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.set(false);
  window.resizeBeforeEvent(); // Cocoa's geometry has settled but leave event is still pending.
  controller.set(true);
  expect(window.requests).toEqual([true, false]);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(controller.isPresenting).toBe(true);
  expect(ended()).toBe(0);
  expect(window.requests).toEqual([true, false, true]);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(true);
  controller.set(false);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(false);
  expect(window.menu).toBe(true);
});

test("stop and restart before initial entry keeps only the latest presentation intent", async () => {
  const { window, controller, ended, entered } = setup();
  controller.set(true);
  controller.set(false);
  controller.set(true);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.requests).toEqual([true]);
  expect(controller.isPresenting).toBe(true);
  expect(entered()).toBe(1);
  expect(ended()).toBe(0);
  controller.set(false);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(false);
});

test("an editor already in fullscreen stays fullscreen after normal presentation stop", async () => {
  const { window, controller, ended } = setup();
  window.fullscreen = true;
  controller.set(true);
  expect(window.menu).toBe(false);
  controller.set(false);
  expect(window.requests).toEqual([]);
  expect(window.fullscreen).toBe(true);
  expect(window.menu).toBe(true);
  expect(window.throttled).toBe(true);
  expect(ended()).toBe(0);
});

test("an actual native exit ends the current show and restores editor chrome once", async () => {
  const { window, controller, ended } = setup();
  controller.set(true);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  window.fullscreen = false;
  window.emit("leave-full-screen");
  expect(controller.isPresenting).toBe(false);
  expect(ended()).toBe(1);
  expect(window.requests).toEqual([true]);
  expect(window.menu).toBe(true);
  expect(window.throttled).toBe(true);
  controller.set(false);
  window.emit("leave-full-screen");
  expect(ended()).toBe(1);
});

test("native entry reported before isFullScreen updates does not leave a phantom transition", async () => {
  const { window, controller } = setup();
  controller.set(true);
  window.finishBeforeState();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.requests).toEqual([true]);
  controller.set(false);
  expect(window.requests).toEqual([true, false]);
  window.finishBeforeState();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(false);
  expect(controller.isPresenting).toBe(false);
});

test("restart waits for native exit state even when its event arrives first", async () => {
  const { window, controller, ended } = setup();
  controller.set(true);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.set(false);
  controller.set(true);
  window.finishBeforeState();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.requests).toEqual([true, false, true]);
  window.finishBeforeState();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.fullscreen).toBe(true);
  expect(controller.isPresenting).toBe(true);
  expect(ended()).toBe(0);
});

test("presentation removes editor minimum bounds until native fullscreen exit completes", async () => {
  const { window, controller } = setup();
  controller.set(true);
  expect(window.minimum).toEqual([0, 0]);
  window.finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.set(false);
  expect(window.minimum).toEqual([0, 0]);
  window.finishBeforeState();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.minimum).toEqual([1080, 720]);
});

test("a previously fullscreen editor restores its minimum only after the user leaves fullscreen", async () => {
  const { window, controller } = setup();
  window.fullscreen = true;
  controller.set(true);
  controller.set(false);
  expect(window.minimum).toEqual([0, 0]);
  window.fullscreen = false;
  window.emit("leave-full-screen");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(window.minimum).toEqual([1080, 720]);
});
