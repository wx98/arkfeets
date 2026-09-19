<script setup lang="ts">
import { ArrowLeft, ArrowRight, Cable, Crown, LogOut, Medal, Radio, Send, Timer, Trophy, Users } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import GameCanvas from "../components/GameCanvas.vue";
import { getClientSessionId, multiplayerSocket } from "../multiplayer/socket";
import type { MultiplayerRoomView } from "../types";

const route = useRoute();
const router = useRouter();
const room = ref<MultiplayerRoomView>();
const answer = ref("");
const error = ref("");
const now = ref(Date.now());
const roomCode = String(route.params.roomCode);
const sessionId = getClientSessionId();
const nickname = localStorage.getItem("arkfeets:nickname") ?? "博士";
let ticker: number | undefined;
let offUpdate: (() => void) | undefined;
let offClosed: (() => void) | undefined;

const secondsLeft = computed(() => room.value?.state === "ANSWERING" && room.value.question
  ? Math.max(0, Math.ceil((room.value.question.endsAt - now.value) / 1000)) : 0);
const timerProgress = computed(() => room.value?.question
  ? Math.max(0, Math.min(100, secondsLeft.value / room.value.question.durationSeconds * 100)) : 0);
const self = computed(() => room.value?.players.find((player) => player.sessionId === sessionId));
const canAnswer = computed(() => room.value?.answerSource === "WEB" && room.value?.state === "ANSWERING" && (!room.value.question?.overtime || self.value?.isContender));
const winners = computed(() => room.value?.players.filter((player) => room.value?.winnerSessionIds?.includes(player.sessionId)) ?? []);

onMounted(async () => {
  offUpdate = multiplayerSocket.onUpdate((next) => {
    if (next.roomCode === roomCode.toUpperCase()) {
      room.value = next;
      answer.value = "";
      error.value = "";
    }
  });
  offClosed = multiplayerSocket.onClosed(async ({ message }) => {
    await router.replace({ path: "/", query: { notice: message } });
  });
  ticker = window.setInterval(() => now.value = Date.now(), 200);
  try {
    room.value = await multiplayerSocket.join({ roomCode, sessionId, nickname }) ?? undefined;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法加入房间";
  }
});

onBeforeUnmount(() => {
  window.clearInterval(ticker);
  offUpdate?.();
  offClosed?.();
});

async function act(action: () => Promise<MultiplayerRoomView | null>) {
  error.value = "";
  try {
    room.value = await action() ?? room.value;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "操作失败";
  }
}

async function submit() {
  if (!answer.value.trim() || !canAnswer.value) return;
  await act(() => multiplayerSocket.answer(roomCode, answer.value));
  answer.value = "";
}

async function leave() {
  try { await multiplayerSocket.leave(roomCode); } catch { /* room may already be gone */ }
  await router.push("/");
}
</script>

