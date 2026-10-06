<script setup lang="ts">
import { ArrowLeft, CircleCheck, History, Radio, Search, ShieldCheck, ShieldX } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface Message { uid: string; nickname: string; answer: string; messageId: string; timestamp: number; allowed: boolean }
interface LiveUser { uid: string; nickname: string; count: number; lastSeen: number }
interface Snapshot {
  roomId: number; connected: boolean; listeningEnabled: boolean; error: string; messages: Message[]; users: LiveUser[];
  blacklist: string[]; whitelist: string[]; allowlistMode: boolean;
}
const snapshot = ref<Snapshot>({ roomId: 0, connected: false, listeningEnabled: false, error: "", messages: [], users: [], blacklist: [], whitelist: [], allowlistMode: false });
const loginRequired = ref(false);
const password = ref("");
const error = ref("");
const search = ref("");
const busyUid = ref("");
const listeningBusy = ref(false);
let source: EventSource | undefined;
const users = computed(() => snapshot.value.users.filter(user => user.uid.toLowerCase().includes(search.value.trim().toLowerCase())));
function stateOf(uid: string): "normal" | "white" | "black" {
  if (snapshot.value.blacklist.includes(uid)) return "black";
  if (snapshot.value.whitelist.includes(uid)) return "white";
  return "normal";
}
async function request(path: string, method = "GET", body?: object) {
  const response = await fetch(`/api/admin/live/${path}`, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) loginRequired.value = true;
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "请求失败");
  return response.json();
}
async function connect() {
  source?.close();
  try {
    snapshot.value = await request("state");
    loginRequired.value = false;
    source = new EventSource("/api/admin/live/stream");
    source.onmessage = event => {
      try { snapshot.value = JSON.parse(event.data); error.value = ""; } catch { /* ignore malformed event */ }
    };
    source.onerror = () => { if (!snapshot.value.connected) error.value = "弹幕监控暂时断开，正在重连"; };
  } catch (cause) {
    error.value = loginRequired.value ? "" : cause instanceof Error ? cause.message : "无法连接监控";
  }
}
async function login() {
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: password.value }) });
    if (!response.ok) throw new Error("密码错误");
    password.value = "";
    await connect();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "登录失败"; }
}
async function setAccess(uid: string, status: "normal" | "white" | "black") {
  busyUid.value = uid;
  try { snapshot.value = await request(`users/${encodeURIComponent(uid)}`, "PUT", { status }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "名单更新失败"; }
  finally { busyUid.value = ""; }
}
async function toggleAllowlist() {
  try { snapshot.value = await request("allowlist", "PUT", { enabled: !snapshot.value.allowlistMode }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "模式更新失败"; }
}
async function toggleListening(event: Event) {
  if (listeningBusy.value) return;
  const input = event.target as HTMLInputElement;
  listeningBusy.value = true;
  try { snapshot.value = await request("listening", "PUT", { enabled: input.checked }); }
  catch (cause) {
    input.checked = snapshot.value.listeningEnabled;
    error.value = cause instanceof Error ? cause.message : "监听状态更新失败";
  }
  finally { listeningBusy.value = false; }
}
onMounted(() => { void connect(); });
onBeforeUnmount(() => source?.close());
</script>

<template>
  <main class="live-monitor">
    <header class="live-monitor__header">
      <a href="/multi" class="live-monitor__back" title="返回多人房间"><ArrowLeft :size="20" /></a>
      <div><small>BILIBILI LIVE / 弹幕监控</small><h1><a v-if="snapshot.roomId > 0" :href="`https://live.bilibili.com/${snapshot.roomId}`" target="_blank" rel="noopener noreferrer" title="打开 Bilibili 直播间">直播间 {{ snapshot.roomId }}</a><span v-else>直播间 未连接</span></h1></div>
      <a href="/multi/records" class="live-monitor__records" title="查看对局记录"><History :size="16" />对局记录</a>
      <label v-if="!loginRequired" class="live-monitor__listening">
        <span>监听弹幕</span>
        <input class="live-monitor__switch-input" type="checkbox" role="switch" :checked="snapshot.listeningEnabled" :disabled="listeningBusy" @change="toggleListening" />
        <span class="live-monitor__switch-track" aria-hidden="true"><span class="live-monitor__switch-thumb" /></span>
      </label>
      <span :class="['live-monitor__status', { connected: snapshot.connected }]"><Radio :size="15" />{{ snapshot.connected ? "正在接收" : snapshot.listeningEnabled ? "连接中断" : "已暂停" }}</span>
    </header>
    <p v-if="snapshot.error || error" class="live-monitor__error" role="alert">{{ snapshot.error || error }}</p>
    <section v-if="loginRequired" class="live-monitor__login">
      <h2>管理员验证</h2>
      <form @submit.prevent="login"><input v-model="password" type="password" autocomplete="current-password" placeholder="后台密码" /><button type="submit">进入监控</button></form>
    </section>
    <div v-else class="live-monitor__columns">
      <section class="live-monitor__messages">
        <header><h2>实时弹幕</h2><small>{{ snapshot.messages.length }} 条</small></header>
        <ol>
          <li v-for="item in snapshot.messages" :key="item.messageId" :class="{ blocked: !item.allowed }">
            <time>{{ new Date(item.timestamp).toLocaleTimeString() }}</time>
            <div><strong>{{ item.nickname }}</strong><small>{{ item.uid }}</small></div>
            <p>{{ item.answer }}</p>
            <span v-if="!item.allowed">已过滤</span>
          </li>
        </ol>
        <p v-if="!snapshot.messages.length" class="live-monitor__empty">等待文字弹幕...</p>
      </section>
      <section class="live-monitor__users">
        <header><h2>参与用户</h2><small>{{ snapshot.users.length }} 人</small></header>
        <div class="live-monitor__filters">
          <label><Search :size="16" /><input v-model="search" placeholder="搜索 UID" aria-label="搜索 UID" /></label>
          <label class="live-monitor__toggle"><input type="checkbox" :checked="snapshot.allowlistMode" @change="toggleAllowlist" />仅白名单</label>
        </div>
        <ol>
          <li v-for="user in users" :key="user.uid">
            <div><strong>{{ user.nickname }}</strong><small>{{ user.uid }} · {{ user.count }} 条</small></div>
            <div class="live-monitor__actions">
              <button title="正常接收" :class="{ active: stateOf(user.uid) === 'normal' }" :disabled="busyUid === user.uid" @click="setAccess(user.uid, 'normal')"><CircleCheck :size="16" /></button>
              <button title="加入白名单" :class="{ active: stateOf(user.uid) === 'white' }" :disabled="busyUid === user.uid" @click="setAccess(user.uid, 'white')"><ShieldCheck :size="16" /></button>
              <button title="加入黑名单" :class="{ active: stateOf(user.uid) === 'black' }" :disabled="busyUid === user.uid" @click="setAccess(user.uid, 'black')"><ShieldX :size="16" /></button>
            </div>
          </li>
        </ol>
        <p v-if="!users.length" class="live-monitor__empty">暂无匹配用户</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.live-monitor { min-height: 100dvh; background: #f2f3ef; color: #25292b; }
.live-monitor__header { height: 86px; display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: #25292b; color: #fff; }
.live-monitor__header h1 { margin: 2px 0 0; font-size: 23px; }
.live-monitor__header h1 a { color: inherit; text-decoration: underline; text-decoration-color: #a7bb5f; text-underline-offset: 4px; }
.live-monitor__header h1 a:hover { color: #d9ef72; }
.live-monitor__header small { color: #b8c1be; font-size: 10px; }
.live-monitor__back { display: grid; place-items: center; width: 36px; height: 36px; color: inherit; border: 1px solid #68706e; }
.live-monitor__records { margin-left: auto; display: flex; align-items: center; gap: 6px; color: #d9ef72; text-decoration: none; white-space: nowrap; font-size: 12px; }
.live-monitor__status { margin-left: auto; display: flex; align-items: center; gap: 7px; color: #f0ae60; }
.live-monitor__listening { display: flex; align-items: center; gap: 7px; font-size: 12px; white-space: nowrap; cursor: pointer; }
.live-monitor__switch-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.live-monitor__switch-track { width: 36px; height: 20px; display: flex; align-items: center; padding: 2px; border-radius: 20px; background: #6d7672; transition: background .2s; }
.live-monitor__switch-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; }
.live-monitor__switch-input:checked + .live-monitor__switch-track { background: #a7c452; }
.live-monitor__switch-input:checked + .live-monitor__switch-track .live-monitor__switch-thumb { transform: translateX(16px); }
.live-monitor__switch-input:focus-visible + .live-monitor__switch-track { outline: 2px solid #d9ef72; outline-offset: 3px; }
.live-monitor__switch-input:disabled + .live-monitor__switch-track { opacity: .6; }
.live-monitor__listening + .live-monitor__status { margin-left: 8px; }
.live-monitor__status.connected { color: #d9ef72; }
.live-monitor__error { margin: 0; padding: 9px 24px; background: #ffebdb; color: #8c4026; }
.live-monitor__columns { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(330px, 1fr); height: calc(100dvh - 86px); }
.live-monitor__columns section { min-width: 0; overflow: auto; }
.live-monitor__users { border-left: 1px solid #d0d5d1; background: #fff; }
.live-monitor__columns header { position: sticky; top: 0; display: flex; align-items: baseline; justify-content: space-between; padding: 20px 24px 14px; background: inherit; border-bottom: 1px solid #d0d5d1; }
.live-monitor__columns h2 { margin: 0; font-size: 18px; }
.live-monitor__columns header small, .live-monitor__empty { color: #727a78; }
.live-monitor__columns ol { margin: 0; padding: 0; list-style: none; }
.live-monitor__messages li, .live-monitor__users li { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid #dce0dc; }
.live-monitor__messages li.blocked { opacity: .55; }
.live-monitor__messages time { font-size: 11px; color: #737b78; white-space: nowrap; }
.live-monitor__messages li div, .live-monitor__users li > div:first-child { min-width: 0; display: flex; flex-direction: column; }
.live-monitor__messages li small, .live-monitor__users li small { font-size: 11px; color: #8b9290; overflow: hidden; text-overflow: ellipsis; }
.live-monitor__messages li p { min-width: 0; margin: 0; flex: 1; overflow-wrap: anywhere; }
.live-monitor__messages li span { color: #a84636; font-size: 11px; white-space: nowrap; }
.live-monitor__filters { display: flex; align-items: center; gap: 10px; padding: 12px 24px; }
.live-monitor__filters > label:first-child { display: flex; align-items: center; gap: 7px; flex: 1; border: 1px solid #cbd1cd; padding: 7px; }
.live-monitor__filters input:not([type=checkbox]) { min-width: 0; width: 100%; border: 0; outline: 0; }
.live-monitor__toggle { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 12px; }
.live-monitor__users li { justify-content: space-between; }
.live-monitor__actions { display: flex; gap: 4px; }
.live-monitor__actions button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid #c9d1ca; background: #fff; cursor: pointer; }
.live-monitor__actions button.active { background: #d9ef72; border-color: #7d9854; }
.live-monitor__actions button:disabled { opacity: .5; cursor: wait; }
.live-monitor__empty { padding: 20px 24px; }
.live-monitor__login { max-width: 400px; margin: 80px auto; padding: 24px; background: #fff; }
.live-monitor__login h2 { margin-top: 0; font-size: 19px; }
.live-monitor__login form { display: flex; gap: 8px; }
.live-monitor__login input { min-width: 0; flex: 1; padding: 10px; border: 1px solid #bac3bd; }
.live-monitor__login button { border: 0; background: #d9ef72; padding: 0 14px; cursor: pointer; }
@media (max-width: 760px) { .live-monitor__columns { display: block; height: auto; } .live-monitor__columns section { max-height: 50dvh; } .live-monitor__users { border-left: 0; border-top: 1px solid #d0d5d1; } .live-monitor__header { height: auto; min-height: 86px; flex-wrap: wrap; padding-inline: 12px; } .live-monitor__header h1 { font-size: 18px; } .live-monitor__listening { margin-left: auto; } .live-monitor__listening + .live-monitor__status { margin-left: 0; } .live-monitor__columns { height: auto; } }
</style>
