import { defineConfig } from "cypress";
import { downloadFile } from "cypress-downloadfile/lib/addPlugin";

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      on("task", { downloadFile });
      // windows-latest images since 20261021 crash-loop the GPU process of
      // every Chromium browser (exit 0xC0000005), ending in "GPU process
      // isn't usable. Goodbye." Run the browser on software rendering so
      // the GPU process is never required.
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.family === "chromium" && browser.name !== "electron" && launchOptions.args) {
          launchOptions.args.push("--disable-gpu", "--disable-gpu-compositing");
        }
        return launchOptions;
      });
      return config;
    },
    baseUrl: "http://localhost:3000",
    video: false,
  },
  chromeWebSecurity: false,
});
