<script setup lang="ts">
import { Database, Play, Users } from "lucide-vue-next";
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

const router = useRouter();
const route = useRoute();
const nickname = ref(localStorage.getItem("arkfeets:nickname") ?? "博士");
const notice = ref(typeof route.query.notice === "string" ? route.query.notice : "");

function enterSolo() {
  localStorage.setItem("arkfeets:nickname", nickname.value.trim() || "博士");
  router.push("/solo");
}

function enterMulti() {
  localStorage.setItem("arkfeets:nickname", nickname.value.trim() || "博士");
  router.push("/multi");
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
        <h1>粥批<br />来猜∠</h1>
        <p class="lead">博士，请根据图像识别干员、场景与故事。小助手已经把题目整理好了。</p>
        <div class="identity-field">
          <label for="nickname"><span>01</span> 玩家代号 / CODENAME</label>
          <input id="nickname" v-model="nickname" maxlength="20" autocomplete="nickname" placeholder="输入代号" />
        </div>
        <div class="mode-actions">
          <button class="button button--primary" @click="enterSolo"><Play :size="19" />单人挑战</button>
          <button class="button" @click="enterMulti"><Users :size="19" />多人房间</button>
          <button class="button" disabled><Database :size="19" />题库管理 <span>开发中</span></button>
        </div>
        <p v-if="notice" class="home-notice">{{ notice }}</p>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="hero-visual__signal">READY<br /><small>等待指令</small></div>
        <img src="/assets/quiz-assistant.png" alt="" />
        <div class="hero-visual__caption"><span>ARCHIVE ASSISTANT</span><strong>小粥</strong></div>
      </div>
      <div class="hero-index">01 / TERMINAL</div>
    </section>
    <section class="mode-strip" aria-label="模式状态">
      <div><small>DIFFICULTY</small><strong>04</strong><span>难度等级</span></div>
      <div><small>INITIAL LIFE</small><strong>10</strong><span>初始生命</span></div>
      <div><small>DATABASE</small><strong>03</strong><span>演示题目</span></div>
      <p>非官方明日方舟同人小游戏</p>
    </section>
  </main>
</template>
