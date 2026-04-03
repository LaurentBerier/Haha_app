# Pre-Release Conversation Reset Checklist

Use this checklist before the first official public release.

## 1) Cloud reset (manual, explicit)

1. Verify you are connected to **dev/staging**, not production.
2. Open [`docs/sql/pre-release-reset-conversations.sql`](/Users/laurentbernier/Documents/HAHA_app/docs/sql/pre-release-reset-conversations.sql).
3. Temporarily set `confirmation := 'YES'` in the guard block.
4. Execute the script.
5. Revert the file to `confirmation := '__SET_TO_YES__'` if you changed it locally.

## 2) Local reset strategy

1. Confirm app build includes persisted storage key `ha-ha-store-v2`.
2. Publish/deploy the build.
3. Validate that previous local snapshots are not rehydrated (fresh local state expected).

## 3) Smoke verification

1. Open app and authenticate.
2. Start a new primary discussion from `/history` for at least one artist.
3. Confirm the new thread appears in global history under the correct artist section.
4. Confirm cloud sync still recreates `primary_threads` / `primary_thread_messages` as users chat.
