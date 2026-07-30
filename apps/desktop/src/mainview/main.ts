import { ElLoading } from "element-plus"
import { createApp } from "vue"

import "@nexume/admin-ui/style.css"
import "element-plus/theme-chalk/dark/css-vars.css"

import { HttpAdminApp } from "@nexume/admin-ui"

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)")

function syncColorScheme(event: MediaQueryList | MediaQueryListEvent): void {
  document.documentElement.classList.toggle("dark", event.matches)
}

syncColorScheme(colorScheme)
colorScheme.addEventListener("change", syncColorScheme)

createApp(HttpAdminApp, { mode: "desktop" }).use(ElLoading).mount("#app")
