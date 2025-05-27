const cron = require('node-cron');
const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const config = require('./env_config');

const logger = {
    info: (message) => console.log(`[INFO] ${new Date().toISOString()} ${message}`),
    warn: (message) => console.warn(`[WARN] ${new Date().toISOString()} ${message}`),
    error: (message, error) => console.error(`[ERROR] ${new Date().toISOString()} ${message}`, error || ''),
    debug: (message) => {
        if (config.logLevel === 'debug') {
            console.log(`[DEBUG] ${new Date().toISOString()} ${message}`);
        }
    },
};

logger.info(`Orchestrator starting with NODE_ENV: ${config.nodeEnv}`);
logger.info(`Log level set to: ${config.logLevel}`);

// --- Source Database Pool ---
let sourceDbPool;
try {
    sourceDbPool = new Pool(config.sourceDb);
    sourceDbPool.on('error', (err) => {
        logger.error('Source DB Pool Error:', err);
    });
    logger.info('Source DB pool created.');
} catch (error) {
    logger.error('Failed to create source database pool:', error);
    process.exit(1);
}

// --- Airbyte API Client ---
const airbyteApiClient = axios.create({
    baseURL: config.airbyte.apiUrl,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json', 
    }
});

// --- File-based State Management --- 

async function readStateFile(filePath) {
    try {
        await fs.access(filePath); // Check if file exists
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.debug(`State file not found: ${filePath}. Returning empty object.`);
            return {};
        }
        logger.error(`Error reading state file ${filePath}:`, error);
        throw error;
    }
}

async function writeStateFile(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.debug(`State file updated: ${filePath}`);
    } catch (error) {
        logger.error(`Error writing state file ${filePath}:`, error);
        throw error;
    }
}

async function getLastSyncTimestamps() {
    return readStateFile(config.orchestrator.lastSyncTimestampsFile);
}

async function writeLastSyncTimestamps(timestamps) {
    await writeStateFile(config.orchestrator.lastSyncTimestampsFile, timestamps);
}

async function getActiveJobs() {
    return readStateFile(config.orchestrator.activeJobsFile);
}

async function writeActiveJobs(jobs) {
    await writeStateFile(config.orchestrator.activeJobsFile, jobs);
}

// --- Airbyte API Functions ---

async function triggerAirbyteSync(connectionId) {
    logger.info(`Triggering Airbyte sync for connection ID: ${connectionId}`);
    try {
        const response = await airbyteApiClient.post('/jobs', { connectionId, jobType: 'sync' });
        const jobId = response.data?.job?.jobId || response.data?.jobId; // Adapt based on exact API response
        if (!jobId) {
            logger.error('Airbyte sync trigger response did not include a job ID.', response.data);
            throw new Error('Airbyte sync trigger response did not include a job ID.');
        }
        logger.info(`Airbyte sync triggered successfully for connection ${connectionId}. Job ID: ${jobId}`);
        return { jobId };
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`Error triggering Airbyte sync for connection ${connectionId}: ${errorMessage}`);
        throw error;
    }
}

async function getAirbyteJobDetails(jobId) {
    logger.debug(`Fetching Airbyte job details for Job ID: ${jobId}`);
    try {
        const response = await airbyteApiClient.get(`/jobs/${jobId}`);
        const job = response.data.job || response.data; 
        if (!job) {
            logger.warn(`No job details found in Airbyte response for job ID ${jobId}`, response.data);
            return null;
        }
        logger.debug(`Job details for ${jobId}: Status - ${job.status}, CreatedAt - ${job.createdAt}, UpdatedAt - ${job.updatedAt}`);
        return {
            id: job.jobId,
            status: job.status?.toLowerCase(), 
            createdAt: job.createdAt ? new Date(job.createdAt * 1000) : null, 
            updatedAt: job.updatedAt ? new Date(job.updatedAt * 1000) : null,
            duration: job.duration,
            rowsSynced: job.rowsSynced
        };
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`Error fetching Airbyte job details for Job ID ${jobId}: ${errorMessage}`);
        if (error.response && error.response.status === 404) {
            logger.warn(`Airbyte job ${jobId} not found.`);
            return { id: jobId, status: 'not_found' }; 
        }
        throw error;
    }
}

