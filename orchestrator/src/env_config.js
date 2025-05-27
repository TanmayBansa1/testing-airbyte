const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Function to load monitored tables configuration
function loadMonitoredTablesConfig() {
    const configPath = path.resolve(__dirname, '../monitored_tables_config.json');
    try {
        if (fs.existsSync(configPath)) {
            const rawData = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(rawData);
        }
        console.warn(`Warning: monitored_tables_config.json not found at ${configPath}. Orchestrator will not monitor any tables. Please create it based on monitored_tables_config.json.example.`);
        return [];
    } catch (error) {
        console.error(`Error loading or parsing monitored_tables_config.json from ${configPath}:`, error);
        process.exit(1);
    }
}

const config = {
    nodeEnv: process.env.NODE_ENV || 'development',

    // Source PostgreSQL Database (for monitoring changes)
    sourceDb: {
        host: process.env.SOURCE_DB_HOST,
        port: parseInt(process.env.SOURCE_DB_PORT, 10) || 5432,
        user: process.env.SOURCE_DB_USER,
        password: process.env.SOURCE_DB_PASSWORD,
        database: process.env.SOURCE_DB_NAME,
    },

    // Airbyte API Configuration
    airbyte: {
        apiUrl: process.env.AIRBYTE_API_URL || 'http://localhost:8000/api/v1',

    },

    // Orchestrator settings
    orchestrator: {
        cronSchedule: process.env.ORCHESTRATOR_CRON_SCHEDULE || '0 * * * *',
        defaultUpdatedAtColumn: process.env.DEFAULT_UPDATED_AT_COLUMN || 'updated_at',
        defaultSchemaName: process.env.DEFAULT_SCHEMA_NAME || 'public',
        stateDirectory: path.resolve(__dirname, '../state'),
        lastSyncTimestampsFile: path.resolve(__dirname, '../state/last_sync_timestamps.json'),
        activeJobsFile: path.resolve(__dirname, '../state/active_jobs.json'),
    },

    logLevel: process.env.LOG_LEVEL || 'info',

    monitoredConnectionsAndTables: loadMonitoredTablesConfig(),
};

// Ensure state directory exists
if (!fs.existsSync(config.orchestrator.stateDirectory)) {
    try {
        fs.mkdirSync(config.orchestrator.stateDirectory, { recursive: true });
        console.log(`State directory created at: ${config.orchestrator.stateDirectory}`);
    } catch (error) {
        console.error(`Failed to create state directory at ${config.orchestrator.stateDirectory}:`, error);
        process.exit(1);
    }
}

// Basic validation for critical settings
if (!config.sourceDb.host) { 
    console.error('Critical source database configuration missing. Ensure SOURCE_DB_HOST is set in your .env file.');
}

if (config.monitoredConnectionsAndTables.length === 0) {
    console.warn('No connections or tables configured in monitored_tables_config.json. Orchestrator will not actively monitor or sync anything.');
}

module.exports = config; 