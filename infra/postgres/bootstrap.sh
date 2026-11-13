#!/usr/bin/env bash
# Creates the Mtjari database and its two roles. Idempotent.
#   mtjari_owner : owns the schema, runs migrations. Never used by the API.
#   mtjari_app   : the API's runtime role. NOSUPERUSER NOBYPASSRLS, so
#                  Row-Level Security policies always apply to it.
# Usage (as a Postgres superuser):
#   OWNER_PASSWORD=... APP_PASSWORD=... DB_NAME=mtjari ./bootstrap.sh
set -euo pipefail
: "${OWNER_PASSWORD:?OWNER_PASSWORD required}"
: "${APP_PASSWORD:?APP_PASSWORD required}"
DB_NAME="${DB_NAME:-mtjari}"
PSQL=(psql -v ON_ERROR_STOP=1 ${PGHOST:+-h "$PGHOST"} ${PGUSER:+-U "$PGUSER"} -d "${PGDATABASE:-postgres}")

"${PSQL[@]}" -v owner_pw="$OWNER_PASSWORD" -v app_pw="$APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE mtjari_owner LOGIN CREATEDB PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mtjari_owner') \gexec
SELECT format('CREATE ROLE mtjari_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mtjari_app') \gexec
SQL

for db in "$DB_NAME" "${DB_NAME}_shadow"; do
  "${PSQL[@]}" -tc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 \
    || "${PSQL[@]}" -c "CREATE DATABASE \"$db\" OWNER mtjari_owner"
done

"${PSQL[@]}" -d "$DB_NAME" <<SQL
REVOKE ALL ON DATABASE "$DB_NAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$DB_NAME" TO mtjari_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mtjari_app;
SQL
echo "bootstrap complete for $DB_NAME"