<template>
  <main class="play-page multi-room-page">
    <header class="topbar play-topbar">
      <button class="icon-button" title="退出房间" @click="leave"><ArrowLeft :size="20" /></button>
      <div class="room-code"><small>ROOM CODE</small><strong>{{ roomCode.toUpperCase() }}</strong></div>
      <div v-if="room" class="play-stats">
        <span><Users :size="17" />{{ room.players.length }}/20</span>
        <span><Trophy :size="17" />{{ self?.score ?? 0 }}</span>
        <span v-if="room.state === 'ANSWERING'" :class="{ danger: secondsLeft <= 5 }"><Timer :size="17" />{{ secondsLeft }}s</span>
      </div>
    </header>

    <div v-if="error && !room" class="center-state"><p>{{ error }}</p><button class="button" @click="router.push('/multi')">返回房间终端</button></div>

    <template v-else-if="room?.state === 'LOBBY'">
      <section class="room-lobby">
        <div class="lobby-brief">
          <p class="eyebrow">SQUAD ASSEMBLY / 小队集结</p>
          <h1>{{ room.roomCode }}</h1>
          <p>等待队员加入。游戏开始后房间将锁定，最多 20 人。</p>
          <dl><div><dt>难度</dt><dd>{{ room.difficulty }}</dd></div><div><dt>题目</dt><dd>{{ room.requestedCount }}</dd></div><div><dt>答案来源</dt><dd>{{ room.answerSource === 'EXTERNAL_API' ? 'HTTP API' : 'WEB' }}</dd></div></dl>
          <button v-if="room.isHost" class="button button--primary lobby-start" @click="act(() => multiplayerSocket.start(roomCode))"><Radio :size="19" />开始抢答</button>
          <p v-else class="waiting-copy">等待房主开始...</p>
          <p v-if="error" class="error-text">{{ error }}</p>
        </div>
        <div class="player-roster">
          <div class="roster-title"><span>PLAYERS</span><strong>{{ room.players.length }} / 20</strong></div>
          <ol><li v-for="(player, index) in room.players" :key="player.sessionId" :class="{ offline: !player.connected }"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ player.nickname }}</strong><Crown v-if="player.isHost" :size="15" /><small>{{ player.source === 'EXTERNAL' ? 'API' : (player.connected ? 'READY' : 'OFFLINE') }}</small></li></ol>
        </div>
      </section>
    </template>

    <template v-else-if="room?.state === 'ANSWERING' || room?.state === 'REVEAL'">
      <div class="timer-track"><div :style="{ width: `${timerProgress}%` }" /></div>
      <section class="game-layout multi-play-layout">
        <div class="game-stage">
          <div class="stage-label"><span>{{ room.question?.overtime ? 'OVERTIME FEED' : 'OPTICAL FEED' }}</span><strong>{{ room.question?.overtime ? 'EX' : 'LIVE' }}</strong></div>
          <div class="canvas-wrap" v-if="room.question">
            <GameCanvas :question="room.question" :reveal="room.reveal" :state="room.state" />
          </div>
        </div>
        <aside class="answer-panel multiplayer-panel">
          <div class="mini-scoreboard">
            <div class="roster-title"><span>SCOREBOARD</span><strong>{{ room.question?.index }} / {{ room.question?.total }}</strong></div>
            <ol><li v-for="(player, index) in room.players" :key="player.sessionId" :class="{ muted: room.question?.overtime && !player.isContender }"><span>{{ index + 1 }}</span><strong>{{ player.nickname }}</strong><b>{{ player.score }}</b></li></ol>
          </div>

          <template v-if="room.state === 'ANSWERING'">
            <template v-if="room.answerSource === 'EXTERNAL_API'">
              <div><p class="eyebrow">EXTERNAL LINK / 外部接入</p><h2>接口监听中</h2></div>
              <div class="external-api-console"><Cable :size="22" /><span>POST</span><code>/api/game/submit-answer</code><pre>{ "userName": "玩家名", "answer": "答案" }</pre></div>
              <p class="spectator-copy">收到的昵称会自动加入计分板，无需携带房间号。</p>
            </template>
            <template v-else>
              <div><p class="eyebrow">QUICK RESPONSE / 抢答</p><h2>{{ canAnswer ? '识别目标' : '加时观战' }}</h2></div>
              <form v-if="canAnswer" class="answer-form" @submit.prevent="submit"><input v-model="answer" autofocus maxlength="100" placeholder="输入答案" autocomplete="off" /><button class="button button--primary" type="submit"><Send :size="18" />提交抢答</button></form>
              <p v-else class="spectator-copy">本轮仅最高分并列玩家可以作答。</p>
            </template>
          </template>

          <template v-else>
            <div><p class="eyebrow">IDENTIFIED / 抢答成功</p><h2>{{ room.reveal?.answers[0] }}</h2><p class="answer-aliases">{{ room.reveal?.winnerNickname }} 首先回答正确</p></div>
            <button v-if="room.isHost" class="button button--primary" @click="act(() => multiplayerSocket.next(roomCode))"><ArrowRight :size="19" />继续下一题</button>
            <p v-else class="waiting-copy">等待房主进入下一题...</p>
          </template>
          <p v-if="error" class="error-text">{{ error }}</p>
        </aside>
      </section>
    </template>

    <template v-else-if="room?.state === 'RANKING'">
      <section class="ranking-page">
        <div class="ranking-heading"><Medal :size="38" /><p class="eyebrow">MISSION COMPLETE / 最终排名</p><h1>{{ winners.length > 1 ? '并列完成' : '胜者确认' }}</h1><p>{{ winners.map(player => player.nickname).join(' / ') }}</p></div>
        <ol class="ranking-list"><li v-for="(player, index) in room.players" :key="player.sessionId" :class="{ winner: room.winnerSessionIds?.includes(player.sessionId) }"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ player.nickname }}</strong><b>{{ player.score }} PTS</b></li></ol>
        <div class="ranking-actions"><p>30 秒后返回等待室</p><button v-if="room.isHost" class="button button--primary" @click="act(() => multiplayerSocket.skipRanking(roomCode))"><LogOut :size="18" />跳过排名展示</button></div>
      </section>
    </template>
  </main>
</template>
