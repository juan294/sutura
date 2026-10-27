set -euo pipefail
for name in ${!GIT_@}; do unset "$name"; done
git_read() { git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false "$@"; }
printf 'full=true\n' >> "$GITHUB_OUTPUT"
base=""
case "$GITHUB_EVENT_NAME" in
push) base=$(jq -r '.before' "$GITHUB_EVENT_PATH") ;;
pull_request)
head=$(jq -r '.pull_request.head.sha' "$GITHUB_EVENT_PATH")
test "$(git_read rev-parse HEAD^2)" = "$head" || { echo 'Sutura: PR head/merge parent mismatch' >&2; exit 1; }
base=$(git_read rev-parse HEAD^1)
;;
*) base=$(git_read rev-parse HEAD) ;;
esac
[[ "$base" =~ ^[0-9a-f]{40}$ && "$base" != 0000000000000000000000000000000000000000 ]] || { echo 'Sutura: protected base unavailable; full verification remains required. Bring this run to Sutura.' >&2; exit 1; }
protected=$(mktemp -d)
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "full=true\n" >> "$GITHUB_OUTPUT"; fi; rm -rf "$protected"; exit "$status"' EXIT
if git_read cat-file -e "$base:scripts/ci-routing-v2.mjs" 2>/dev/null; then
git_read show "$base:scripts/ci-routing-v2.mjs" > "$protected/ci-routing-v2.mjs"
node "$protected/ci-routing-v2.mjs" --base "$base"
else
printf 'reason=installation-missing\n' >> "$GITHUB_OUTPUT"
echo 'Sutura protected routing v2 is not installed yet. Running full verification automatically; no mode change is needed.'
fi
