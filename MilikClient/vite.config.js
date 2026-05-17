import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    proxy: {
      "/api": "http://localhost:8800",
      "/uploads": "http://localhost:8800",
    },
  },

  build: {
    // Raise the warning threshold — our lazy chunks will be small
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — cached forever, changes almost never
          "vendor-react": ["react", "react-dom", "react-is"],
          // Routing
          "vendor-router": ["react-router-dom"],
          // State management
          "vendor-redux": [
            "@reduxjs/toolkit",
            "react-redux",
            "redux-persist",
            "redux-thunk",
          ],
          // Charts — large, rarely changes
          "vendor-charts": ["recharts"],
          // Spreadsheet export — very large, only used on export pages
          "vendor-xlsx": ["xlsx"],
          // PDF generation — large, only used on print pages
          "vendor-pdf": ["html2pdf.js"],
          // Real-time comms
          "vendor-socket": ["socket.io-client"],
          // UI utilities
          "vendor-ui": [
            "react-toastify",
            "react-hot-toast",
            "axios",
            "crypto-js",
          ],
          // Icons — large but treeshaken; grouping reduces per-chunk duplication
          "vendor-icons": ["react-icons"],
        },
      },
    },

    // Use esbuild for minification (faster + smaller output)
    minify: "esbuild",

    // Strip all console.* and debugger statements from production bundle
    esbuildOptions: {
      drop: ["console", "debugger"],
    },

    // Split CSS per chunk so unused styles aren't loaded
    cssCodeSplit: true,

    // Modern browsers only — smaller output, faster parse
    target: "es2018",

    // Source maps off in production = smaller files
    sourcemap: false,
  },

  // Optimise pre-bundling so cold dev starts are faster
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "@reduxjs/toolkit",
      "react-redux",
      "axios",
      "react-toastify",
    ],
  },
});
