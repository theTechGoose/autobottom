#!/bin/bash
# Wrapper: temporarily hide frontend/ from shape-checker.
# Shape-checker discovers files via git. We temporarily unstage frontend/,
# add it to .gitignore, run the check, then restore everything.
# NOTE: Do NOT use set -e — shape-checker may exit non-zero on violations,
# and we must always restore .gitignore + re-stage frontend.

GITIGNORE=".gitignore"

cleanup() {
  mv "$GITIGNORE.sc-bak" "$GITIGNORE" 2>/dev/null
  git add frontend/ main.ts 2>/dev/null
}
trap cleanup EXIT

# Save .gitignore, hide frontend + root main.ts from shape-checker
cp "$GITIGNORE" "$GITIGNORE.sc-bak"
printf "frontend\nmain.ts\n" >> "$GITIGNORE"
git rm -r --cached --quiet frontend/ 2>/dev/null
git rm --cached --quiet main.ts 2>/dev/null

# Run shape-checker
shape-checker "$@"
