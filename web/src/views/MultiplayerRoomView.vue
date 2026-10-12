<script setup lang="ts">
import { ArrowLeft, ArrowRight, Cable, Crown, LogOut, Medal, MessageSquareText, Radio, Send, Timer, Trophy, Users, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import GameCanvas from "../components/GameCanvas.vue";
import { getClientSessionId, multiplayerSocket, type ConnectionState } from "../multiplayer/socket";
import type { LiveDanmakuEvent, MultiplayerRoomView } from "../types";

const route = useRoute();
const router = useRouter();
const room = ref<MultiplayerRoomView>();
const answer = ref("");
const error = ref("");
const loading = ref(true);
const starting = ref(false);
const connectionState = ref<ConnectionState>("CONNECTING");
const now = ref(Date.now());
const roomCode = String(route.params.roomCode);
const sessionId = getClientSessionId();
const nickname = localStorage.getItem("arkfeets:nickname") ?? "博士";
const danmakuSettingsKey = "arkfeets:live-danmaku";
function loadDanmakuSettings(): { enabled: boolean; density: number; transparency: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(danmakuSettingsKey) ?? "{}");
    return {
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : true,
      density: Number.isFinite(saved.density) ? Math.max(1, Math.min(5, saved.density)) : 3,
      transparency: Number.isFinite(saved.transparency) ? Math.max(0, Math.min(80, Math.round(saved.transparency / 10) * 10)) : 20,
    };
  } catch { return { enabled: true, density: 3, transparency: 20 }; }
}
const savedDanmaku = loadDanmakuSettings();
const danmakuEnabled = ref(savedDanmaku.enabled);
const danmakuDensity = ref(savedDanmaku.density);
const danmakuTransparency = ref(savedDanmaku.transparency);
const danmakuSettingsOpen = ref(false);
interface FlyingDanmaku extends LiveDanmakuEvent { lane: number; key: string }
const flyingDanmaku = ref<FlyingDanmaku[]>([]);
const laneReadyAt = Array<number>(8).fill(0);
const cleanupTimers = new Set<number>();
let danmakuSequence = 0;
let ticker: number | undefined;
let offUpdate: (() => void) | undefined;
let offClosed: (() => void) | undefined;
let offConnection: (() => void) | undefined;
let offDanmaku: (() => void) | undefined;
let connectionWasLost = false;
let reconnecting = false;

const secondsLeft = computed(() => room.value?.state === "ANSWERING" && room.value.question
  ? Math.max(0, Math.ceil((room.value.question.endsAt - now.value) / 1000)) : 0);
const timerProgress = computed(() => room.value?.question
  ? Math.max(0, Math.min(100, secondsLeft.value / room.value.question.durationSeconds * 100)) : 0);
const showHint = computed(() => room.value?.state === "ANSWERING" && !!room.value.question
  && timerProgress.value <= room.value.question.hintRemainingPercent);
const revealSecondsLeft = computed(() => room.value?.revealEndsAt
  ? Math.max(0, Math.ceil((room.value.revealEndsAt - now.value) / 1000)) : 0);
const self = computed(() => room.value?.players.find((player) => player.sessionId === sessionId));
const canAnswer = computed(() => room.value?.answerSource === "WEB" && room.value?.state === "ANSWERING" && (!room.value.question?.overtime || self.value?.isContender));
const winners = computed(() => room.value?.players.filter((player) => room.value?.winnerSessionIds?.includes(player.sessionId)) ?? []);
watch([danmakuEnabled, danmakuDensity, danmakuTransparency], () => {
  localStorage.setItem(danmakuSettingsKey, JSON.stringify({
    enabled: danmakuEnabled.value, density: danmakuDensity.value, transparency: danmakuTransparency.value,
  }));
  if (!danmakuEnabled.value) clearDanmaku();
});
watch(() => room.value?.question?.id, (next, previous) => {
  if (next !== previous) clearDanmaku();
});

function clearDanmaku() {
  for (const timer of cleanupTimers) window.clearTimeout(timer);
  cleanupTimers.clear();
  laneReadyAt.fill(0);
  flyingDanmaku.value = [];
}

