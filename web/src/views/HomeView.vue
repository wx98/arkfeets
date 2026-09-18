<script setup lang="ts">
import GameCanvas from "../components/GameCanvas.vue";
</script>

<template>
  <main class="shell">
    <section class="hero-copy">
      <p class="eyebrow">ARKNIGHTS IMAGE QUIZ</p>
      <h1>粥批来猜∠</h1>
      <p class="lead">局部图像已经就位。认出它，然后在倒计时归零前给出答案。</p>
    </section>
    <GameCanvas />
  </main>
</template>
