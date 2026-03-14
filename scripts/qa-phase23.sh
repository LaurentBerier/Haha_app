#!/usr/bin/env bash
set -u

pass_count=0
fail_count=0

run_step() {
  local label="$1"
  shift

  echo
  echo "==> $label"
  if "$@"; then
    echo "PASS: $label"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: $label"
    fail_count=$((fail_count + 1))
  fi
}

echo "Running Phase 2/3 QA suite"
echo "Workspace: $(pwd)"

auth_hint="no"
if [[ -n "${SMOKE_AUTH_TOKEN:-}" || ( -n "${SMOKE_AUTH_EMAIL:-}" && -n "${SMOKE_AUTH_PASSWORD:-}" ) ]]; then
  auth_hint="yes"
fi

echo "Voice authenticated probe configured: $auth_hint"

run_step "typecheck" npm run typecheck
run_step "lint" npm run lint
run_step "unit tests" npm run test:unit
run_step "smoke auth" npm run smoke:auth
run_step "smoke voice" npm run smoke:voice

echo

echo "Summary: PASS=$pass_count FAIL=$fail_count"

if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi
