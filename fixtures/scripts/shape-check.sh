#!/bin/bash
# Wrapper: temporarily hide frontend/ from shape-checker.
# Shape-checker discovers files via git. We temporarily unstage frontend/,
# add it to .gitignore, run the check, then restore everything.
# NOTE: Do NOT use set -e — shape-checker may exit non-zero on violations,
# and we must always restore .gitignore + re-stage frontend.

GITIGNORE=".gitignore"

cleanup() {
  mv "$GITIGNORE.sc-bak" "$GITIGNORE" 2>/dev/null
  # Restore tracking WITHOUT -f so the restored .gitignore (which ignores
  # _fresh/ and frontend/_fresh/) is respected. Using -f would force-re-add
  # build artifacts that were deliberately untracked in commit fd8c1df.
  git add frontend/ main.ts tests/e2e/ tools/ 2>/dev/null
}
trap cleanup EXIT

# Save .gitignore, hide frontend + root-level files + E2E tests from shape-checker
cp "$GITIGNORE" "$GITIGNORE.sc-bak"
printf "frontend\nmain.ts\nbuild.ts\n_fresh\ntests\ntools\n" >> "$GITIGNORE"
git rm -rf --cached --quiet frontend/ 2>/dev/null
git rm -f --cached --quiet main.ts 2>/dev/null
git rm -rf --cached --quiet tests/e2e/ 2>/dev/null
git rm -rf --cached --quiet tools/ 2>/dev/null

# Run shape-checker
shape-checker "$@"
