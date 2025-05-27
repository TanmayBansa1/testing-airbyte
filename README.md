# AWS PostgreSQL to BigQuery Synchronization with Airbyte & Node.js

This project orchestrates data synchronization from AWS PostgreSQL to Google BigQuery using Airbyte. A Node.js application manages the synchronization process, triggering Airbyte syncs based on `updated_at` timestamps and schema changes in the source PostgreSQL database. The entire setup is designed to be deployed on an EC2 instance.

## Architecture

```
EC2 Instance
├── Airbyte (installed using abctl)
│   └── API: http://localhost:8000
│   └── UI:  http://localhost:8001
└── Node.js Orchestrator
    └── Monitors PostgreSQL for changes (updated_at, schema)
    └── Triggers Airbyte syncs via API
    └── Stores sync state (last_synced_at, schema_hash) in a PostgreSQL database
```

## Key Components

1.  **Airbyte**: Handles the core ELT process (Extract from PostgreSQL, Load into BigQuery).
    *   Installed and managed using `abctl`.
    *   Connections configured via Airbyte UI or API.
2.  **Node.js Orchestrator**:
    *   Periodically checks the source PostgreSQL database for:
        *   New or updated rows based on an `updated_at` column.
        *   Schema changes (e.g., new columns).
    *   If changes are detected, it triggers the appropriate Airbyte sync connection via the Airbyte API.
    *   Maintains a state of synchronization (e.g., last successfully synced timestamp, schema snapshot) in a separate PostgreSQL database table.
3.  **PostgreSQL (Source)**: The source database on AWS RDS.
4.  **BigQuery (Destination)**: The data warehouse where data will be loaded.
5.  **PostgreSQL (Sync State)**: A database (can be a separate instance or a dedicated schema in an existing instance) to store metadata for the orchestrator, such as `last_synced_at` timestamps and schema hashes for each tracked table.

## Setup and Deployment

1.  **EC2 Instance Setup**:
    *   Provision an EC2 instance.
    *   Install Node.js and npm/yarn.
    *   Install `abctl` for Airbyte management.

2.  **Install Airbyte**:
    ```bash
    curl -LsfS https://get.airbyte.com | bash -
    abctl local install
    ```
    *   This will make Airbyte API available at `http://localhost:8000` and UI at `http://localhost:8001` on the EC2 instance.

3.  **Configure Airbyte Connections**:
    *   Access the Airbyte UI (e.g., via SSH tunneling).
    *   Set up a Source connection for your AWS PostgreSQL database.
    *   Set up a Destination connection for your Google BigQuery project.
    *   Create a Connection to sync data from PostgreSQL to BigQuery.
        *   Configure this connection to use the `updated_at` column as the cursor field for incremental syncs if applicable. Note down the `connectionId`.

4.  **Node.js Orchestrator Setup**:
    *   Clone this repository to the EC2 instance.
    *   Navigate to the `orchestrator` directory.
    *   Install dependencies: `npm install` or `yarn install`.
    *   Configure environment variables: Create a `.env` file (see `.env.example`) with credentials for:
        *   Source PostgreSQL database (for monitoring changes).
        *   Sync State PostgreSQL database (for storing orchestrator metadata).
        *   Airbyte API (e.g., `AIRBYTE_API_URL=http://localhost:8000/api/public/v1`).
        *   The `connectionId` of the Airbyte connection to be triggered.

5.  **Sync State Database Setup**:
    *   Connect to your chosen PostgreSQL instance for storing sync state.
    *   Run the SQL script in `orchestrator/sql/create_sync_state_table.sql` to create the necessary table.

6.  **Run the Orchestrator**:
    *   Use a process manager like `pm2` or `systemd` to run the Node.js application.
    *   Example with `pm2`:
        ```bash
        pm2 start orchestrator/src/index.js --name airbyte-orchestrator
        pm2 startup
        pm2 save
        ```

## Orchestrator Logic

The Node.js orchestrator will perform the following for each configured table:

1.  **Check `updated_at`**:
    *   Query the maximum `updated_at` value from the source table.
    *   Compare it with the `last_synced_at` value stored in the `sync_state` table.
    *   If the source table has newer data, trigger an Airbyte sync for the relevant connection.

2.  **Check Schema Changes**:
    *   Query `information_schema.columns` for the source table in PostgreSQL.
    *   Generate a hash or a structured representation of the current schema (column names, data types).
    *   Compare this with the `column_hash` (or `column_list`) stored in the `sync_state` table.
    *   If the schema has changed:
        *   Call Airbyte's "Refresh Source Schema" API endpoint for the source.
        *   Optionally, trigger a sync.
        *   Update the schema representation in the `sync_state` table.

3.  **Update Sync State**:
    *   After a successful Airbyte sync (or schema refresh), update the `last_synced_at` and `column_hash`/`column_list` in the `sync_state` table.

## Security Considerations

*   Do not expose Airbyte's port 8000 (API) or 8001 (UI) publicly. Access them via SSH tunneling or a reverse proxy with authentication and HTTPS.
*   Use IAM roles with least privilege for EC2, RDS, and BigQuery access.
*   Store all credentials and sensitive information in environment variables, managed securely (e.g., AWS Secrets Manager, HashiCorp Vault, or encrypted `.env` files).
*   Regularly update Airbyte and system packages.

## Future Enhancements

*   More sophisticated error handling and retry mechanisms in the orchestrator.
*   Alerting/notifications for sync failures or schema change detections.
*   Support for multiple Airbyte connections managed by the orchestrator.
*   Dashboard for monitoring sync status. 