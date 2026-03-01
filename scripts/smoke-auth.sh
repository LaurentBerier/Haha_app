#!/usr/bin/env bash
set -u

if [[ -f ".env" ]]; then
  # shellcheck disable=SC1091
  source .env
fi

CLAUDE_URL="${EXPO_PUBLIC_CLAUDE_PROXY_URL:-}"
if [[ -z "${CLAUDE_URL}" ]]; then
  echo "FAIL: EXPO_PUBLIC_CLAUDE_PROXY_URL is not set."
  exit 1
fi

BASE_URL="${CLAUDE_URL%/claude}"

pass_count=0
fail_count=0

run_case() {
  local name="$1"
  local url="$2"
  local expected_csv="$3"
  local method="${4:-POST}"
  local body="${5:-{}}"
  local auth="${6:-}"

  local tmp_file
  tmp_file="$(mktemp)"

  local curl_args=(
    -sS
    -o "$tmp_file"
    -w "%{http_code}"
    -X "$method"
    "$url"
    -H "Content-Type: application/json"
    --data "$body"
  )

  if [[ -n "$auth" ]]; then
    curl_args+=(-H "Authorization: Bearer $auth")
  fi

  local status
  status="$(curl "${curl_args[@]}" 2>/dev/null || echo "000")"
  local body_preview
  body_preview="$(head -c 180 "$tmp_file" | tr '\n' ' ')"
  rm -f "$tmp_file"

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
    echo "FAIL: $name -> $status (expected: $expected_csv)"
    echo "  body: ${body_preview}"
    fail_count=$((fail_count + 1))
  fi
}

echo "Running auth/API smoke tests against: $BASE_URL"
echo

run_case \
  "claude no auth" \
  "$BASE_URL/claude" \
  "401" \
  "POST" \
  '{"systemPrompt":"test","messages":[{"role":"user","content":"hi"}]}'

run_case \
  "admin-account-type no auth" \
  "$BASE_URL/admin-account-type" \
  "401" \
  "POST" \
  '{"userId":"00000000-0000-0000-0000-000000000000","accountTypeId":"free"}'

run_case \
  "delete-account no auth" \
  "$BASE_URL/delete-account" \
  "401" \
  "POST" \
  '{}'

run_case \
  "payment-webhook no auth" \
  "$BASE_URL/payment-webhook" \
  "401" \
  "POST" \
  '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"00000000-0000-0000-0000-000000000000","product_id":"haha_regular_monthly"}}'

echo
echo "Summary: PASS=$pass_count FAIL=$fail_count"

if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi

