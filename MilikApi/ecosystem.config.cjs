module.exports = {
  apps: [
    {
      name: "milik-api",
      script: "server.js",
      instances: "max",       // 1 worker per CPU core (4 on your machine)
      exec_mode: "cluster",   // share the port across all workers
      interpreter: "node",
      node_args: "--experimental-vm-modules",

      // Restart policy
      watch: false,           // never watch files in production
      max_memory_restart: "500M",
      restart_delay: 3000,
      max_restarts: 10,

      // Environment — PM2 passes these to every worker
      env_production: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
      },

      // Logging
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
