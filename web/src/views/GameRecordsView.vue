<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, History, Radio, RefreshCw, Search } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

interface Summary {
  id: string; roomCode: string; startedAt: string; endedAt: string | null; answerSource: string;
  difficulty: string; requestedCount: number; questionCount: number; answerCount: number;
  correctCount: number; playerCount: number; status: string; invalidLines: number;
}
interface AnswerRecord {
  type: "answer"; timestamp: string; roomCode: string; answerSource: string; questionId: string;
  questionIndex: number; overtime: boolean; standardAnswers: string[]; userId: string;
  nickname: string; answer: string; correct: boolean; score: number; rank: number;
}
interface Detail {
  summary: Summary;
  start: { timestamp: string; difficulty: string; requestedCount: number; questionCount: number } | null;
  end: { timestamp: string; reason: string; players: Array<{ userId: string; nickname: string; score: number; rank: number }> } | null;
  answers: AnswerRecord[]; matchedCount: number; page: number; pageSize: number;
}

const games = ref<Summary[]>([]);
const total = ref(0);
const listPage = ref(0);
const selectedId = ref("");
const detail = ref<Detail | null>(null);
const answerPage = ref(0);
const search = ref("");
const verdict = ref("all");
const loadingList = ref(false);
const loadingDetail = ref(false);
const loginRequired = ref(false);
const password = ref("");
const error = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let detailRequest = 0;
const listSize = 20;
const answerSize = 50;

async function request(path: string, method = "GET", body?: object) {
  const response = await fetch(`/api/admin/${path}`, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) loginRequired.value = true;
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "请求失败");
  return response.json();
}

async function loadGames() {
  loadingList.value = true;
  error.value = "";
  try {
    const result = await request(`games?page=${listPage.value}&pageSize=${listSize}`) as { items: Summary[]; total: number };
    games.value = result.items;
    total.value = result.total;
    loginRequired.value = false;
    if (!games.value.some(item => item.id === selectedId.value)) {
      selectedId.value = games.value[0]?.id ?? "";
      answerPage.value = 0;
    }
    if (selectedId.value) await loadDetail();
    else detail.value = null;
  } catch (cause) {
    if (!loginRequired.value) error.value = cause instanceof Error ? cause.message : "读取对局失败";
  } finally { loadingList.value = false; }
}

async function loadDetail() {
  if (!selectedId.value) return;
  const sequence = ++detailRequest;
  loadingDetail.value = true;
  const query = new URLSearchParams({ page: String(answerPage.value), pageSize: String(answerSize) });
  if (search.value.trim()) query.set("search", search.value.trim());
  if (verdict.value !== "all") query.set("correct", verdict.value);
  try {
    const result = await request(`games/${encodeURIComponent(selectedId.value)}?${query}`) as Detail;
    if (sequence === detailRequest) { detail.value = result; error.value = ""; }
  } catch (cause) {
    if (sequence === detailRequest && !loginRequired.value) error.value = cause instanceof Error ? cause.message : "读取日志失败";
  } finally {
    if (sequence === detailRequest) loadingDetail.value = false;
  }
}

function selectGame(id: string) {
  if (selectedId.value === id) return;
  selectedId.value = id;
  answerPage.value = 0;
  detail.value = null;
  void loadDetail();
}

async function login() {
  try {
    await request("login", "POST", { password: password.value });
    password.value = "";
    loginRequired.value = false;
    await loadGames();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "登录失败"; }
}

function changeListPage(delta: number) {
  listPage.value += delta;
  void loadGames();
}
function changeAnswerPage(delta: number) {
  answerPage.value += delta;
  void loadDetail();
}
function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function sourceName(value: string) { return ({ WEB: "网页抢答", EXTERNAL_API: "外部接口", BILIBILI: "直播弹幕" } as Record<string, string>)[value] ?? value; }
function statusName(value: string) { return ({ completed: "已结算", room_closed: "房间解散", server_stopped: "服务停止", in_progress: "进行中 / 未结算" } as Record<string, string>)[value] ?? value; }
function difficultyName(value: string) { return ({ simple: "简单", medium: "中等", hard: "困难", hell: "地狱" } as Record<string, string>)[value] ?? value; }

watch([search, verdict], () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { answerPage.value = 0; void loadDetail(); }, 250);
});
onMounted(() => { void loadGames(); });
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer); detailRequest++; });
</script>