// --- Source DB Functions ---

async function getMaxUpdatedAtForTable(schema, table, updatedAtColumn) {
    const qualifiedTableName = sourceDbPool.escapeIdentifier(schema) + '.' + sourceDbPool.escapeIdentifier(table);
    const qualifiedUpdatedAtCol = sourceDbPool.escapeIdentifier(updatedAtColumn);
    const query = `SELECT MAX(${qualifiedUpdatedAtCol}) as max_updated_at FROM ${qualifiedTableName};`;
    logger.debug(`Querying max ${updatedAtColumn} from ${qualifiedTableName}`);
    try {
        const result = await sourceDbPool.query(query);
        if (result.rows.length > 0 && result.rows[0].max_updated_at) {
            return new Date(result.rows[0].max_updated_at);
        }
        return null;
    } catch (dbError) {
        logger.error(`Error fetching max ${updatedAtColumn} for ${qualifiedTableName}:`, dbError);
        throw dbError;
    }
}

// --- Main Orchestration Logic ---

async function processConnection(connectionConfig) {
    const { connectionId, description, monitoredTables } = connectionConfig;
    logger.info(`Processing connection: ${description} (ID: ${connectionId})`);

    const activeJobs = await getActiveJobs();
    const lastSyncTimestamps = await getLastSyncTimestamps();

    // 1. Check status of any ongoing Airbyte job for this connection
    if (activeJobs[connectionId]) {
        const jobId = activeJobs[connectionId];
        logger.info(`Found active Airbyte Job ID ${jobId} for connection ${connectionId}. Checking status...`);
        try {
            const jobDetails = await getAirbyteJobDetails(jobId);
            if (jobDetails) {
                if (jobDetails.status === 'succeeded') {
                    logger.info(`Airbyte Job ${jobDetails.jobId} for connection ${connectionId} succeeded.`);
                    lastSyncTimestamps[connectionId] = (jobDetails.updatedAt || new Date()).toISOString();
                    delete activeJobs[connectionId];
                } else if (['failed', 'cancelled', 'not_found'].includes(jobDetails.status)) {
                    logger.error(`Airbyte Job ${jobDetails.jobId} for connection ${connectionId} reported status: ${jobDetails.status}.`);
                    delete activeJobs[connectionId]; 
                } else {
                    logger.info(`Airbyte Job ${jobDetails.jobId} for connection ${connectionId} is still ${jobDetails.status}. Will check again next cycle.`);
                    // No state change for activeJobs or lastSyncTimestamps if still running/pending
                    await writeActiveJobs(activeJobs);
                    await writeLastSyncTimestamps(lastSyncTimestamps);
                    return; 
                }
            }
        } catch (error) {
            logger.error(`Error checking Airbyte job status for ${jobId} (connection ${connectionId}):`, error);
        }
    } 
    
    // 2. Check for new data in monitored tables if no job is currently active for this connection
    let needsSync = false;
    if (!activeJobs[connectionId] && monitoredTables && monitoredTables.length > 0) {
        const lastSyncTimeForConnection = lastSyncTimestamps[connectionId] ? new Date(lastSyncTimestamps[connectionId]) : null;
        logger.debug(`Last sync time for connection ${connectionId}: ${lastSyncTimeForConnection ? lastSyncTimeForConnection.toISOString() : 'Never (or not recorded)'}`);

        let latestTimestampFound = null;

        for (const table of monitoredTables) {
            try {
                const maxTs = await getMaxUpdatedAtForTable(table.schemaName, table.tableName, table.updatedAtColumn);
                if (maxTs) {
                    logger.debug(`Max ${table.updatedAtColumn} for ${table.schemaName}.${table.tableName}: ${maxTs.toISOString()}`);
                    if (!lastSyncTimeForConnection || maxTs > lastSyncTimeForConnection) {
                        logger.info(`New data detected in ${table.schemaName}.${table.tableName} (max_updated_at: ${maxTs.toISOString()}) since last sync for connection ${connectionId}.`);
                        needsSync = true;
                        // Keep track of the absolute latest timestamp if needed for future strategies, though not used in current logic directly for triggering.
                        if (!latestTimestampFound || maxTs > latestTimestampFound) {
                            latestTimestampFound = maxTs;
                        }
                    }
                }
            } catch (tableError) {
                logger.error(`Could not check ${table.updatedAtColumn} for ${table.schemaName}.${table.tableName} on connection ${connectionId}. Skipping this table for now.`, tableError);
            }
        }
    } else if (monitoredTables.length === 0) {
        logger.warn(`No tables configured for monitoring on connection ${connectionId}. Skipping data check.`);
    }

    // 3. Trigger sync if needed and no job currently active for this connection
    if (needsSync && !activeJobs[connectionId]) {
        logger.info(`New data detected. Attempting to trigger sync for connection ${connectionId}.`);
        try {
            const airbyteJob = await triggerAirbyteSync(connectionId);
            activeJobs[connectionId] = airbyteJob.jobId;
            logger.info(`Sync successfully triggered for connection ${connectionId}, Airbyte Job ID: ${airbyteJob.jobId}.`);
        } catch (error) {
            logger.error(`Failed to trigger sync for connection ${connectionId}:`, error);
        }
    } else if (!needsSync && !activeJobs[connectionId]) {
        logger.info(`No new data detected for connection ${connectionId}. No sync triggered.`);
    }

    // 4. Persist state changes
    await writeActiveJobs(activeJobs);
    await writeLastSyncTimestamps(lastSyncTimestamps);

    logger.info(`Finished processing connection: ${description} (ID: ${connectionId})`);
}

