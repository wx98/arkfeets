<script setup lang="ts">
import { ArrowLeft, Cable, LogIn, Radio, Users } from "lucide-vue-next";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { getClientSessionId, multiplayerSocket } from "../multiplayer/socket";
import type { AnswerSource, Difficulty } from "../types";

const router = useRouter();
const nickname = ref(localStorage.getItem("arkfeets:nickname") ?? "博士");
const roomCode = ref("");
const difficulty = ref<Difficulty>("medium");
const requestedCount = ref(20);
const answerSource = ref<AnswerSource>("WEB");
const busy = ref(false);
const error = ref("");

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
      ? await multiplayerSocket.create({ ...identity, difficulty: difficulty.value, requestedCount: requestedCount.value, answerSource: answerSource.value })
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
          <fieldset class="option-group compact-options">
            <legend>难度</legend>
            <div class="segmented-control difficulty-segments">
              <label v-for="item in ([['simple','简单'],['medium','中等'],['hard','困难'],['hell','地狱']] as const)" :key="item[0]" :class="{ active: difficulty === item[0] }">
                <input v-model="difficulty" type="radio" :value="item[0]" />{{ item[1] }}
              </label>
            </div>
          </fieldset>
          <fieldset class="option-group compact-options">
            <legend>题目数量</legend>
            <div class="segmented-control">
              <label v-for="count in [20, 50, 100]" :key="count" :class="{ active: requestedCount === count }"><input v-model="requestedCount" type="radio" :value="count" />{{ count }}</label>
            </div>
          </fieldset>
          <fieldset class="option-group compact-options">
            <legend>答案来源</legend>
            <div class="source-selector">
              <label :class="{ active: answerSource === 'WEB' }"><input v-model="answerSource" type="radio" value="WEB" /><Users :size="17" /><span>网页抢答<small>WEB CLIENT</small></span></label>
              <label :class="{ active: answerSource === 'EXTERNAL_API' }"><input v-model="answerSource" type="radio" value="EXTERNAL_API" /><Cable :size="17" /><span>外部接口<small>HTTP API</small></span></label>
            </div>
          </fieldset>
          <button class="button button--primary" :disabled="busy" @click="enter('create')"><Users :size="19" />创建并等待队员</button>
        </section>
      </div>
    </section>
  </main>
</template>
