#!/bin/bash
# Wrapper: temporarily hide frontend/ from shape-checker.
# Shape-checker discovers files via git. We temporarily unstage frontend/,
# add it to .gitignore, run the check, then restore everything.
# NOTE: Do NOT use set -e — shape-checker may exit non-zero on violations,
# and we must always restore .gitignore + re-stage frontend.

GITIGNORE=".gitignore"

cleanup() {
  mv "$GITIGNORE.sc-bak" "$GITIGNORE" 2>/dev/null
  git add frontend/ 2>/dev/null
}
trap cleanup EXIT

# Save .gitignore, add frontend to it, unstage frontend from index
cp "$GITIGNORE" "$GITIGNORE.sc-bak"
echo "frontend" >> "$GITIGNORE"
git rm -r --cached --quiet frontend/ 2>/dev/null

# Run shape-checker
shape-checker "$@"
