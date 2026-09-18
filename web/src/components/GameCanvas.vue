<script setup lang="ts">
import Phaser from "phaser";
import { onBeforeUnmount, onMounted, ref } from "vue";

const host = ref<HTMLDivElement>();
let game: Phaser.Game | undefined;

class BootScene extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#171a20");
    this.add.rectangle(480, 230, 720, 320, 0x242933).setStrokeStyle(2, 0xe6ff55);
    this.add.text(480, 205, "READY?", {
      color: "#e6ff55",
      fontFamily: "Arial Black, sans-serif",
      fontSize: "58px",
    }).setOrigin(0.5);
    this.add.text(480, 270, "PHASER SYSTEM ONLINE", {
      color: "#f5f7fb",
      fontFamily: "Arial, sans-serif",
      fontSize: "18px",
    }).setOrigin(0.5);
  }
}

onMounted(() => {
  if (!host.value) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host.value,
    width: 960,
    height: 460,
    backgroundColor: "#171a20",
    scene: BootScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
});

onBeforeUnmount(() => game?.destroy(true));
</script>

<template>
  <div ref="host" class="game-canvas" aria-label="游戏画布" />
</template>
