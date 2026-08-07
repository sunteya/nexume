import { ElLoading } from "element-plus"
import { createApp } from "vue"

import "@nexume/admin-ui/style.css"
import "element-plus/theme-chalk/dark/css-vars.css"

import { HttpAdminApp } from "@nexume/admin-ui"

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)")
let quitLoading: ReturnType<typeof ElLoading.service> | undefined

function syncColorScheme(event: MediaQueryList | MediaQueryListEvent): void {
  document.documentElement.classList.toggle("dark", event.matches)
}

syncColorScheme(colorScheme)
colorScheme.addEventListener("change", syncColorScheme)
window.addEventListener("nexume:quit-waiting", () => {
  quitLoading ??= ElLoading.service({
    lock: true,
    text: "Finishing collector sync...",
    background: "rgba(0, 0, 0, 0.58)",
  })
})

createApp(HttpAdminApp, { mode: "desktop" }).use(ElLoading).mount("#app")
