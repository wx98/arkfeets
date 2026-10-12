<script setup lang="ts">
import { Zap } from "lucide-vue-next";

defineProps<{ nickname: string }>();
</script>

<template>
  <div class="game-win-banner">
    <Zap class="game-win-banner__icon" :size="28" aria-hidden="true" />
    <strong>恭喜 {{ nickname }} 猜中！！！</strong>
    <Zap class="game-win-banner__icon" :size="28" aria-hidden="true" />
  </div>
</template>
