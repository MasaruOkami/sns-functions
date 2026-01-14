#!/usr/bin/env bash
set -euo pipefail

ROOT="supabase/functions"

echo "=== Edge Functions audit ==="
echo "Repo: $(pwd)"
echo "Root: $ROOT"
echo

if [ ! -d "$ROOT" ]; then
  echo "ERROR: $ROOT not found."
  exit 1
fi

for d in "$ROOT"/*; do
  [ -d "$d" ] || continue
  fn=$(basename "$d")
  idx="$d/index.ts"

  # index.ts が無いものはスキップ（_shared/_guard_template など）
  [ -f "$idx" ] || continue

  echo "---- $fn ----"

  # guard import（パス揺れ含めて拾う）
  if rg -n '_shared/guard\.ts' "$idx" >/dev/null 2>&1; then
    echo "guard_import: YES"
  else
    echo "guard_import: NO"
  fi

  # allow roles
  roles=$(rg -n 'const ALLOW_ROLES\s*=\s*\[[^]]*\]' "$idx" -o || true)
  if [ -n "$roles" ]; then
    echo "ALLOW_ROLES: $roles"
  else
    echo "ALLOW_ROLES: (not found)"
  fi

  # x-worker-secret guard
  if rg -n 'x-worker-secret' "$idx" >/dev/null 2>&1; then
    echo "worker_secret: YES"
  else
    echo "worker_secret: NO"
  fi

  # store_id source
  if rg -n 'g\.storeId' "$idx" >/dev/null 2>&1; then
    echo "store_id_source: g.storeId"
  elif rg -n 'body\.store_id' "$idx" >/dev/null 2>&1; then
    echo "store_id_source: body.store_id (⚠︎ risky)"
  else
    echo "store_id_source: (unknown)"
  fi

  echo
done
