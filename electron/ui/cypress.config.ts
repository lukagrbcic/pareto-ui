import { defineConfig } from "cypress";
import { downloadFile } from "cypress-downloadfile/lib/addPlugin";

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      on("task", { downloadFile });
      return config;
    },
    baseUrl: "http://localhost:3000",
    video: false,
  },
  chromeWebSecurity: false,
});
