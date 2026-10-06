<script setup lang="ts">
import { ArrowLeft, ChevronRight, Database, History, LogOut, Radio, Settings2 } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const checking = ref(true);
const authenticated = ref(false);
const password = ref("");
const busy = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    const response = await fetch("/api/admin/session", { credentials: "same-origin" });
    authenticated.value = response.ok;
    if (response.ok) sessionStorage.removeItem("arkfeets:admin-token");
    if (!response.ok && response.status !== 401) error.value = "无法检查管理会话";
  } catch { error.value = "无法连接后台服务"; }
  finally { checking.value = false; }
});

async function login() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    if (!response.ok) throw new Error("密码错误");
    const session = await response.json() as { token: string };
    sessionStorage.setItem("arkfeets:admin-token", session.token);
    password.value = "";
    authenticated.value = true;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "登录失败"; }
  finally { busy.value = false; }
}

async function logout() {
  if (busy.value) return;
  busy.value = true;
  try { await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }); }
  catch { /* Clear this browser's session even when the request fails. */ }
  finally {
    sessionStorage.removeItem("arkfeets:admin-token");
    authenticated.value = false;
    busy.value = false;
  }
}
</script>

<template>
  <main class="admin-hub">
    <header class="admin-hub__header">
      <button class="admin-hub__icon" title="返回首页" aria-label="返回首页" @click="router.push('/')"><ArrowLeft :size="20" /></button>
      <div class="admin-hub__heading"><small>SYSTEM / CONTROL</small><h1>后台管理</h1></div>
      <button v-if="authenticated" class="admin-hub__icon admin-hub__logout" title="退出后台" aria-label="退出后台" :disabled="busy" @click="logout"><LogOut :size="19" /></button>
    </header>

    <section v-if="checking" class="admin-hub__state">正在验证管理会话...</section>
    <section v-else-if="!authenticated" class="admin-hub__login">
      <Settings2 :size="28" />
      <h2>管理员验证</h2>
      <form @submit.prevent="login">
        <label for="admin-hub-password">后台密码</label>
        <input id="admin-hub-password" v-model="password" type="password" autocomplete="current-password" required />
        <button type="submit" :disabled="busy">{{ busy ? '验证中...' : '进入后台' }}</button>
      </form>
      <p v-if="error" class="admin-hub__error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="admin-hub__content">
      <div class="admin-hub__section-title"><span>管理模块</span><small>03 / SECTIONS</small></div>
      <nav aria-label="后台管理模块">
        <RouterLink to="/admin/questions"><Database :size="22" /><span>题库管理</span><ChevronRight :size="19" /></RouterLink>
        <RouterLink to="/multi/records"><History :size="22" /><span>对局记录</span><ChevronRight :size="19" /></RouterLink>
        <RouterLink to="/multi/live-monitor"><Radio :size="22" /><span>弹幕监控</span><ChevronRight :size="19" /></RouterLink>
      </nav>
    </section>
  </main>
</template>

<style scoped>
.admin-hub { min-height: 100dvh; background: #f2f3ef; color: #25292b; }
.admin-hub__header { height: 82px; display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: #25292b; color: #fff; }
.admin-hub__icon { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #68706e; background: transparent; color: inherit; cursor: pointer; }
.admin-hub__logout { margin-left: auto; }.admin-hub__icon:disabled { opacity: .5; cursor: wait; }
.admin-hub__heading small { color: #b8c1be; font-size: 10px; }.admin-hub__heading h1 { margin: 2px 0 0; font-size: 22px; }
.admin-hub__state { padding: 32px 24px; color: #69736e; }
.admin-hub__login { max-width: 390px; margin: 78px auto; padding: 28px; background: #fff; border-top: 3px solid #a7c452; }
.admin-hub__login > svg { color: #5f7f46; }.admin-hub__login h2 { margin: 13px 0 22px; font-size: 19px; }
.admin-hub__login form { display: grid; gap: 10px; }.admin-hub__login label { color: #67716b; font-size: 12px; }.admin-hub__login input { width: 100%; padding: 10px 12px; border: 1px solid #b9c2ba; font: inherit; }.admin-hub__login button { margin-top: 6px; padding: 11px; border: 0; background: #d9ef72; color: #25292b; font: inherit; font-weight: 700; cursor: pointer; }.admin-hub__login button:disabled { opacity: .6; cursor: wait; }
.admin-hub__error { margin: 14px 0 0; color: #a24630; font-size: 13px; }
.admin-hub__content { max-width: 780px; margin: 0 auto; padding: 42px 24px; }
.admin-hub__section-title { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 12px; border-bottom: 1px solid #cbd2cb; color: #657069; }.admin-hub__section-title small { font-size: 10px; }
.admin-hub__content nav { display: grid; }.admin-hub__content nav a { min-height: 78px; display: flex; align-items: center; gap: 18px; padding: 16px 12px; border-bottom: 1px solid #cbd2cb; color: inherit; text-decoration: none; font-size: 17px; }.admin-hub__content nav a:hover, .admin-hub__content nav a:focus-visible { background: #e8efda; }.admin-hub__content nav a > svg:first-child { color: #658547; }.admin-hub__content nav a > svg:last-child { margin-left: auto; color: #747d77; }
@media (max-width: 520px) { .admin-hub__header { padding-inline: 12px; }.admin-hub__login { margin: 40px 16px; }.admin-hub__content { padding: 26px 16px; } }
</style>
