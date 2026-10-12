<script setup lang="ts">
import { ArrowLeft, Cable, LogIn, Radio, Tv, Users } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getClientSessionId, multiplayerSocket } from "../multiplayer/socket";
import type { AnswerSource, Difficulty } from "../types";
import { appName } from "../api/site";
import { loadGameSetup, saveRoomSetup, type GamePreferences, type GameTopic, type RoomSetup } from "../api/gameSetup";

const router = useRouter();
const nickname = ref(localStorage.getItem("arkfeets:nickname") ?? "博士");
const roomCode = ref("");
const difficulty = ref<Difficulty>("medium");
const requestedCount = ref(20);
const answerSource = ref<AnswerSource>("WEB");
const topics = ref<GameTopic[]>([]);
const topicId = ref("");
const customDuration = ref(false);
const durationSeconds = ref(60);
const durationMin = ref(5);
const durationMax = ref(60);
const durationMinInput = ref("5");
const durationMaxInput = ref("60");
const preferences = ref<GamePreferences>({ hintRemainingPercent: 20, revealSeconds: 10, autoNext: false });
const difficultyOptions: Array<{ value: Difficulty; label: string; seconds: number }> = [
  { value: "simple", label: "简单", seconds: 90 },
  { value: "medium", label: "中等", seconds: 60 },
  { value: "hard", label: "困难", seconds: 30 },
  { value: "hell", label: "地狱", seconds: 10 },
];
const selectedDuration = computed(() => customDuration.value ? durationSeconds.value : difficultyOptions.find(item => item.value === difficulty.value)!.seconds);
const durationFill = computed(() => {
  const value = Number(durationSeconds.value);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, (value - durationMin.value) / (durationMax.value - durationMin.value) * 100)) : 0;
});
const busy = ref(false);
const error = ref("");
onMounted(async () => {
  try {
    const setup = await loadGameSetup();
    topics.value = setup.topics;
    topicId.value = setup.topics.find(item => item.isDefault)?.id ?? setup.topics[0]?.id ?? "";
    preferences.value = setup.preferences;
    if (setup.roomSetup) {
      const saved = setup.roomSetup;
      if (setup.topics.some(item => item.id === saved.topicId)) topicId.value = saved.topicId;
      difficulty.value = saved.difficulty;
      requestedCount.value = saved.requestedCount;
      answerSource.value = saved.answerSource;
      customDuration.value = saved.customDuration;
      durationSeconds.value = saved.durationSeconds;
      durationMin.value = saved.durationMin;
      durationMax.value = saved.durationMax;
      durationMinInput.value = String(saved.durationMin);
      durationMaxInput.value = String(saved.durationMax);
      preferences.value = saved.preferences;
    }
  } catch (caught) { error.value = caught instanceof Error ? caught.message : "设置加载失败"; }
});

function setDurationRange(edge: "min" | "max") {
  if (edge === "min") {
    durationMin.value = Math.max(5, Math.min(599, Math.round(Number(durationMinInput.value) || 5)));
    durationMax.value = Math.max(durationMax.value, durationMin.value + 1);
  } else {
    durationMax.value = Math.max(6, Math.min(600, Math.round(Number(durationMaxInput.value) || 60)));
    durationMin.value = Math.min(durationMin.value, durationMax.value - 1);
  }
  durationSeconds.value = Math.max(durationMin.value, Math.min(durationMax.value, durationSeconds.value));
  durationMinInput.value = String(durationMin.value);
  durationMaxInput.value = String(durationMax.value);
}

function normalizeDuration() {
  durationSeconds.value = Math.max(durationMin.value, Math.min(durationMax.value, Math.round(Number(durationSeconds.value) || durationMin.value)));
}

