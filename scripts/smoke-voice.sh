#!/usr/bin/env bash
set -u

if [[ -f ".env" ]]; then
  # shellcheck disable=SC1091
  source .env
fi

API_BASE="${EXPO_PUBLIC_API_BASE_URL:-}"
if [[ -z "${API_BASE}" ]]; then
  CLAUDE_URL="${EXPO_PUBLIC_CLAUDE_PROXY_URL:-}"
  if [[ -n "${CLAUDE_URL}" ]]; then
    API_BASE="${CLAUDE_URL%/claude}"
  fi
fi

if [[ -z "${API_BASE}" ]]; then
  echo "FAIL: set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL."
  exit 1
fi

ORIGIN="${SMOKE_ORIGIN:-http://localhost:8081}"
AUTH_TOKEN="${SMOKE_AUTH_TOKEN:-}"
SMOKE_AUTH_EMAIL="${SMOKE_AUTH_EMAIL:-}"
SMOKE_AUTH_PASSWORD="${SMOKE_AUTH_PASSWORD:-}"
SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}"

pass_count=0
fail_count=0

run_case() {
  local name="$1"
  local url="$2"
  local expected_csv="$3"
  local method="${4:-POST}"
  local body="${5:-}"
  shift 5 || true
  local extra_headers=("$@")

  local tmp_file
  tmp_file="$(mktemp)"

  local curl_args=(
    -sS
    -o "$tmp_file"
    -w "%{http_code}"
    -X "$method"
    "$url"
  )

  for header in "${extra_headers[@]}"; do
    if [[ -n "$header" ]]; then
      curl_args+=(-H "$header")
    fi
  done

  if [[ -n "$body" ]]; then
    curl_args+=(--data "$body")
  fi

  local status
  status="$(curl "${curl_args[@]}" 2>/dev/null || echo "000")"

  local ok="no"
  IFS=',' read -r -a expected_arr <<< "$expected_csv"
  for expected in "${expected_arr[@]}"; do
    if [[ "$status" == "$expected" ]]; then
      ok="yes"
      break
    fi
  done

  if [[ "$ok" == "yes" ]]; then
    echo "PASS: $name -> $status (expected: $expected_csv)"
    pass_count=$((pass_count + 1))
  else
    local body_preview
    body_preview="$(head -c 180 "$tmp_file" | LC_ALL=C tr '\n' ' ')"
    echo "FAIL: $name -> $status (expected: $expected_csv)"
    echo "  body: ${body_preview}"
    fail_count=$((fail_count + 1))
  fi

  rm -f "$tmp_file"
}

resolve_supabase_token() {
  if [[ -n "$AUTH_TOKEN" ]]; then
    return
  fi

  if [[ -z "$SMOKE_AUTH_EMAIL" || -z "$SMOKE_AUTH_PASSWORD" ]]; then
    return
  fi

  if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
    echo "INFO: SMOKE_AUTH_EMAIL/SMOKE_AUTH_PASSWORD set but Supabase env is missing; skipping token login."
    return
  fi

  local login_url
  login_url="${SUPABASE_URL%/}/auth/v1/token?grant_type=password"
  local login_payload
  login_payload="$(
    node -e "process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2] }));" \
      "$SMOKE_AUTH_EMAIL" "$SMOKE_AUTH_PASSWORD" 2>/dev/null
  )"
  if [[ -z "$login_payload" ]]; then
    echo "INFO: Failed to build Supabase login payload for smoke token."
    return
  fi
  local tmp_file
  tmp_file="$(mktemp)"

  local login_status
  login_status="$(
    curl -sS \
      -o "$tmp_file" \
      -w "%{http_code}" \
      -X POST \
      "$login_url" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      --data "$login_payload" \
      2>/dev/null || echo "000"
  )"

  if [[ "$login_status" != "200" ]]; then
    echo "INFO: Supabase login for smoke token failed with status $login_status."
    rm -f "$tmp_file"
    return
  fi

  local parsed_token
  parsed_token="$(
    node -e "const fs=require('fs');const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(typeof j.access_token==='string'?j.access_token:'');" "$tmp_file" 2>/dev/null
  )"
  rm -f "$tmp_file"

  if [[ -n "$parsed_token" ]]; then
    AUTH_TOKEN="$parsed_token"
    echo "INFO: Auth token resolved from Supabase password login for smoke test."
  else
    echo "INFO: Supabase login response did not include access_token."
  fi
}

echo "Running voice/API smoke tests against: $API_BASE"
echo "Using Origin: $ORIGIN"
echo

resolve_supabase_token

run_case \
  "tts preflight" \
  "$API_BASE/tts" \
  "204" \
  "OPTIONS" \
  "" \
  "Origin: $ORIGIN" \
  "Access-Control-Request-Method: POST" \
  "Access-Control-Request-Headers: authorization,content-type"

run_case \
  "tts no auth" \
  "$API_BASE/tts" \
  "401" \
  "POST" \
  '{"text":"bonjour","artistId":"cathy-gauthier","language":"fr-CA"}' \
  "Origin: $ORIGIN" \
  "Content-Type: application/json"

if [[ -n "$AUTH_TOKEN" ]]; then
  run_case \
    "tts with auth" \
    "$API_BASE/tts" \
    "200,403,429" \
    "POST" \
    '{"text":"test voix smoke","artistId":"cathy-gauthier","language":"fr-CA"}' \
    "Origin: $ORIGIN" \
    "Authorization: Bearer $AUTH_TOKEN" \
    "Content-Type: application/json"
else
  echo "INFO: SMOKE_AUTH_TOKEN not set, skipping authenticated tts case."
fi

echo
echo "Summary: PASS=$pass_count FAIL=$fail_count"

if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi
