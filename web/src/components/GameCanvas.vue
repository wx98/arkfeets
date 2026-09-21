<script setup lang="ts">
import Phaser from "phaser";
import { Minus, Plus, X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CropRect } from "../types";

const props = defineProps<{
  question: { id: string; imageUrl: string; crop: CropRect };
  reveal?: { imageUrl: string };
  state: "ANSWERING" | "REVEAL" | "FINISHED";
}>();

const host = ref<HTMLDivElement>();
const cropPreview = ref("");
const viewerOpen = ref(false);
const viewerZoom = ref(1);
const viewerPan = ref({ x: 0, y: 0 });
let phaserGame: Phaser.Game | undefined;
let scene: GuessScene | undefined;
let drag: { x: number; y: number; panX: number; panY: number } | undefined;
let renderVersion = 0;

const FRAME = { x: 55, y: 39, width: 850, height: 442 };

function actualCrop(crop: CropRect, image: HTMLImageElement) {
  const sx = image.naturalWidth / crop.sourceWidth;
  const sy = image.naturalHeight / crop.sourceHeight;
  const x = Math.max(0, Math.min(image.naturalWidth - 1, crop.x * sx));
  const y = Math.max(0, Math.min(image.naturalHeight - 1, crop.y * sy));
  return {
    x, y,
    width: Math.max(1, Math.min(image.naturalWidth - x, crop.width * sx)),
    height: Math.max(1, Math.min(image.naturalHeight - y, crop.height * sy)),
  };
}

class GuessScene extends Phaser.Scene {
  private currentImage?: Phaser.GameObjects.Image;
  private imageMask?: Phaser.Display.Masks.GeometryMask;
  private revealTween?: Phaser.Tweens.Tween;
  private cropTextureKey?: string;

  create() {
    scene = this;
    this.cameras.main.setBackgroundColor("#101214");
    this.drawTransparencyGrid();
    const frame = this.add.graphics();
    frame.lineStyle(2, 0xf2ff3d);
    frame.strokeRect(53, 37, 854, 446);
    this.add.text(54, 19, "PRTS // VISUAL FEED", {
      color: "#f2ff3d", fontFamily: "Arial, sans-serif", fontSize: "12px", fontStyle: "bold",
    });
    renderCurrent();
  }

  private drawTransparencyGrid() {
    const grid = this.add.graphics();
    const cellSize = 18;
    for (let y = 0; y < FRAME.height; y += cellSize) {
      for (let x = 0; x < FRAME.width; x += cellSize) {
        grid.fillStyle((x / cellSize + y / cellSize) % 2 === 0 ? 0xf2f4f3 : 0xd5d9d7);
        grid.fillRect(FRAME.x + x, FRAME.y + y, Math.min(cellSize, FRAME.width - x), Math.min(cellSize, FRAME.height - y));
      }
    }
  }

  private clearImage() {
    this.revealTween?.stop();
    this.revealTween = undefined;
    this.currentImage?.destroy();
    this.currentImage = undefined;
    this.imageMask?.destroy();
    this.imageMask = undefined;
    if (this.cropTextureKey) this.textures.remove(this.cropTextureKey);
    this.cropTextureKey = undefined;
  }

  showQuestion(url: string, crop: CropRect, reveal: boolean) {
    const version = ++renderVersion;
    const key = `asset:${url}`;
    this.clearImage();
    const display = () => {
      if (version !== renderVersion || !this.sys.isActive()) return;
      const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const region = actualCrop(crop, source);
      const cropped = document.createElement("canvas");
      cropped.width = Math.max(1, Math.round(region.width));
      cropped.height = Math.max(1, Math.round(region.height));
      cropped.getContext("2d")!.drawImage(
        source, region.x, region.y, region.width, region.height, 0, 0, cropped.width, cropped.height,
      );
      this.cropTextureKey = `crop:${version}`;
      this.textures.addCanvas(this.cropTextureKey, cropped);
      cropPreview.value = cropped.toDataURL("image/png");
      const maskShape = this.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff)
        .fillRect(FRAME.x, FRAME.y, FRAME.width, FRAME.height);
      this.imageMask = maskShape.createGeometryMask();
      const image = this.add.image(480, 260, this.cropTextureKey);
      image.setScale(Math.min(FRAME.width / cropped.width, FRAME.height / cropped.height));
      image.setMask(this.imageMask);
      this.currentImage = image;
      if (reveal) this.expandToFull(key, region, source);
    };
    if (this.textures.exists(key)) display();
    else {
      this.load.image(key, url);
      this.load.once(Phaser.Loader.Events.COMPLETE, display);
      this.load.start();
    }
  }

  revealQuestion(url: string, crop: CropRect) {
    const key = `asset:${url}`;
    if (!this.textures.exists(key)) {
      this.showQuestion(url, crop, true);
      return;
    }
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    this.expandToFull(key, actualCrop(crop, source), source);
  }

  private expandToFull(key: string, region: { x: number; y: number; width: number; height: number }, source: HTMLImageElement) {
    if (!this.currentImage) return;
    this.revealTween?.stop();
    this.currentImage.setTexture(key);
    const image = this.currentImage;
    const place = (progress: number) => {
      const x = region.x * (1 - progress);
      const y = region.y * (1 - progress);
      const width = region.width + (source.naturalWidth - region.width) * progress;
      const height = region.height + (source.naturalHeight - region.height) * progress;
      const scale = Math.min(FRAME.width / width, FRAME.height / height);
      image.setCrop(x, y, width, height);
      image.setScale(scale);
      image.setPosition(
        480 - (x + width / 2 - source.naturalWidth / 2) * scale,
        260 - (y + height / 2 - source.naturalHeight / 2) * scale,
      );
    };
    place(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      place(1);
      return;
    }
    this.revealTween = this.tweens.addCounter({
      from: 0, to: 1, duration: 1150, ease: "Sine.easeInOut",
      onUpdate: (tween) => place(tween.getValue() ?? 1),
      onComplete: () => { this.revealTween = undefined; },
    });
  }
}

