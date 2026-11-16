#!/usr/bin/env bash

set -Eeuo pipefail

build_pid=""
watcher_pid=""

stop_build() {
  if [[ -z "${build_pid}" ]] || ! kill -0 "${build_pid}" 2>/dev/null; then
    return
  fi

  kill -TERM "${build_pid}" 2>/dev/null || true

  for _ in {1..10}; do
    kill -0 "${build_pid}" 2>/dev/null || return
    sleep 1
  done

  echo "Docker build did not stop gracefully; killing it."
  kill -KILL "${build_pid}" 2>/dev/null || true
}

cancel_build() {
  trap - TERM INT
  echo "Cancel requested; stopping Docker build (PID ${build_pid})..."
  stop_build
  exit 130
}

trap cancel_build TERM INT

DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  --build-arg "NODE_OPTIONS=${NODE_OPTIONS:-}" \
  --build-arg "AWS_REGION=${AWS_REGION:-}" \
  --build-arg "AWS_S3_BUCKET=${AWS_S3_BUCKET:-}" \
  --build-arg "NEXT_PUBLIC_S3_PUBLIC_URL=${NEXT_PUBLIC_S3_PUBLIC_URL:-}" \
  --tag "${APP_IMAGE}" \
  . &
build_pid=$!

# GitLab can leave the current command running while the job is "canceling".
# Detect a newer commit ourselves so the runner slot is released promptly.
(
  while kill -0 "${build_pid}" 2>/dev/null; do
    sleep 5
    latest_sha="$(git ls-remote origin "refs/heads/${CI_COMMIT_REF_NAME}" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"

    if [[ -n "${latest_sha}" && "${latest_sha}" != "${CI_COMMIT_SHA}" ]]; then
      echo "Newer commit ${latest_sha} detected; stopping obsolete build ${CI_COMMIT_SHA}."
      stop_build
      exit 0
    fi
  done
) &
watcher_pid=$!

set +e
wait "${build_pid}"
build_status=$?
set -e
build_pid=""

kill "${watcher_pid}" 2>/dev/null || true
wait "${watcher_pid}" 2>/dev/null || true

exit "${build_status}"
