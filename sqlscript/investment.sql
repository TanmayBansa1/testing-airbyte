CREATE USER airbyte_investment_user PASSWORD 'your_password_here';
ALTER USER airbyte_investment_user LOGIN;
GRANT rds_replication to airbyte_investment_user;
GRANT USAGE ON SCHEMA public TO airbyte_investment_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO airbyte_investment_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO airbyte_investment_user;
SELECT pg_create_logical_replication_slot('airbyte_slot_investment', 'pgoutput');
-- run for all tables
ALTER TABLE esign REPLICA IDENTITY DEFAULT;
ALTER TABLE folio REPLICA IDENTITY DEFAULT;
ALTER TABLE investment_account REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_address_mapping REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_bank_account_mapping REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_email_mapping REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_phone_mapping REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_nominee_mapping REPLICA IDENTITY DEFAULT;
ALTER TABLE investor_profiles REPLICA IDENTITY DEFAULT;
ALTER TABLE kyc REPLICA IDENTITY DEFAULT;
ALTER TABLE madates REPLICA IDENTITY DEFAULT;
ALTER TABLE partner_files REPLICA IDENTITY DEFAULT;
ALTER TABLE payments REPLICA IDENTITY DEFAULT;
ALTER TABLE schedules REPLICA IDENTITY DEFAULT;
ALTER TABLE transactions REPLICA IDENTITY DEFAULT;
ALTER TABLE webhook_logs REPLICA IDENTITY DEFAULT;

CREATE PUBLICATION airbyte_investment_publication FOR TABLE esign,folio,investment_account,investor_address_mapping,investor_bank_account_mapping,investor_email_mapping,investor_phone_mapping,investor_nominee_mapping,investor_profiles,kyc,madates,partner_files,payments,schedules,transactions,webhooks_logs;
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
ALTER PUBLICATION airbyte_investment_publication ADD TABLE airbyte_heartbeat;

GRANT ALL PRIVILEGES ON TABLE airbyte_heartbeat TO airbyte_investment_user;
GRANT USAGE ON SEQUENCE airbyte_heartbeat_id_seq TO airbyte_investment_user;