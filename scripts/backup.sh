#!/usr/bin/env bash
# Produces a consistent SQLite snapshot inside the existing data volume.
set -Eeuo pipefail
umask 077

deployment_root="${BANQUET_ROOT:-/srv/banquet}"
shared_env="${BANQUET_ENV_FILE:-$deployment_root/.env}"
compose_file="${BANQUET_COMPOSE_FILE:-$deployment_root/current/compose.yaml}"
export BANQUET_ENV_FILE="$shared_env"
if [[ -z "${BANQUET_IMAGE:-}" && -f "$deployment_root/deployed-image" ]]; then
  IFS= read -r BANQUET_IMAGE < "$deployment_root/deployed-image"
  export BANQUET_IMAGE
fi
[[ -f "$shared_env" ]] || { echo "Missing server configuration: $shared_env" >&2; exit 1; }
[[ -f "$compose_file" ]] || { echo "Missing Compose file: $compose_file" >&2; exit 1; }

compose=(docker compose --project-name banquet --env-file "$shared_env" --file "$compose_file")
allow_missing="${BANQUET_BACKUP_ALLOW_MISSING:-false}"
if [[ -n "$("${compose[@]}" ps --quiet app)" ]]; then
  backup_command=(exec -T -e "BANQUET_BACKUP_ALLOW_MISSING=$allow_missing" app node --input-type=module)
else
  # Also preserve an existing database when the previous application is stopped.
  backup_command=(run --rm --no-deps -T -e "BANQUET_BACKUP_ALLOW_MISSING=$allow_missing" --entrypoint node app --input-type=module)
fi
"${compose[@]}" "${backup_command[@]}" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const databasePath = process.env.DATABASE_PATH || '/data/banquet.sqlite';
if (!existsSync(databasePath)) {
  if (process.env.BANQUET_BACKUP_ALLOW_MISSING === 'true') {
    console.log('First deployment: no existing database to back up');
    process.exit(0);
  }
  throw new Error('Database does not exist; refusing to create an empty backup');
}
const directory = join(dirname(databasePath), 'backups');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const destination = join(directory, `banquet-${stamp}.sqlite`);
const database = new DatabaseSync(databasePath);
try {
  database.exec('PRAGMA busy_timeout = 30000');
  database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  database.close();
}
chmodSync(destination, 0o600);
const snapshot = new DatabaseSync(destination, { readOnly: true });
try {
  if (snapshot.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
    throw new Error(`Backup integrity check failed: ${destination}`);
  }
} finally {
  snapshot.close();
}
const backups = readdirSync(directory)
  .filter(name => /^banquet-[0-9T-Z-]+\.sqlite$/.test(name))
  .sort();
for (const old of backups.slice(0, -10)) unlinkSync(join(directory, old));
console.log(`SQLite backup verified: ${destination} (${statSync(destination).size} bytes); keeping the latest 10 snapshots`);
NODE
