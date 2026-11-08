#!/usr/bin/env bash
# Publishes a build into the gh-pages branch, which GitHub Pages serves
# (docs/ci.md "Deploys"). Used by .github/workflows/pages.yml.
#
# Usage: pages-publish.sh <dest> [<build-dir>]
#   dest       ""              the site root — replaces everything except
#                              pr-preview/, so open previews survive
#              pr-preview/pr-N one PR's preview folder
#   build-dir  the built site to copy in; omit it to remove <dest>
#
# Runs from a checkout made by actions/checkout, whose stored credentials
# let it push. Concurrent deploys race on gh-pages, so a rejected push
# retries from a fresh fetch.

set -euo pipefail

dest="$1"
src="${2:-}"
branch=gh-pages
work="$(mktemp -d)"

if [ -n "$src" ]; then
  src="$(cd "$src" && pwd)"
  message="Deploy ${dest:-site root} from ${GITHUB_SHA:-local}"
else
  message="Remove ${dest}"
fi

publish_once() {
  git worktree remove --force "$work" 2>/dev/null || rm -rf "$work"
  git worktree prune

  if git fetch -q --depth=1 origin "$branch" 2>/dev/null; then
    git worktree add -q --detach "$work" FETCH_HEAD
  elif [ -n "$src" ]; then
    # First deploy ever: start gh-pages as an orphan branch.
    git worktree add -q --detach "$work" HEAD
    git -C "$work" checkout -q --orphan "$branch"
    git -C "$work" rm -rfq .
  else
    echo "No $branch branch — nothing to remove."
    return 0
  fi

  if [ -z "$dest" ]; then
    find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name pr-preview -exec rm -rf {} +
    cp -R "$src"/. "$work"/
  else
    rm -rf "${work:?}/$dest"
    if [ -n "$src" ]; then
      mkdir -p "$work/$dest"
      cp -R "$src"/. "$work/$dest"/
    fi
  fi
  # Serve files as they are; skip GitHub's Jekyll pass.
  touch "$work/.nojekyll"

  git -C "$work" add -A
  if git -C "$work" diff --cached --quiet; then
    echo "Nothing changed — nothing to publish."
    return 0
  fi
  git -C "$work" \
    -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -qm "$message"
  git -C "$work" push -q origin "HEAD:refs/heads/$branch"
}

for attempt in 1 2 3 4 5; do
  # A subshell outside an `if`, so `set -e` still stops a failing attempt.
  set +e
  ( set -e; publish_once )
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    git worktree remove --force "$work" 2>/dev/null || true
    exit 0
  fi
  echo "Publish attempt $attempt failed — retrying from a fresh fetch."
  sleep $((attempt * 3))
done

echo "::error title=Pages::Could not publish to $branch after 5 attempts."
exit 1
