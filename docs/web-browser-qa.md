# Web browser QA

The Playwright smoke suite runs the built Vite preview in Chromium. It covers the preview-only disclosure, section/deep-link/history navigation, not-found recovery, mobile back navigation, keyboard operation, online/offline status, and axe WCAG 2.1/2.2 A/AA scans of representative desktop and mobile routes. It does not exercise account credentials, live API data, media upload, or calls.

```sh
npm run build:web
npx playwright install --with-deps chromium   # Linux, one-time browser + system setup
npm run test:web:e2e
```

On macOS/Windows, install the browser with `npx playwright install chromium` instead. Ubuntu CI uses the same `--with-deps` command. Playwright blocks service-worker control in these UI tests to prevent cross-test cache state; the generated worker has its own artifact/runtime verification via `npm run verify:web-sw`.
