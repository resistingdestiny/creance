#!/usr/bin/env bash
# PreToolUse guard for Bash. Reads the hook JSON on stdin; exits 2 to block, with the reason on stderr.
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
fi
[ -z "$cmd" ] && exit 0
deny(){ echo "guard: blocked. $1" >&2; exit 2; }

echo "$cmd" | grep -qiE 'mainnet' && deny "mainnet is out of scope for this project; testnet only."
# Tidying your own ticket branch before review is expected, so --force-with-lease
# onto a t/... branch is allowed. Every other force, and anything aimed at the
# default branch, is not.
if echo "$cmd" | grep -qE '(^|[;&| ])git push'; then
  echo "$cmd" | grep -qE 'git push[^|;&]* (origin )?(main|master)( |$)' && deny "no direct pushes to main; the controller merges pull requests."
  if echo "$cmd" | grep -qE '( --force| -f | \+)'; then
    if echo "$cmd" | grep -q -- '--force-with-lease' && echo "$cmd" | grep -qE ' t/[A-Za-z0-9._-]+'; then
      : # allowed: rewriting your own unmerged ticket branch
    else
      deny "only --force-with-lease onto your own t/... ticket branch is allowed."
    fi
  fi
fi
echo "$cmd" | grep -qE '(^|[;&| ])(printenv|env)([;&| ]|$)' && deny "do not print the environment; secrets live there."
echo "$cmd" | grep -qE '\$\{?(CLAUDE_CODE_OAUTH_TOKEN|GH_TOKEN|[A-Z_]*_KEY|[A-Z_]*SECRET)' && deny "do not echo secrets; read them through process.env in code."
echo "$cmd" | grep -qE 'rm -rf? +(/|~|\$HOME|\.\.)( |$)' && deny "destructive rm."

# Reading or sourcing a .env file (other than .env.example) is blocked; code reads process.env instead.
if echo "$cmd" | grep -qE '(^|[;&|] *)(cat|less|more|head|tail|bat|vim|vi|nano|code|sed|awk|grep|strings|xxd|base64|source|\.) '; then
  for tok in $cmd; do
    tok="${tok%%[;&|)]*}"
    tok="${tok//[\"\']/}"
    case "$tok" in
      .env.example|*/.env.example|.env.example.*) ;;
      .env|*/.env|.env.*|*/.env.*) deny "do not open or source .env directly; use process.env in code and .env.example for documentation." ;;
    esac
  done
fi
exit 0