function renderCurrent(previousState?: string, previousId?: string) {
  if (!scene) return;
  if (props.question.id !== previousId || previousState === undefined) {
    viewerOpen.value = false;
    cropPreview.value = "";
    scene.showQuestion(props.question.imageUrl, props.question.crop, props.state !== "ANSWERING");
  } else if (previousState === "ANSWERING" && props.state !== "ANSWERING") {
    viewerOpen.value = false;
    scene.revealQuestion(props.reveal?.imageUrl ?? props.question.imageUrl, props.question.crop);
  }
}

watch(() => [props.question.id, props.question.imageUrl, JSON.stringify(props.question.crop), props.state] as const,
  (next, previous) => renderCurrent(previous?.[3], previous?.[0] === next[0] && previous?.[2] === next[2] ? next[0] : undefined));

function openViewer() {
  if (!cropPreview.value || props.state !== "ANSWERING") return;
  viewerZoom.value = 1;
  viewerPan.value = { x: 0, y: 0 };
  viewerOpen.value = true;
}
function closeViewer() { viewerOpen.value = false; }
function zoomBy(factor: number) { viewerZoom.value = Math.max(1, Math.min(8, viewerZoom.value * factor)); }
function onWheel(event: WheelEvent) { zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2); }
function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  drag = { x: event.clientX, y: event.clientY, panX: viewerPan.value.x, panY: viewerPan.value.y };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (!drag) return;
  viewerPan.value = { x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y };
}
function stopDrag() { drag = undefined; }
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && viewerOpen.value) closeViewer();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  if (!host.value) return;
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO, parent: host.value, width: 960, height: 520,
    backgroundColor: "#16191f", scene: GuessScene, render: { antialias: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  renderVersion++;
  scene = undefined;
  phaserGame?.destroy(true);
});
</script>

<template>
  <div class="game-canvas-shell">
    <div ref="host" class="game-canvas" aria-label="猜图游戏画面" />
    <button v-if="state === 'ANSWERING' && cropPreview" class="game-canvas-open"
      type="button" title="放大查看谜面" aria-label="放大查看谜面" @click="openViewer" />
  </div>
  <div v-if="viewerOpen && state === 'ANSWERING'" class="game-viewer-backdrop" @click.self="closeViewer" @keydown.esc="closeViewer">
    <section class="game-viewer" role="dialog" aria-modal="true" aria-label="谜面查看器">
      <header>
        <strong>谜面放大查看</strong>
        <div>
          <button class="icon-button" title="缩小" aria-label="缩小" @click="zoomBy(1 / 1.25)"><Minus :size="18" /></button>
          <button class="icon-button" title="放大" aria-label="放大" @click="zoomBy(1.25)"><Plus :size="18" /></button>
          <button class="icon-button" title="关闭" aria-label="关闭" @click="closeViewer"><X :size="18" /></button>
        </div>
      </header>
      <div class="game-viewer__stage" @wheel.prevent="onWheel" @pointerdown="startDrag"
        @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag"
        @lostpointercapture="stopDrag">
        <img :src="cropPreview" alt="当前谜面裁切内容" draggable="false"
          :style="{ transform: `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom})` }" />
      </div>
    </section>
  </div>
</template>
