<script setup lang="ts">
import { ArrowLeft, Play } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { Difficulty } from "../types";
import { loadGameSetup, saveGamePreferences, type GamePreferences } from "../api/gameSetup";

const router = useRouter();
const difficulty = ref<Difficulty>("medium");
const totalQuestions = ref(20);
const preferences = ref<GamePreferences>({ hintRemainingPercent: 20, revealSeconds: 10, autoNext: false });
const error = ref("");
onMounted(async () => {
  try { preferences.value = (await loadGameSetup()).preferences; }
  catch (caught) { error.value = caught instanceof Error ? caught.message : "设置加载失败"; }
});

const difficulties: Array<{ value: Difficulty; label: string; seconds: number; description: string }> = [
  { value: "simple", label: "简单", seconds: 90, description: "适合热身" },
  { value: "medium", label: "中等", seconds: 60, description: "标准节奏" },
  { value: "hard", label: "困难", seconds: 30, description: "快速识别" },
  { value: "hell", label: "地狱", seconds: 10, description: "凭直觉作答" },
];

async function start() {
  try {
    await saveGamePreferences(preferences.value);
    await router.push({ path: "/solo/play", query: { difficulty: difficulty.value, count: totalQuestions.value } });
  } catch (caught) { error.value = caught instanceof Error ? caught.message : "设置保存失败"; }
}
</script>

<template>
  <main class="page-shell setup-page">
    <header class="topbar">
      <button class="icon-button" title="返回首页" @click="router.push('/')"><ArrowLeft :size="20" /></button>
      <span class="brand-mark">粥批来猜∠ <small>PRTS</small></span>
      <span class="topbar__meta">SOLO CONFIG / 单人行动配置</span>
    </header>

    <section class="setup-content">
      <div class="section-heading">
        <p class="eyebrow">MISSION PARAMETERS / 行动参数</p>
        <h2>设置本局挑战</h2>
        <p class="section-heading__note">选择识别时限与题目数量，配置完成后立即开始行动。</p>
      </div>

      <fieldset class="option-group">
        <legend><span>01</span> 难度 / DIFFICULTY</legend>
        <div class="difficulty-grid">
          <label v-for="item in difficulties" :key="item.value" :class="['difficulty-option', { active: difficulty === item.value }]">
            <input v-model="difficulty" type="radio" :value="item.value" />
            <span class="difficulty-option__code">{{ String(difficulties.indexOf(item) + 1).padStart(2, '0') }}</span>
            <span class="difficulty-option__time">{{ item.seconds }}<small>SEC</small></span>
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="option-group">
        <legend><span>02</span> 题目数量 / QUESTION COUNT</legend>
        <div class="segmented-control">
          <label v-for="count in [20, 50, 100]" :key="count" :class="{ active: totalQuestions === count }">
            <input v-model="totalQuestions" type="radio" :value="count" />
            {{ count }} 题
          </label>
        </div>
        <p class="field-note">快速版本内置 3 道演示题，题库耗尽时会提前结算。</p>
      </fieldset>

      <fieldset class="option-group solo-game-options">
        <legend><span>03</span> 提示与揭晓</legend>
        <label>剩余时间 {{ preferences.hintRemainingPercent }}% 时提示<input v-model.number="preferences.hintRemainingPercent" type="range" min="0" max="100" step="5" /></label>
        <label class="setup-check"><input v-model="preferences.autoNext" type="checkbox" />自动进入下一题</label>
        <label>答案展示 {{ preferences.revealSeconds }} 秒<input v-model.number="preferences.revealSeconds" type="range" min="1" max="60" step="1" /></label>
      </fieldset>

      <div class="setup-action">
        <p v-if="error" class="error-text">{{ error }}</p>
        <span>CONFIGURATION READY</span>
        <button class="button button--primary start-button" @click="start"><Play :size="20" />开始识别</button>
      </div>
    </section>
  </main>
</template>
