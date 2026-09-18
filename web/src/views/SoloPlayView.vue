<script setup lang="ts">
import { ArrowLeft, ArrowRight, Heart, Lightbulb, RotateCcw, Send, SkipForward, Timer, Trophy } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { soloApi } from "../api/solo";
import GameCanvas from "../components/GameCanvas.vue";
import type { Difficulty, SoloGameView } from "../types";

const route = useRoute();
const router = useRouter();
const game = ref<SoloGameView>();
const answer = ref("");
const error = ref("");
const loading = ref(true);
const now = ref(Date.now());
const timeoutSubmitted = ref(false);
let ticker: number | undefined;

const secondsLeft = computed(() => game.value?.state === "ANSWERING"
  ? Math.max(0, Math.ceil((game.value.question.endsAt - now.value) / 1000))
  : 0);
const progress = computed(() => game.value
  ? Math.max(0, Math.min(100, (secondsLeft.value / game.value.question.durationSeconds) * 100))
  : 0);

onMounted(async () => {
  await createGame();
  ticker = window.setInterval(() => {
    now.value = Date.now();
    if (game.value?.state === "ANSWERING" && secondsLeft.value === 0 && !timeoutSubmitted.value) {
      timeoutSubmitted.value = true;
      perform(() => soloApi.timeout(game.value!.sessionId));
    }
  }, 200);
});

onBeforeUnmount(() => window.clearInterval(ticker));

async function createGame() {
  loading.value = true;
  error.value = "";
  const difficulty = String(route.query.difficulty ?? "medium") as Difficulty;
  const count = Number(route.query.count ?? 20);
  try {
    game.value = await soloApi.create(difficulty, count);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法开始游戏";
  } finally {
    loading.value = false;
  }
}

async function perform(action: () => Promise<SoloGameView>) {
  error.value = "";
  try {
    game.value = await action();
    answer.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "操作失败";
  }
}

function submit() {
  if (!game.value || !answer.value.trim()) return;
  perform(() => soloApi.answer(game.value!.sessionId, answer.value));
}

async function next() {
  if (!game.value) return;
  await perform(() => soloApi.next(game.value!.sessionId));
  timeoutSubmitted.value = false;
  now.value = Date.now();
}

const endReasonText = computed(() => ({
  COMPLETED: "任务完成",
  LIFE_EMPTY: "生命耗尽",
  QUESTION_EXHAUSTED: "演示题库已全部完成",
}[game.value?.endReason ?? "COMPLETED"]));
</script>

<template>
  <main class="play-page">
    <header class="topbar play-topbar">
      <button class="icon-button" title="退出本局" @click="router.push('/')"><ArrowLeft :size="20" /></button>
      <div class="round-label" v-if="game">QUESTION {{ String(game.question.index).padStart(2, '0') }} / {{ String(game.question.total).padStart(2, '0') }}</div>
      <div class="play-stats" v-if="game">
        <span><Trophy :size="17" />{{ game.stats.score }}</span>
        <span><Heart :size="17" />{{ game.stats.lives }}</span>
        <span :class="{ danger: secondsLeft <= 5 && game.state === 'ANSWERING' }"><Timer :size="17" />{{ game.state === 'ANSWERING' ? `${secondsLeft}s` : '--' }}</span>
      </div>
    </header>

    <div v-if="loading" class="center-state">正在抽取题目...</div>
    <div v-else-if="error && !game" class="center-state"><p>{{ error }}</p><button class="button" @click="router.push('/solo')">返回设置</button></div>

    <template v-else-if="game">
      <div class="timer-track"><div :style="{ width: `${progress}%` }" /></div>
      <section class="game-layout">
        <div class="game-stage">
          <div class="canvas-wrap">
            <GameCanvas :question="game.question" :reveal="game.reveal" :state="game.state" />
            <div v-if="game.feedback" class="feedback-banner">{{ game.feedback }}</div>
          </div>
        </div>

        <aside class="answer-panel">
          <template v-if="game.state === 'ANSWERING'">
            <div>
              <p class="eyebrow">YOUR ANSWER</p>
              <h2>识别目标</h2>
            </div>
            <form class="answer-form" @submit.prevent="submit">
              <input v-model="answer" autofocus maxlength="100" placeholder="输入答案" autocomplete="off" />
              <button class="button button--primary" type="submit"><Send :size="18" />提交</button>
            </form>
            <div class="hint-line"><Lightbulb :size="17" /><span>{{ game.question.hint ?? '本题暂无提示' }}</span></div>
            <button class="button button--quiet" @click="perform(() => soloApi.skip(game!.sessionId))"><SkipForward :size="18" />跳过，生命 -1</button>
          </template>

          <template v-else-if="game.state === 'REVEAL'">
            <div>
              <p class="eyebrow">IDENTIFIED</p>
              <h2>{{ game.reveal?.answers[0] }}</h2>
              <p class="answer-aliases" v-if="(game.reveal?.answers.length ?? 0) > 1">可接受：{{ game.reveal?.answers.join(' / ') }}</p>
            </div>
            <div class="reveal-stats"><span>得分<strong>{{ game.stats.score }}</strong></span><span>生命<strong>{{ game.stats.lives }}</strong></span></div>
            <button class="button button--primary" @click="next"><ArrowRight :size="19" />{{ game.question.index === game.question.total ? '查看结果' : '下一题' }}</button>
          </template>

          <template v-else>
            <div class="result-block">
              <p class="eyebrow">MISSION REPORT</p>
              <h2>{{ endReasonText }}</h2>
              <div class="result-score">{{ game.stats.score }}<small>分</small></div>
              <dl><div><dt>完成题目</dt><dd>{{ game.stats.attempted }}</dd></div><div><dt>正确率</dt><dd>{{ game.stats.correctRate }}%</dd></div><div><dt>剩余生命</dt><dd>{{ game.stats.lives }}</dd></div></dl>
            </div>
            <button class="button button--primary" @click="createGame"><RotateCcw :size="19" />再来一局</button>
            <button class="button button--quiet" @click="router.push('/')">返回主界面</button>
          </template>
          <p v-if="error" class="error-text">{{ error }}</p>
        </aside>
      </section>
    </template>
  </main>
</template>
