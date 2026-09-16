#!/usr/bin/env bash
# Run from a release extracted to /srv/banquet/releases/<git SHA>.
set -Eeuo pipefail
umask 077

revision="${1:?Usage: bash scripts/deploy.sh <git-sha>}"
[[ "$revision" =~ ^[0-9a-f]{7,40}$ ]] || { echo "Invalid release revision" >&2; exit 1; }
deployment_root="${BANQUET_ROOT:-/srv/banquet}"
release_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
expected_directory="$deployment_root/releases/$revision"
[[ "$release_directory" == "$expected_directory" ]] || {
  echo "Extract this release to $expected_directory before deploying" >&2
  exit 1
}
shared_env="$deployment_root/.env"
[[ -f "$shared_env" ]] || { echo "Missing server configuration: $shared_env" >&2; exit 1; }
command -v docker >/dev/null
command -v flock >/dev/null
docker compose version >/dev/null
exec 9>"$deployment_root/.deploy.lock"
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }

export BANQUET_IMAGE="banquet:$revision"
export BANQUET_ENV_FILE="$shared_env"
compose_file="$release_directory/compose.yaml"
compose() {
  docker compose --project-name banquet --env-file "$shared_env" --file "$compose_file" "$@"
}
wait_for_health() {
  local container status attempt
  for attempt in $(seq 1 45); do
    container="$(compose ps --all --quiet app)"
    if [[ -n "$container" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
      [[ "$status" == healthy ]] && return 0
      [[ "$status" == unhealthy || "$status" == exited || "$status" == dead ]] && return 1
    fi
    sleep 2
  done
  return 1
}

previous_container="$(compose ps --all --quiet app)"
previous_image=""
if [[ -n "$previous_container" ]]; then
  # Preserve the exact image even when a workflow rebuilds the same Git SHA.
  previous_image="banquet:rollback-$(date -u +%Y%m%d%H%M%S)-${revision:0:12}"
  previous_image_id="$(docker inspect --format '{{.Image}}' "$previous_container")"
  docker image tag "$previous_image_id" "$previous_image"
fi
previous_release="$(readlink "$deployment_root/current" || true)"

echo "Building release $revision"
compose build --pull app
BANQUET_COMPOSE_FILE="$compose_file" BANQUET_BACKUP_ALLOW_MISSING=true \
  bash "$release_directory/scripts/backup.sh"

echo "Starting release $revision"
if compose up -d --no-build app && wait_for_health; then
  ln -sfn "$release_directory" "$deployment_root/current.next"
  mv -Tf "$deployment_root/current.next" "$deployment_root/current"
  printf '%s\n' "$BANQUET_IMAGE" > "$deployment_root/deployed-image"
  echo "Release $revision is healthy: https://mail.lonelycraft.ru/banquet/"
  exit 0
fi

echo "New release failed its health check" >&2
if [[ -n "$previous_image" ]]; then
  echo "Restoring previous image: $previous_image" >&2
  export BANQUET_IMAGE="$previous_image"
  if [[ -n "$previous_release" && -f "$previous_release/compose.yaml" ]]; then
    compose_file="$previous_release/compose.yaml"
  fi
  if compose up -d --no-build app && wait_for_health; then
    printf '%s\n' "$BANQUET_IMAGE" > "$deployment_root/deployed-image"
    echo "Previous image restored; deployment failed" >&2
  else
    echo "Rollback needs attention. Inspect: docker compose -p banquet logs --tail=100 app" >&2
  fi
else
  echo "There is no previous image to restore. Database volume has been retained." >&2
fi
exit 1
