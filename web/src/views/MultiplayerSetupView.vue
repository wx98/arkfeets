<script setup lang="ts">
import { ArrowLeft, Cable, LogIn, Radio, Tv, Users } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getClientSessionId, multiplayerSocket } from "../multiplayer/socket";
import type { AnswerSource, Difficulty } from "../types";
import { loadGameSetup, saveGamePreferences, type GamePreferences, type GameTopic } from "../api/gameSetup";

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
const preferences = ref<GamePreferences>({ hintRemainingPercent: 20, revealSeconds: 10, autoNext: false });
const difficultyOptions: Array<{ value: Difficulty; label: string; seconds: number }> = [
  { value: "simple", label: "简单", seconds: 90 },
  { value: "medium", label: "中等", seconds: 60 },
  { value: "hard", label: "困难", seconds: 30 },
  { value: "hell", label: "地狱", seconds: 10 },
];
const selectedDuration = computed(() => customDuration.value ? durationSeconds.value : difficultyOptions.find(item => item.value === difficulty.value)!.seconds);
const busy = ref(false);
const error = ref("");
onMounted(async () => {
  try {
    const setup = await loadGameSetup();
    topics.value = setup.topics;
    topicId.value = setup.topics.find(item => item.isDefault)?.id ?? setup.topics[0]?.id ?? "";
    preferences.value = setup.preferences;
  } catch (caught) { error.value = caught instanceof Error ? caught.message : "设置加载失败"; }
});
watch(difficulty, value => { if (!customDuration.value) durationSeconds.value = difficultyOptions.find(item => item.value === value)!.seconds; });

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
        await saveGamePreferences(preferences.value);
        return multiplayerSocket.create({ ...identity, difficulty: difficulty.value, requestedCount: requestedCount.value, topicId: topicId.value, durationSeconds: selectedDuration.value, preferences: preferences.value, answerSource: answerSource.value });
      })()
      : await multiplayerSocket.join(identity);
    if (room) await router.push(`/multi/${encodeURIComponent(room.roomCode)}`);
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
      <span class="brand-mark">粥批来猜∠ <small>MULTI</small></span>
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
              <label v-for="item in difficultyOptions" :key="item.value" :class="{ active: difficulty === item.value }">
                <input v-model="difficulty" type="radio" :value="item.value" />{{ item.label }}<small>{{ item.seconds }}s</small>
              </label>
            </div>
          </fieldset>
          <label class="setup-check"><input v-model="customDuration" type="checkbox" />自定义单题时间</label>
          <label v-if="customDuration" class="setup-field">单题秒数 <input v-model.number="durationSeconds" type="number" min="5" max="600" step="1" /></label>
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
              <input v-model.number="preferences.hintRemainingPercent" type="range" min="0" max="100" step="5" />
            </label>
            <label class="setup-check"><input v-model="preferences.autoNext" type="checkbox" />自动进入下一题</label>
            <label>答案展示 {{ preferences.revealSeconds }} 秒
              <input v-model.number="preferences.revealSeconds" type="range" min="1" max="60" step="1" />
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
