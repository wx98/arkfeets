import { ref } from "vue";

export const appName = ref("粥粥图猜猜");
export const homeImageUrl = ref<string | null>(null);
export const questionCount = ref(0);

export async function loadSite(excludeImageUrl?: string): Promise<void> {
  const url = excludeImageUrl ? `/api/site?exclude=${encodeURIComponent(excludeImageUrl)}` : "/api/site";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取首页配置");
  const site = await response.json() as { appName?: string; homeImageUrl?: string | null; questionCount?: number };
  appName.value = site.appName?.trim() || "粥粥图猜猜";
  if (site.homeImageUrl) {
    const image = new Image();
    image.src = site.homeImageUrl;
    await image.decode();
  }
  homeImageUrl.value = site.homeImageUrl || null;
  questionCount.value = site.questionCount ?? 0;
  document.title = appName.value;
}
