<script setup lang="ts">
import Phaser from "phaser";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CropRect } from "../types";
const props = defineProps<{
  question: { id: string; imageUrl: string; crop: CropRect };
  reveal?: { imageUrl: string };
  state: "ANSWERING" | "REVEAL" | "FINISHED";
}>();

const host = ref<HTMLDivElement>();
let phaserGame: Phaser.Game | undefined;
let scene: GuessScene | undefined;

class GuessScene extends Phaser.Scene {
  private currentImage?: Phaser.GameObjects.Image;
  private imageMask?: Phaser.Display.Masks.GeometryMask;

  create() {
    scene = this;
    this.cameras.main.setBackgroundColor("#101214");
    this.add.rectangle(480, 260, 854, 446, 0x080a0b).setStrokeStyle(2, 0xf2ff3d);
    this.add.text(54, 19, "PRTS // VISUAL FEED", {
      color: "#f2ff3d",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
    });
    renderCurrent();
  }

  showImage(url: string, crop?: CropRect) {
    const key = `asset:${url}`;
    const display = () => {
      this.currentImage?.destroy();
      this.imageMask?.destroy();
      const texture = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const frameWidth = 850;
      const frameHeight = 442;
      const visible = crop ?? { x: 0, y: 0, width: texture.width, height: texture.height, sourceWidth: texture.width, sourceHeight: texture.height };
      const scale = Math.min(frameWidth / visible.width, frameHeight / visible.height);
      const offsetX = (visible.x + visible.width / 2) - texture.width / 2;
      const offsetY = (visible.y + visible.height / 2) - texture.height / 2;
      const image = this.add.image(480 - offsetX * scale, 260 - offsetY * scale, key);
      image.setScale(scale);
      const maskShape = this.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff).fillRect(55, 39, frameWidth, frameHeight);
      this.imageMask = maskShape.createGeometryMask();
      image.setMask(this.imageMask);
      this.currentImage = image;
    };

    if (this.textures.exists(key)) display();
    else {
      this.load.image(key, url);
      this.load.once(Phaser.Loader.Events.COMPLETE, display);
      this.load.start();
    }
  }
}

function renderCurrent() {
  if (!scene) return;
  const isReveal = props.state !== "ANSWERING" && Boolean(props.reveal);
  scene.showImage(isReveal ? props.reveal!.imageUrl : props.question.imageUrl, isReveal ? undefined : props.question.crop);
}

watch(() => [props.question.id, props.state, props.reveal?.imageUrl, JSON.stringify(props.question.crop)], renderCurrent);

onMounted(() => {
  if (!host.value) return;
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host.value,
    width: 960,
    height: 520,
    backgroundColor: "#16191f",
    scene: GuessScene,
    render: { antialias: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
});

onBeforeUnmount(() => {
  scene = undefined;
  phaserGame?.destroy(true);
});
</script>

<template>
  <div ref="host" class="game-canvas" aria-label="猜图游戏画面" />
</template>
