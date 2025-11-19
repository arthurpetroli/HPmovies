import { defineConfig } from "vitest/config.js";

export default defineConfig({
    test: {
        name: "aniwatch-api",
        environment: "node",
        testTimeout: 15000,
    },
});
