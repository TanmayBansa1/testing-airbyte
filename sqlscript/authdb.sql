CREATE USER airbyte_authdb_user PASSWORD 'your_password_here';
ALTER USER airbyte_authdb_user LOGIN;
GRANT rds_replication to airbyte_authdb_user;
GRANT USAGE ON SCHEMA public TO airbyte_authdb_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO airbyte_authdb_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO airbyte_authdb_user;
SELECT pg_create_logical_replication_slot('airbyte_slot_auth', 'pgoutput');
-- run for all tables
ALTER TABLE identity REPLICA IDENTITY DEFAULT;
ALTER TABLE otp REPLICA IDENTITY DEFAULT;
ALTER TABLE sessions REPLICA IDENTITY DEFAULT;

CREATE PUBLICATION airbyte_authdb_publication FOR TABLE identity,otp,sessions;
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
ALTER PUBLICATION airbyte_authdb_publication ADD TABLE airbyte_heartbeat;

GRANT ALL PRIVILEGES ON TABLE airbyte_heartbeat TO airbyte_authdb_user;
GRANT USAGE ON SEQUENCE airbyte_heartbeat_id_seq TO airbyte_authdb_user;