CREATE USER <user_name> PASSWORD 'your_password_here';
ALTER USER <user_name> LOGIN;
GRANT rds_replication to <user_name>;
GRANT USAGE ON SCHEMA public TO <user_name>;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO <user_name>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO <user_name>;
SELECT pg_create_logical_replication_slot('airbyte_slot', 'pgoutput');
-- run for all tables
ALTER TABLE your_table_name REPLICA IDENTITY DEFAULT;

CREATE PUBLICATION airbyte_publication FOR TABLE table1, table2, table3;
-- or CREATE PUBLICATION airbyte_publication FOR ALL TABLES;

-- to verify -- Check WAL level and logical replication status
SELECT name, setting FROM pg_settings WHERE name IN ('wal_level', 'rds.logical_replication');
-- Check active replication slots
SELECT * FROM pg_replication_slots;
-- Check publications
SELECT * FROM pg_publication;

CREATE TABLE airbyte_heartbeat (
	id SERIAL PRIMARY KEY,
	timestamp TIMESTAMP NOT NULL DEFAULT current_timestamp,
	text TEXT
);
-- only if replication is not for all tables
ALTER PUBLICATION <publicationName> ADD TABLE airbyte_heartbeat;

GRANT ALL PRIVILEGES ON TABLE airbyte_heartbeat TO <user_name>;
GRANT USAGE ON SEQUENCE airbyte_heartbeat_id_seq TO <user_name>;