async function enter(mode: "create" | "join") {
  error.value = "";
  const name = nickname.value.trim();
  const code = roomCode.value.replace(/\s/gu, "");
  if (!name || code.length < 2) {
    error.value = "请输入玩家代号和至少 2 个字符的房间号";
    return;
  }
  busy.value = true;
  localStorage.setItem("arkfeets:nickname", name);
  try {
    const identity = { sessionId: getClientSessionId(), nickname: name, roomCode: code };
    const room = mode === "create"
      ? await (async () => {
        if (!topicId.value) throw new Error("请选择主题");
        if (!Number.isInteger(selectedDuration.value) || selectedDuration.value < 5 || selectedDuration.value > 600) throw new Error("单题时间需为 5-600 秒");
        return multiplayerSocket.create({ ...identity, difficulty: difficulty.value, requestedCount: requestedCount.value, topicId: topicId.value, durationSeconds: selectedDuration.value, preferences: preferences.value, answerSource: answerSource.value });
      })()
      : await multiplayerSocket.join(identity);
    if (room) {
      let saveNotice = "";
      if (mode === "create") {
        const setup: RoomSetup = {
          topicId: topicId.value, difficulty: difficulty.value, requestedCount: requestedCount.value as RoomSetup["requestedCount"],
          answerSource: answerSource.value, customDuration: customDuration.value, durationSeconds: durationSeconds.value,
          durationMin: durationMin.value, durationMax: durationMax.value, preferences: preferences.value,
        };
        try { await saveRoomSetup(setup); }
        catch { saveNotice = "房间已创建，但本次建房配置未能保存"; }
      }
      await router.push({ path: `/multi/${encodeURIComponent(room.roomCode)}`, query: saveNotice ? { notice: saveNotice } : {} });
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法进入房间";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page-shell multi-setup-page">
    <header class="topbar">
      <button class="icon-button" title="返回首页" @click="router.push('/')"><ArrowLeft :size="20" /></button>
      <span class="brand-mark">{{ appName }} <small>MULTI</small></span>
      <span class="topbar__meta">ROOM TERMINAL / 多人房间</span>
    </header>

    <section class="multi-setup">
      <div class="section-heading">
        <p class="eyebrow">SQUAD LINK / 小队连接</p>
        <h2>创建或加入房间</h2>
        <p class="section-heading__note">同一局域网或同一服务器的玩家，使用相同房间号集合。</p>
      </div>

      <div class="multi-setup__grid">
        <section class="terminal-form">
          <label>01 玩家代号 / CODENAME<input v-model="nickname" maxlength="20" /></label>
          <label>02 房间号 / ROOM CODE<input v-model="roomCode" maxlength="20" placeholder="例如 618" @keyup.enter="enter('join')" /></label>
          <p v-if="error" class="error-text">{{ error }}</p>
          <button class="button join-button" :disabled="busy" @click="enter('join')"><LogIn :size="19" />加入已有房间</button>
        </section>

        <section class="create-config">
          <div class="create-config__title"><Radio :size="20" /><div><strong>创建新房间</strong><small>CREATE ROOM</small></div></div>
          <label class="setup-field">主题
            <select v-model="topicId"><option v-for="topic in topics" :key="topic.id" :value="topic.id">{{ topic.name }}{{ topic.isDefault ? ' · 默认' : '' }}</option></select>
          </label>
          <fieldset class="option-group compact-options">
            <legend>难度</legend>
            <div class="segmented-control difficulty-segments">
              <label v-for="item in difficultyOptions" :key="item.value" :class="{ active: !customDuration && difficulty === item.value }">
                <input name="room-difficulty" type="radio" :checked="!customDuration && difficulty === item.value" @change="difficulty = item.value; customDuration = false" />{{ item.label }}<small>{{ item.seconds }}s</small>
              </label>
              <button class="custom-duration-option" :class="{ active: customDuration }" type="button" :aria-pressed="customDuration" @click="customDuration = true">自定义<small>{{ durationSeconds }}s</small></button>
            </div>
            <div class="custom-time-control" :class="{ 'custom-time-control--disabled': !customDuration }">
              <div class="custom-time-track">
                <label class="custom-time-current" :style="{ '--thumb-position': `${durationFill}%` }"><input v-model.number="durationSeconds" type="number" :min="durationMin" :max="durationMax" step="1" :disabled="!customDuration" aria-label="当前单题秒数" @change="normalizeDuration" /><span>s</span></label>
                <input v-model.number="durationSeconds" class="tech-range" :style="{ '--fill': `${durationFill}%` }" type="range" :min="durationMin" :max="durationMax" step="1" :disabled="!customDuration" aria-label="自定义单题时间" />
                <div class="custom-time-scale"><span>{{ durationMin }}s</span><span>{{ durationMax }}s</span></div>
              </div>
              <div class="custom-time-bounds">
                <span>范围 / 秒</span>
                <label><input v-model="durationMinInput" type="number" min="5" max="599" step="1" :disabled="!customDuration" aria-label="时间下限" @change="setDurationRange('min')" /></label>
                <span>—</span>
                <label><input v-model="durationMaxInput" type="number" min="6" max="600" step="1" :disabled="!customDuration" aria-label="时间上限" @change="setDurationRange('max')" /></label>
              </div>
            </div>
          </fieldset>
          <fieldset class="option-group compact-options">
            <legend>题目数量</legend>
            <div class="segmented-control">
              <label v-for="count in [20, 50, 100]" :key="count" :class="{ active: requestedCount === count }"><input v-model="requestedCount" type="radio" :value="count" />{{ count }}</label>
              <label :class="{ active: requestedCount === 0 }"><input v-model="requestedCount" type="radio" :value="0" />无尽</label>
            </div>
          </fieldset>
          <fieldset class="option-group compact-options game-options">
            <legend>回合提示与揭晓</legend>
            <label>剩余时间 {{ preferences.hintRemainingPercent }}% 时提示
              <input v-model.number="preferences.hintRemainingPercent" class="tech-range" :style="{ '--fill': `${preferences.hintRemainingPercent}%` }" type="range" min="0" max="100" step="5" />
            </label>
            <label class="publish-toggle game-auto-toggle"><input v-model="preferences.autoNext" type="checkbox" /><span class="publish-switch" /><span class="publish-copy"><strong>自动进入下一题</strong><small>{{ preferences.autoNext ? '自动推进' : '手动推进' }}</small></span></label>
            <label class="reveal-duration" :class="{ 'reveal-duration--disabled': !preferences.autoNext }">答案展示 {{ preferences.revealSeconds }} 秒
              <input v-model.number="preferences.revealSeconds" class="tech-range" :style="{ '--fill': `${(preferences.revealSeconds - 1) / 59 * 100}%` }" type="range" min="1" max="60" step="1" :disabled="!preferences.autoNext" />
            </label>
          </fieldset>
          <fieldset class="option-group compact-options">
            <legend>答案来源</legend>
            <div class="source-selector">
              <label :class="{ active: answerSource === 'WEB' }"><input v-model="answerSource" type="radio" value="WEB" /><Users :size="17" /><span>网页抢答<small>WEB CLIENT</small></span></label>
              <label :class="{ active: answerSource === 'EXTERNAL_API' }"><input v-model="answerSource" type="radio" value="EXTERNAL_API" /><Cable :size="17" /><span>外部接口<small>HTTP API</small></span></label>
              <label :class="{ active: answerSource === 'BILIBILI' }"><input v-model="answerSource" type="radio" value="BILIBILI" /><Tv :size="17" /><span>直播弹幕<small>BILIBILI LIVE</small></span></label>
            </div>
          </fieldset>
          <button class="button button--primary" :disabled="busy" @click="enter('create')"><Users :size="19" />创建并等待队员</button>
        </section>
      </div>
    </section>
  </main>
</template>
