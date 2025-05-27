const fs = require("fs").promises;
const { logger } = require("../logger");
const config = require("../env_config");
export async function readStateFile(filePath) {
  try {
    await fs.access(filePath); // Check if file exists
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      logger.debug(
        `State file not found: ${filePath}. Returning empty object.`
      );
      return {};
    }
    logger.error(`Error reading state file ${filePath}:`, error);
    throw error;
  }
}
export async function getLastSyncTimestamps() {
  return readStateFile(config.orchestrator.lastSyncTimestampsFile);
}
export async function getActiveJobs() {
  return readStateFile(config.orchestrator.activeJobsFile);
}