async function runOrchestration() {
    logger.info('Starting orchestration cycle...');
    
    if (!config.monitoredConnectionsAndTables || config.monitoredConnectionsAndTables.length === 0) {
        logger.warn('No connections configured in monitored_tables_config.json. Orchestration cycle will do nothing.');
        return;
    }

    for (const connectionConfig of config.monitoredConnectionsAndTables) {
        if (!connectionConfig.connectionId || !connectionConfig.monitoredTables) {
            logger.warn('Invalid connection configuration found in monitored_tables_config.json. Skipping.', connectionConfig);
            continue;
        }
        try {
            await processConnection(connectionConfig);
        } catch (error) {
            logger.error(`Unhandled error processing connection ${connectionConfig.connectionId}:`, error);
        }
    }
    logger.info('Orchestration cycle finished.');
}

// --- Cron Job Setup ---
if (cron.validate(config.orchestrator.cronSchedule)) {
    logger.info(`Scheduling cron job with schedule: ${config.orchestrator.cronSchedule}`);
    cron.schedule(config.orchestrator.cronSchedule, () => {
        logger.info('Cron job triggered by schedule.');
        runOrchestration().catch(err => {
            logger.error('Unhandled error during scheduled orchestration run:', err);
        });
    });
} else {
    logger.error(`Invalid cron schedule: ${config.orchestrator.cronSchedule}. Orchestrator will not run on schedule.`);
    logger.info('Running orchestration once on startup due to invalid cron schedule (or for development)...');
    runOrchestration().catch(err => {
        logger.error('Unhandled error during initial orchestration run:', err);
    });
}

//  Shutdown ---
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    cron.getTasks().forEach(task => task.stop());
    logger.info('Cron jobs stopped.');

    try {
        if (sourceDbPool) {
            await sourceDbPool.end();
            logger.info('Source DB pool closed.');
        }
    } catch (error) {
        logger.error('Error during DB pool shutdown:', error);
    }
    logger.info('Shutdown complete. Exiting.');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

logger.info('Orchestrator setup complete.'); 