function receiveDanmaku(event: LiveDanmakuEvent) {
  if (!danmakuEnabled.value || event.roomCode !== roomCode.toUpperCase()
    || event.questionId !== room.value?.question?.id
    || (room.value.state !== "ANSWERING" && room.value.state !== "REVEAL")) return;
  const density = danmakuDensity.value;
  if (flyingDanmaku.value.length >= density * 3) return;
  const now = Date.now();
  const laneCount = Math.min(8, 3 + density);
  const lane = laneReadyAt.slice(0, laneCount).findIndex(ready => ready <= now);
  if (lane < 0) return;
  laneReadyAt[lane] = now + 1800 - density * 260;
  const key = `${event.messageId}-${++danmakuSequence}`;
  flyingDanmaku.value.push({ ...event, lane, key });
  const timer = window.setTimeout(() => {
    cleanupTimers.delete(timer);
    flyingDanmaku.value = flyingDanmaku.value.filter(item => item.key !== key);
  }, 11_000);
  cleanupTimers.add(timer);
}

onMounted(async () => {
  offUpdate = multiplayerSocket.onUpdate((next) => {
    if (next.roomCode === roomCode.toUpperCase()) {
      room.value = next;
      answer.value = "";
      error.value = "";
    }
  });
  offDanmaku = multiplayerSocket.onDanmaku(receiveDanmaku);
  offClosed = multiplayerSocket.onClosed(async ({ message }) => {
    await router.replace({ path: "/", query: { notice: message } });
  });
  offConnection = multiplayerSocket.onConnectionChange(async (state) => {
    connectionState.value = state;
    if (state === "DISCONNECTED") connectionWasLost = true;
    if (state !== "CONNECTED" || !connectionWasLost || reconnecting) return;
    reconnecting = true;
    connectionState.value = "CONNECTING";
    try {
      room.value = await multiplayerSocket.join({ roomCode, sessionId, nickname }) ?? undefined;
      connectionWasLost = false;
      connectionState.value = "CONNECTED";
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "房间无法恢复";
      await router.replace({ path: "/", query: { notice: message } });
    } finally {
      reconnecting = false;
    }
  });
  ticker = window.setInterval(() => now.value = Date.now(), 200);
  try {
    room.value = await multiplayerSocket.join({ roomCode, sessionId, nickname }) ?? undefined;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法加入房间";
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.clearInterval(ticker);
  offUpdate?.();
  offClosed?.();
  offConnection?.();
  offDanmaku?.();
  clearDanmaku();
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

async function startGame() {
  if (starting.value) return;
  starting.value = true;
  try {
    await act(() => multiplayerSocket.start(roomCode));
  } finally {
    starting.value = false;
  }
}

async function leave() {
  try { await multiplayerSocket.leave(roomCode); } catch { /* room may already be gone */ }
  await router.push("/");
}
</script>

<template>
  <main class="play-page multi-room-page">
    <header class="topbar play-topbar">
      <div class="room-topbar-left">
        <button class="icon-button" title="退出房间" @click="leave"><ArrowLeft :size="20" /></button>
        <span v-if="room" class="room-mode-label">{{ room.answerSource === 'BILIBILI' ? '直播弹幕' : room.answerSource === 'EXTERNAL_API' ? '接口抢答' : '网页抢答' }} · {{ room.topicName }} · {{ room.requestedCount === 0 ? '无尽' : `${room.requestedCount} 题` }}</span>
      </div>
      <div class="room-code"><small>ROOM CODE</small><strong>{{ roomCode.toUpperCase() }}</strong></div>
      <div v-if="room" class="play-stats">
        <span><Users :size="17" />{{ room.players.length }}{{ room.answerSource === 'BILIBILI' ? '' : '/20' }}</span>
        <span><Trophy :size="17" />{{ self?.score ?? 0 }}</span>
        <span v-if="room.state === 'ANSWERING'" :class="{ danger: secondsLeft <= 5 }"><Timer :size="17" />{{ secondsLeft }}s</span>
      </div>
    </header>

    <div v-if="connectionState !== 'CONNECTED'" class="connection-banner" role="status">
      {{ connectionState === 'CONNECTING' ? '正在连接作战服务器...' : '连接已中断，正在等待自动重连' }}
    </div>

    <div v-if="loading" class="center-state">正在接入房间...</div>
    <div v-else-if="error && !room" class="center-state"><p>{{ error }}</p><button class="button" @click="router.push('/multi')">返回房间终端</button></div>

    <template v-else-if="room?.state === 'LOBBY'">
      <section class="room-lobby">
        <div class="lobby-brief">
          <p class="eyebrow">SQUAD ASSEMBLY / 小队集结</p>
          <h1>{{ room.roomCode }}</h1>
          <p v-if="room.answerSource === 'BILIBILI'">等待主播开始。直播观众发送文字弹幕后会自动加入计分板。</p>
          <p v-else>等待队员加入。游戏开始后房间将锁定，最多 20 人。</p>
          <dl><div><dt>主题</dt><dd>{{ room.topicName }}</dd></div><div><dt>难度 / 时限</dt><dd>{{ room.difficulty }} / {{ room.durationSeconds }}s</dd></div><div><dt>题目</dt><dd>{{ room.requestedCount === 0 ? '无尽' : room.requestedCount }}</dd></div><div><dt>答案来源</dt><dd>{{ room.answerSource === 'BILIBILI' ? 'BILIBILI LIVE' : room.answerSource === 'EXTERNAL_API' ? 'HTTP API' : 'WEB' }}</dd></div></dl>
          <button v-if="room.isHost" class="button button--primary lobby-start" :disabled="starting" @click="startGame"><Radio :size="19" />{{ starting && room.answerSource === 'BILIBILI' ? '正在连接直播间...' : '开始抢答' }}</button>
          <p v-else class="waiting-copy">等待房主开始...</p>
          <p v-if="room.answerSource === 'BILIBILI'" class="waiting-copy">直播间来源由服务端配置，开始后接收文字弹幕。</p>
          <p v-if="error" class="error-text">{{ error }}</p>
        </div>
        <div class="player-roster">
          <div class="roster-title"><span>PLAYERS</span><strong>{{ room.players.length }}{{ room.answerSource === 'BILIBILI' ? '' : ' / 20' }}</strong></div>
          <ol><li v-for="(player, index) in room.players" :key="player.sessionId" :class="{ offline: !player.connected }"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ player.nickname }}</strong><Crown v-if="player.isHost" :size="15" /><small>{{ player.source === 'EXTERNAL' ? 'API' : player.source === 'BILIBILI' ? 'LIVE' : (player.connected ? 'READY' : 'OFFLINE') }}</small></li></ol>
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
            <div v-if="room.answerSource === 'BILIBILI' && danmakuEnabled" class="live-danmaku-layer" aria-live="off">
              <span v-for="item in flyingDanmaku" :key="item.key" class="live-danmaku-item"
                :style="{ top: `${9 + item.lane * 10}%`, opacity: 1 - danmakuTransparency / 100 }">
                <strong>{{ item.nickname }}</strong><span>{{ item.content }}</span>
              </span>
            </div>
          </div>
          <div v-if="room.answerSource === 'BILIBILI'" class="live-danmaku-controls">
            <div v-if="danmakuSettingsOpen" class="live-danmaku-settings">
              <div class="live-danmaku-settings__heading"><strong>弹幕设置</strong><button title="关闭设置" aria-label="关闭设置" @click="danmakuSettingsOpen = false"><X :size="16" /></button></div>
              <label class="live-danmaku-switch"><input v-model="danmakuEnabled" type="checkbox" />显示弹幕</label>
              <label>密度 <span>{{ danmakuDensity }}</span><input v-model.number="danmakuDensity" type="range" min="1" max="5" step="1" /></label>
              <label>透明度 <span>{{ danmakuTransparency }}%</span><input v-model.number="danmakuTransparency" type="range" min="0" max="80" step="10" /></label>
            </div>
            <button class="live-danmaku-settings-button" title="弹幕设置" aria-label="弹幕设置" :aria-expanded="danmakuSettingsOpen" @click="danmakuSettingsOpen = !danmakuSettingsOpen"><MessageSquareText :size="19" /></button>
          </div>
        </div>
        <aside class="answer-panel multiplayer-panel">
          <div class="mini-scoreboard">
            <div class="roster-title"><span>SCOREBOARD</span><strong>{{ room.question?.index }}{{ room.requestedCount === 0 ? ' / ∞' : ` / ${room.question?.total}` }}</strong></div>
            <ol><li v-for="(player, index) in room.players" :key="player.sessionId" :class="{ muted: room.question?.overtime && !player.isContender }"><span>{{ index + 1 }}</span><strong>{{ player.nickname }}</strong><b>{{ player.score }}</b></li></ol>
          </div>

          <template v-if="room.state === 'ANSWERING'">
            <div v-if="showHint" class="hint-line"><span>{{ room.question?.hint || '本题暂无提示' }}</span></div>
            <template v-if="room.answerSource === 'BILIBILI'">
              <div><p class="eyebrow">BILIBILI LIVE / 直播弹幕</p><h2>{{ room.bilibiliConnected ? '弹幕抢答中' : '弹幕连接中断' }}</h2></div>
              <div class="external-api-console"><Radio :size="22" /><span>{{ room.bilibiliConnected ? 'LIVE' : 'RECONNECTING' }}</span><strong>文字弹幕作为答案</strong></div>
              <p class="spectator-copy">按 UID 计分，昵称显示在计分板；连接恢复后继续接收。</p>
            </template>
            <template v-else-if="room.answerSource === 'EXTERNAL_API'">
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
            <div><p class="eyebrow">{{ room.reveal?.timedOut ? 'TIME OUT / 时间到' : 'IDENTIFIED / 抢答成功' }}</p><h2>{{ room.reveal?.answers[0] }}</h2><p v-if="!room.reveal?.timedOut" class="answer-aliases">{{ room.reveal?.winnerNickname }} 首先回答正确</p></div>
            <p v-if="room.revealEndsAt" class="reveal-countdown">{{ revealSecondsLeft }} 秒后自动继续</p>
            <button v-if="room.isHost" class="button button--primary" @click="act(() => multiplayerSocket.next(roomCode))"><ArrowRight :size="19" />继续下一题</button>
            <p v-else-if="!room.revealEndsAt" class="waiting-copy">等待房主进入下一题...</p>
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

<style scoped>
.live-danmaku-layer { position: absolute; z-index: 3; inset: 0; overflow: hidden; pointer-events: none; }
.live-danmaku-item { position: absolute; left: 100%; display: inline-flex; align-items: center; gap: 6px; max-width: 80%; width: max-content; white-space: nowrap; padding: 6px 10px; border: 1px solid rgba(217,239,114,.75); background: rgba(13,18,18,.86); color: #fff; font-size: 13px; font-weight: 700; text-shadow: 0 1px 2px #000; animation: live-danmaku-cross 10s linear forwards; }
.live-danmaku-item strong { color: #d9ef72; }
.live-danmaku-item span { overflow: hidden; text-overflow: ellipsis; }
@keyframes live-danmaku-cross { to { transform: translateX(calc(-100vw - 100%)); } }
.live-danmaku-controls { position: absolute; z-index: 4; left: 18px; bottom: 18px; }
.live-danmaku-settings-button { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid #9ca5a1; background: #25292b; color: #d9ef72; cursor: pointer; }
.live-danmaku-settings-button:hover { border-color: #d9ef72; }
.live-danmaku-settings { position: absolute; bottom: 46px; left: 0; display: grid; gap: 12px; width: 225px; padding: 13px; border: 1px solid #69716e; background: #25292b; box-shadow: 5px 5px 0 #111; color: #fff; font-size: 12px; }
.live-danmaku-settings__heading { display: flex; align-items: center; justify-content: space-between; }
.live-danmaku-settings__heading button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #fff; cursor: pointer; }
.live-danmaku-settings label { display: grid; grid-template-columns: 1fr auto; gap: 4px; align-items: center; }
.live-danmaku-settings label input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #d9ef72; }
.live-danmaku-settings .live-danmaku-switch { display: flex; gap: 7px; }
.live-danmaku-settings input[type=checkbox] { accent-color: #d9ef72; }
@media (max-width: 760px) { .live-danmaku-controls { left: 10px; bottom: 10px; } .live-danmaku-item { font-size: 11px; padding: 4px 7px; } }
@media (prefers-reduced-motion: reduce) { .live-danmaku-item { left: 10px; animation: live-danmaku-fade 4s linear forwards; } @keyframes live-danmaku-fade { to { opacity: 0; } } }
</style>
