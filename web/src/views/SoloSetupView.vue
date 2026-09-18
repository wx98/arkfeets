<script setup lang="ts">
import { ArrowLeft, Play } from "lucide-vue-next";
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { Difficulty } from "../types";

const router = useRouter();
const difficulty = ref<Difficulty>("medium");
const totalQuestions = ref(20);

const difficulties: Array<{ value: Difficulty; label: string; seconds: number; description: string }> = [
  { value: "simple", label: "简单", seconds: 90, description: "适合热身" },
  { value: "medium", label: "中等", seconds: 60, description: "标准节奏" },
  { value: "hard", label: "困难", seconds: 30, description: "快速识别" },
  { value: "hell", label: "地狱", seconds: 10, description: "凭直觉作答" },
];

function start() {
  router.push({ path: "/solo/play", query: { difficulty: difficulty.value, count: totalQuestions.value } });
}
</script>

<template>
  <main class="page-shell setup-page">
    <header class="topbar">
      <button class="icon-button" title="返回首页" @click="router.push('/')"><ArrowLeft :size="20" /></button>
      <span class="brand-mark">粥批来猜∠</span>
      <span class="topbar__meta">SOLO CONFIG</span>
    </header>

    <section class="setup-content">
      <div class="section-heading">
        <p class="eyebrow">MISSION PARAMETERS</p>
        <h2>设置本局挑战</h2>
      </div>

      <fieldset class="option-group">
        <legend>难度</legend>
        <div class="difficulty-grid">
          <label v-for="item in difficulties" :key="item.value" :class="['difficulty-option', { active: difficulty === item.value }]">
            <input v-model="difficulty" type="radio" :value="item.value" />
            <span class="difficulty-option__time">{{ item.seconds }}<small>秒</small></span>
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="option-group">
        <legend>题目数量</legend>
        <div class="segmented-control">
          <label v-for="count in [20, 50, 100]" :key="count" :class="{ active: totalQuestions === count }">
            <input v-model="totalQuestions" type="radio" :value="count" />
            {{ count }} 题
          </label>
        </div>
        <p class="field-note">快速版本内置 3 道演示题，题库耗尽时会提前结算。</p>
      </fieldset>

      <button class="button button--primary start-button" @click="start"><Play :size="20" />开始识别</button>
    </section>
  </main>
</template>
