<script setup lang="ts">
import { Play, RefreshCw, Settings2, Users } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appName, homeImageUrl, loadSite, questionCount } from "../api/site";

const router = useRouter();
const route = useRoute();
const nickname = ref(localStorage.getItem("arkfeets:nickname") ?? "博士");
const notice = ref(typeof route.query.notice === "string" ? route.query.notice : "");
const refreshingImage = ref(false);
const motionVariant = ref(Math.floor(Math.random() * 3));
let rotationTimer: number | undefined;

onMounted(() => {
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    rotationTimer = window.setInterval(() => { void refreshImage(); }, 12000);
  }
});
onBeforeUnmount(() => window.clearInterval(rotationTimer));

async function refreshImage() {
  if (refreshingImage.value) return;
  refreshingImage.value = true;
  try {
    const previous = homeImageUrl.value;
    await loadSite(previous ?? undefined);
    if (homeImageUrl.value !== previous) motionVariant.value = (motionVariant.value + 1 + Math.floor(Math.random() * 2)) % 3;
    if (notice.value === "暂时无法刷新原图") notice.value = "";
  }
  catch { notice.value = "暂时无法刷新原图"; }
  finally { refreshingImage.value = false; }
}

function enterSolo() {
  localStorage.setItem("arkfeets:nickname", nickname.value.trim() || "博士");
  router.push("/solo");
}

function enterMulti() {
  localStorage.setItem("arkfeets:nickname", nickname.value.trim() || "博士");
  router.push("/multi");
}

function enterAdmin() {
  router.push("/admin");
}
</script>

<template>
  <main class="home">
    <header class="home-masthead">
      <span class="home-masthead__brand">ARKNIGHTS FAN GAME</span>
      <span class="home-masthead__status"><i /> PRTS LINK / ONLINE</span>
    </header>
    <section class="home-hero">
      <div class="home-hero__grid" />
      <div class="home-hero__content">
        <div class="hero-code"><span>OPERATION</span><strong>IQ-01</strong></div>
        <p class="eyebrow">IMAGE IDENTIFICATION / 图像识别作战</p>
        <h1>{{ appName }}</h1>
        <p class="lead">博士，请根据图像识别干员、场景与故事。小助手已经把题目整理好了。</p>
        <div class="identity-field">
          <label for="nickname"><span>01</span> 玩家代号 / CODENAME</label>
          <input id="nickname" v-model="nickname" maxlength="20" autocomplete="nickname" placeholder="输入代号" />
        </div>
        <div class="mode-actions">
          <button class="button button--primary" @click="enterSolo"><Play :size="19" />单人挑战</button>
          <button class="button" @click="enterMulti"><Users :size="19" />多人房间</button>
          <button class="button" @click="enterAdmin"><Settings2 :size="19" />设置</button>
        </div>
        <p v-if="notice" class="home-notice">{{ notice }}</p>
      </div>
      <div class="hero-visual">
        <button class="hero-visual__refresh" type="button" title="换一张原图" aria-label="换一张原图" :disabled="refreshingImage" @click="refreshImage"><RefreshCw :size="19" /></button>
        <div class="hero-visual__signal">READY<br /><small>等待指令</small></div>
        <Transition name="hero-swap">
          <div v-if="homeImageUrl" :key="homeImageUrl" class="hero-visual__slide" :class="`hero-visual__motion--${motionVariant}`">
            <img class="hero-visual__ambient" :src="homeImageUrl" alt="" />
            <img class="hero-visual__portrait" :src="homeImageUrl" alt="" />
          </div>
        </Transition>
        <div class="hero-visual__caption"><span>ARCHIVE / 随机原图</span><strong>原图档案</strong></div>
      </div>
      <div class="hero-index">01 / TERMINAL</div>
    </section>
    <section class="mode-strip" aria-label="模式状态">
      <div><small>DIFFICULTY</small><strong>04</strong><span>难度等级</span></div>
      <div><small>INITIAL LIFE</small><strong>10</strong><span>初始生命</span></div>
      <div><small>DATABASE</small><strong>{{ questionCount }}</strong><span>可用题目</span></div>
      <p>非官方明日方舟同人小游戏</p>
    </section>
  </main>
</template>
