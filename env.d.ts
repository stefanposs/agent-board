/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** Provided by VS Code webview runtime — only available inside a webview. */
declare function acquireVsCodeApi(): {
  postMessage(msg: any): void
  getState(): any
  setState(state: any): void
}
