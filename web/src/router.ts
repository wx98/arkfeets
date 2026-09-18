import { createRouter, createWebHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import MultiplayerRoomView from "./views/MultiplayerRoomView.vue";
import MultiplayerSetupView from "./views/MultiplayerSetupView.vue";
import SoloPlayView from "./views/SoloPlayView.vue";
import SoloSetupView from "./views/SoloSetupView.vue";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: "/", component: HomeView },
    { path: "/solo", component: SoloSetupView },
    { path: "/solo/play", component: SoloPlayView },
    { path: "/multi", component: MultiplayerSetupView },
    { path: "/multi/:roomCode", component: MultiplayerRoomView },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});
