/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KP_WEB_SERVICE_WORKER?: string;
  readonly VITE_KP_WEB_ACCOUNT_INTEGRATION?: string;
  readonly VITE_KP_WEB_MESSAGING?: string;
  readonly VITE_KP_WEB_STATUSES?: string;
  readonly VITE_KP_WEB_MEDIA?: string;
  readonly VITE_KP_WEB_CALLS?: string;
  readonly VITE_KP_WEB_PUSH?: string;
  /** Absolute https origin of the Worker API when the shell is hosted elsewhere (Firebase). */
  readonly VITE_KP_API_ORIGIN?: string;
}