<template>
  <main class="records-page">
    <header class="records-header">
      <a href="/multi" class="records-back" title="返回多人房间" aria-label="返回多人房间"><ArrowLeft :size="20" /></a>
      <div><small>MISSION ARCHIVE / 对局档案</small><h1>对局记录</h1></div>
      <a href="/multi/live-monitor" class="records-monitor"><Radio :size="16" />弹幕监控</a>
      <button class="records-refresh" title="刷新记录" aria-label="刷新记录" :disabled="loadingList" @click="loadGames"><RefreshCw :size="18" /></button>
    </header>
    <p v-if="error" class="records-error" role="alert">{{ error }}</p>
    <section v-if="loginRequired" class="records-login">
      <h2>管理员验证</h2>
      <form @submit.prevent="login"><input v-model="password" type="password" autocomplete="current-password" placeholder="后台密码" aria-label="后台密码" /><button type="submit">进入档案</button></form>
    </section>
    <div v-else class="records-layout">
      <aside class="records-list">
        <div class="records-panel-heading"><h2>历史对局</h2><span>{{ total }} 局</span></div>
        <p v-if="loadingList && !games.length" class="records-empty">正在读取记录...</p>
        <p v-else-if="!games.length" class="records-empty">暂无对局记录</p>
        <ol v-else>
          <li v-for="game in games" :key="game.id">
            <button :class="['records-game', { selected: selectedId === game.id }]" @click="selectGame(game.id)">
              <span class="records-game__top"><strong>{{ game.roomCode }}</strong><small>{{ statusName(game.status) }}</small></span>
              <time>{{ formatTime(game.startedAt) }}</time>
              <span class="records-game__meta">{{ sourceName(game.answerSource) }} · {{ game.playerCount }} 人 · {{ game.correctCount }}/{{ game.answerCount }} 次答对</span>
            </button>
          </li>
        </ol>
        <div v-if="total > listSize" class="records-pager">
          <button :disabled="listPage === 0 || loadingList" aria-label="上一页对局" @click="changeListPage(-1)"><ChevronLeft :size="17" /></button>
          <span>{{ listPage + 1 }} / {{ Math.ceil(total / listSize) }}</span>
          <button :disabled="(listPage + 1) * listSize >= total || loadingList" aria-label="下一页对局" @click="changeListPage(1)"><ChevronRight :size="17" /></button>
        </div>
      </aside>
      <section class="records-detail">
        <p v-if="loadingDetail && !detail" class="records-empty">正在读取对局...</p>
        <div v-else-if="detail" class="records-detail__inner">
          <header class="records-summary">
            <div class="records-summary__title"><div><small>ROOM / {{ detail.summary.roomCode }}</small><h2>{{ sourceName(detail.summary.answerSource) }}对局</h2></div><span :class="['records-status', { complete: detail.end }]">{{ statusName(detail.summary.status) }}</span></div>
            <dl>
              <div><dt>开始时间</dt><dd>{{ formatTime(detail.summary.startedAt) }}</dd></div>
              <div><dt>结束时间</dt><dd>{{ formatTime(detail.summary.endedAt) }}</dd></div>
              <div><dt>难度</dt><dd>{{ difficultyName(detail.summary.difficulty) }}</dd></div>
              <div><dt>题目</dt><dd>{{ detail.summary.questionCount }} / {{ detail.summary.requestedCount }}</dd></div>
              <div><dt>玩家</dt><dd>{{ detail.summary.playerCount }}</dd></div>
              <div><dt>提交 / 答对</dt><dd>{{ detail.summary.answerCount }} / {{ detail.summary.correctCount }}</dd></div>
            </dl>
            <p v-if="detail.summary.invalidLines" class="records-warning">{{ detail.summary.invalidLines }} 条日志无法解析，已跳过。</p>
          </header>
          <section class="records-events">
            <div class="records-section-title"><h3>答案记录</h3><span>{{ detail.matchedCount }} 条</span></div>
            <div class="records-filters">
              <label><Search :size="16" /><input v-model="search" placeholder="搜索用户、题目或答案" aria-label="搜索答案记录" /></label>
              <select v-model="verdict" aria-label="筛选判题结果"><option value="all">全部结果</option><option value="true">回答正确</option><option value="false">回答错误</option></select>
            </div>
            <p v-if="loadingDetail" class="records-loading">正在更新记录...</p>
            <p v-if="!detail.answers.length && !loadingDetail" class="records-empty">没有匹配的答案记录</p>
            <ol class="records-answers">
              <li v-for="(item, index) in detail.answers" :key="`${item.timestamp}-${item.userId}-${index}`" :class="{ correct: item.correct }">
                <div class="records-answer__head"><time>{{ formatTime(item.timestamp) }}</time><span>第 {{ item.questionIndex + 1 }} 题 · {{ item.questionId }}<template v-if="item.overtime"> · 加时赛</template></span><strong :class="item.correct ? 'is-correct' : 'is-wrong'">{{ item.correct ? '正确' : '错误' }}</strong></div>
                <div class="records-answer__body"><div class="records-answer__user"><strong>{{ item.nickname }}</strong><small>ID {{ item.userId }}</small></div><div class="records-answer__values"><div><small>提交答案</small><p>{{ item.answer || '（空）' }}</p></div><div><small>标准答案</small><p>{{ item.standardAnswers.join(' / ') }}</p></div></div><div class="records-answer__result"><span>当时排名 <strong>#{{ item.rank }}</strong></span><span>当前得分 <strong>{{ item.score }}</strong></span></div></div>
              </li>
            </ol>
            <div v-if="detail.matchedCount > answerSize" class="records-pager records-pager--answers">
              <button :disabled="answerPage === 0 || loadingDetail" aria-label="上一页答案" @click="changeAnswerPage(-1)"><ChevronLeft :size="17" /></button>
              <span>{{ answerPage + 1 }} / {{ Math.ceil(detail.matchedCount / answerSize) }}</span>
              <button :disabled="(answerPage + 1) * answerSize >= detail.matchedCount || loadingDetail" aria-label="下一页答案" @click="changeAnswerPage(1)"><ChevronRight :size="17" /></button>
            </div>
          </section>
          <section class="records-final">
            <div class="records-section-title"><h3>最终排名</h3><span>{{ detail.end ? formatTime(detail.end.timestamp) : '尚未结算' }}</span></div>
            <p v-if="!detail.end" class="records-empty">这局对局尚无结束记录</p>
            <ol v-else><li v-for="player in detail.end.players" :key="player.userId"><span class="records-final__rank">#{{ player.rank }}</span><strong>{{ player.nickname }}</strong><small>ID {{ player.userId }}</small><b>{{ player.score }} 分</b></li></ol>
          </section>
        </div>
        <div v-else class="records-placeholder"><History :size="42" /><p>选择一局查看完整记录</p></div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.records-page { min-height: 100dvh; background: #f2f3ef; color: #25292b; }
.records-header { height: 80px; display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: #25292b; color: #fff; }
.records-header small { color: #aebbb4; font-size: 10px; }
.records-header h1 { margin: 2px 0 0; font-size: 22px; }
.records-back, .records-refresh { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #68706e; background: transparent; color: inherit; cursor: pointer; }
.records-monitor { margin-left: auto; display: flex; align-items: center; gap: 7px; color: #d9ef72; text-decoration: none; white-space: nowrap; }
.records-refresh:disabled { opacity: .5; cursor: wait; }
.records-error { margin: 0; padding: 10px 24px; background: #ffebdb; color: #8c4026; }
.records-layout { display: grid; grid-template-columns: minmax(270px, 310px) minmax(0, 1fr); height: calc(100dvh - 80px); }
.records-list, .records-detail { min-width: 0; overflow-y: auto; }
.records-list { display: flex; flex-direction: column; background: #fff; border-right: 1px solid #d0d5d1; }
.records-panel-heading { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: baseline; padding: 18px 20px 14px; background: #fff; border-bottom: 1px solid #d0d5d1; }
.records-panel-heading h2, .records-section-title h3 { margin: 0; font-size: 17px; }
.records-panel-heading span, .records-section-title span { color: #6f7874; font-size: 12px; }
.records-list ol, .records-answers, .records-final ol { margin: 0; padding: 0; list-style: none; }
.records-game { width: 100%; display: grid; gap: 6px; padding: 14px 20px; border: 0; border-bottom: 1px solid #e0e3df; background: #fff; color: inherit; text-align: left; cursor: pointer; }
.records-game:hover, .records-game.selected { background: #eef4d8; }
.records-game.selected { box-shadow: inset 3px 0 #97b84d; }
.records-game__top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.records-game__top strong { font-size: 15px; }
.records-game__top small { font-size: 11px; color: #506740; }
.records-game time, .records-game__meta { font-size: 11px; color: #68736e; }
.records-pager { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 12px; margin-top: auto; border-top: 1px solid #dce0dc; font-size: 12px; }
.records-pager button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid #cbd2cb; background: #fff; cursor: pointer; }
.records-pager button:disabled { opacity: .4; cursor: default; }
.records-detail__inner { max-width: 1100px; margin: 0 auto; }
.records-summary { padding: 24px 30px; background: #fff; border-bottom: 1px solid #d0d5d1; }
.records-summary__title { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.records-summary__title small { color: #68736e; font-size: 10px; }
.records-summary h2 { margin: 4px 0 0; font-size: 22px; }
.records-status { color: #94612b; font-size: 12px; white-space: nowrap; }
.records-status.complete { color: #537238; }
.records-summary dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; margin: 24px 0 0; }
.records-summary dt, .records-answer__values small { color: #777f7b; font-size: 11px; }
.records-summary dd { margin: 5px 0 0; font-size: 14px; overflow-wrap: anywhere; }
.records-warning { color: #9a4d32; font-size: 12px; }
.records-events, .records-final { padding: 22px 30px; }
.records-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.records-filters { display: flex; gap: 10px; margin-bottom: 14px; }
.records-filters label { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid #cbd2cb; background: #fff; }
.records-filters input { min-width: 0; width: 100%; border: 0; outline: 0; font: inherit; }
.records-filters select { border: 1px solid #cbd2cb; background: #fff; padding: 7px 9px; font: inherit; }
.records-answers li { margin-bottom: 8px; border: 1px solid #d9ded8; border-left: 3px solid #b7beb7; background: #fff; }
.records-answers li.correct { border-left-color: #90b24a; }
.records-answer__head { display: flex; align-items: center; gap: 14px; padding: 10px 15px; border-bottom: 1px solid #e6e9e5; font-size: 11px; color: #727b75; }
.records-answer__head strong { margin-left: auto; font-size: 12px; }
.is-correct { color: #4f7138; }.is-wrong { color: #a65a3d; }
.records-answer__body { display: grid; grid-template-columns: minmax(100px, 150px) minmax(0, 1fr) minmax(115px, auto); align-items: center; gap: 15px; padding: 14px 15px; }
.records-answer__user { display: grid; gap: 3px; min-width: 0; }.records-answer__user strong { overflow-wrap: anywhere; }.records-answer__user small { color: #858d88; overflow-wrap: anywhere; }
.records-answer__values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; min-width: 0; }
.records-answer__values p { margin: 3px 0 0; overflow-wrap: anywhere; }
.records-answer__result { display: grid; gap: 6px; text-align: right; font-size: 11px; color: #68736e; }.records-answer__result strong { color: #25292b; font-size: 15px; }
.records-pager--answers { margin: 12px 0 0; border-top: 0; }
.records-final { border-top: 1px solid #d0d5d1; }
.records-final li { display: flex; align-items: center; gap: 10px; padding: 10px 13px; border-bottom: 1px solid #dce1da; background: #fff; }.records-final li small { color: #818a84; overflow-wrap: anywhere; }.records-final li b { margin-left: auto; white-space: nowrap; }.records-final__rank { min-width: 35px; color: #678b3e; font-weight: 700; }
.records-empty, .records-placeholder, .records-loading { padding: 24px; color: #78817b; }.records-placeholder { min-height: 50vh; display: grid; place-content: center; justify-items: center; gap: 10px; }
.records-login { max-width: 400px; margin: 80px auto; padding: 24px; background: #fff; }.records-login h2 { margin-top: 0; font-size: 19px; }.records-login form { display: flex; gap: 8px; }.records-login input { min-width: 0; flex: 1; padding: 10px; border: 1px solid #bac3bd; }.records-login button { border: 0; background: #d9ef72; padding: 0 14px; cursor: pointer; }
@media (max-width: 760px) { .records-header { padding-inline: 12px; }.records-monitor { font-size: 0; gap: 0; }.records-monitor :deep(svg) { width: 19px; height: 19px; }.records-layout { display: block; height: auto; }.records-list { max-height: 260px; overflow-y: auto; border-right: 0; border-bottom: 1px solid #d0d5d1; }.records-detail { overflow: visible; }.records-summary, .records-events, .records-final { padding: 18px 15px; }.records-summary dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }.records-answer__body { grid-template-columns: minmax(0, 1fr) auto; }.records-answer__values { grid-column: 1 / -1; grid-row: 2; }.records-answer__result { grid-column: 2; grid-row: 1; }.records-answer__head { flex-wrap: wrap; gap: 6px 12px; }.records-answer__head strong { margin-left: auto; } }
@media (max-width: 420px) { .records-answer__values { grid-template-columns: 1fr; }.records-filters { flex-wrap: wrap; }.records-filters select { width: 100%; } }
</style>
