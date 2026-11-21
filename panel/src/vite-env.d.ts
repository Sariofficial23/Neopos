/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Ссылка на установщик кассы для Windows. Пусто — кнопки «Скачать» не показываются. */
  readonly VITE_DOWNLOAD_URL?: string
}
