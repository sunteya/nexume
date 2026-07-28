import { ElLoading } from "element-plus";
import { createApp } from "vue";

import App from "./App.vue";
import "./app.css";
import "element-plus/theme-chalk/dark/css-vars.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

function syncColorScheme(event: MediaQueryList | MediaQueryListEvent): void {
  document.documentElement.classList.toggle("dark", event.matches);
}

syncColorScheme(colorScheme);
colorScheme.addEventListener("change", syncColorScheme);

createApp(App).use(ElLoading).mount("#app");
