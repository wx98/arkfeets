<script setup lang="ts">
import Phaser from "phaser";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SoloGameView, SoloState } from "../types";

const props = defineProps<{
  question: SoloGameView["question"];
  reveal?: SoloGameView["reveal"];
  state: SoloState;
}>();

const host = ref<HTMLDivElement>();
let phaserGame: Phaser.Game | undefined;
let scene: GuessScene | undefined;

class GuessScene extends Phaser.Scene {
  private currentImage?: Phaser.GameObjects.Image;
  private imageMask?: Phaser.Display.Masks.GeometryMask;

  create() {
    scene = this;
    this.cameras.main.setBackgroundColor("#16191f");
    this.add.rectangle(480, 260, 844, 444, 0x0d0f13).setStrokeStyle(1, 0x59606d);
    this.add.text(58, 24, "VISUAL FEED", {
      color: "#e6ff55",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      fontStyle: "bold",
    });
    renderCurrent();
  }

  showImage(url: string) {
    const key = `asset:${url}`;
    const display = () => {
      this.currentImage?.destroy();
      this.imageMask?.destroy();
      const texture = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const image = this.add.image(480, 260, key);
      const frameWidth = 840;
      const frameHeight = 440;
      const scale = Math.min(frameWidth / texture.width, frameHeight / texture.height);
      image.setScale(scale);
      const maskShape = this.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff).fillRect(60, 40, frameWidth, frameHeight);
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
  scene.showImage(isReveal ? props.reveal!.imageUrl : props.question.imageUrl);
}

watch(() => [props.question.id, props.state, props.reveal?.imageUrl], renderCurrent);

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
