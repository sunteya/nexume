import { ElLoading } from "element-plus";
import { createApp } from "vue";

import "@nexume/admin-ui/style.css";
import "element-plus/theme-chalk/dark/css-vars.css";

import DesktopApp from "./DesktopApp.vue";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

function syncColorScheme(event: MediaQueryList | MediaQueryListEvent): void {
  document.documentElement.classList.toggle("dark", event.matches);
}

syncColorScheme(colorScheme);
colorScheme.addEventListener("change", syncColorScheme);

createApp(DesktopApp).use(ElLoading).mount("#app");
