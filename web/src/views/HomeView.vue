<script setup lang="ts">
import { Database, Play, Users } from "lucide-vue-next";
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const nickname = ref(localStorage.getItem("arkfeets:nickname") ?? "博士");

function enterSolo() {
  localStorage.setItem("arkfeets:nickname", nickname.value.trim() || "博士");
  router.push("/solo");
}
</script>

<template>
  <main class="home">
    <section class="home-hero">
      <div class="home-hero__shade" />
      <div class="home-hero__content">
        <p class="eyebrow">IMAGE IDENTIFICATION / 01</p>
        <h1>粥批来猜∠</h1>
        <p class="lead">从一块局部开始，把记忆里的干员、场景和故事重新拼完整。</p>
        <div class="identity-field">
          <label for="nickname">玩家代号</label>
          <input id="nickname" v-model="nickname" maxlength="20" autocomplete="nickname" />
        </div>
        <div class="mode-actions">
          <button class="button button--primary" @click="enterSolo"><Play :size="19" />单人挑战</button>
          <button class="button" disabled><Users :size="19" />多人房间 <span>开发中</span></button>
          <button class="icon-button" disabled title="题库管理开发中"><Database :size="20" /></button>
        </div>
      </div>
      <div class="hero-index">01 / SOLO</div>
    </section>
    <section class="mode-strip" aria-label="模式状态">
      <div><strong>4</strong><span>难度</span></div>
      <div><strong>10</strong><span>初始生命</span></div>
      <div><strong>3</strong><span>演示题目</span></div>
    </section>
  </main>
</template>
