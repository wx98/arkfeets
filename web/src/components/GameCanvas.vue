<script setup lang="ts">
import Phaser from "phaser";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = defineProps<{
  question: { id: string; imageUrl: string };
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

  showImage(url: string) {
    const key = `asset:${url}`;
    const display = () => {
      this.currentImage?.destroy();
      this.imageMask?.destroy();
      const texture = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const image = this.add.image(480, 260, key);
      const frameWidth = 850;
      const frameHeight = 442;
      const scale = Math.min(frameWidth / texture.width, frameHeight / texture.height);
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
