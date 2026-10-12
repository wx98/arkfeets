<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import { loadSite } from "./api/site";

onMounted(() => { void loadSite().catch(() => {}); });
</script>

<template>
  <RouterView />
</template>
