export const logger = {
  info: (message) =>
    console.log(`[INFO] ${new Date().toISOString()} ${message}`),
  warn: (message) =>
    console.warn(`[WARN] ${new Date().toISOString()} ${message}`),
  error: (message, error) =>
    console.error(
      `[ERROR] ${new Date().toISOString()} ${message}`,
      error || ""
    ),
  debug: (message) => {
    if (config.logLevel === "debug") {
      console.log(`[DEBUG] ${new Date().toISOString()} ${message}`);
    }
  },
};
