const fs = require("fs").promises;
const { logger } = require("../logger");
const config = require("../env_config");
export async function writeStateFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    logger.debug(`State file updated: ${filePath}`);
  } catch (error) {
    logger.error(`Error writing state file ${filePath}:`, error);
    throw error;
  }
}
export async function writeLastSyncTimestamps(timestamps) {
  await writeStateFile(config.orchestrator.lastSyncTimestampsFile, timestamps);
}
export async function writeActiveJobs(jobs) {
  await writeStateFile(config.orchestrator.activeJobsFile, jobs);
}
