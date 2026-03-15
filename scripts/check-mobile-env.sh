#!/usr/bin/env bash
set -u

pass=0
fail=0
warn=0

check_cmd() {
  local label="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "PASS: $label ($cmd found)"
    pass=$((pass + 1))
  else
    echo "FAIL: $label ($cmd missing)"
    fail=$((fail + 1))
  fi
}

check_optional() {
  local label="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "PASS: $label ($cmd found)"
    pass=$((pass + 1))
  else
    echo "WARN: $label ($cmd missing)"
    warn=$((warn + 1))
  fi
}

check_java_runtime() {
  if ! command -v java >/dev/null 2>&1; then
    echo "WARN: Java runtime (java missing)"
    warn=$((warn + 1))
    return
  fi

  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    if /usr/libexec/java_home >/dev/null 2>&1; then
      echo "PASS: Java runtime (JAVA_HOME resolvable)"
      pass=$((pass + 1))
      return
    fi
  fi

  if java -version >/dev/null 2>&1; then
    echo "PASS: Java runtime (java -version OK)"
    pass=$((pass + 1))
    return
  fi

  echo "WARN: Java runtime not usable by Gradle (set JAVA_HOME / install JDK)"
  warn=$((warn + 1))
}

echo "Mobile environment preflight"
echo

check_cmd "Node.js" node
check_cmd "npm" npm
check_java_runtime
check_optional "adb (Android device bridge)" adb
check_optional "emulator (Android AVD)" emulator
check_optional "xcodebuild (iOS build)" xcodebuild
check_optional "applesimutils (Detox iOS helper)" applesimutils

echo
if [[ "$fail" -gt 0 ]]; then
  echo "Summary: PASS=$pass WARN=$warn FAIL=$fail"
  exit 1
fi

echo "Summary: PASS=$pass WARN=$warn FAIL=$fail"
