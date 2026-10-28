#!/usr/bin/env bash
# One-command local startup for AML Guardian.
#
#   ./start.sh              set up missing dependencies, start API + web, open the browser
#   ./start.sh --demo       also enable the in-UI synthetic test-data seed/reset controls
#   ./start.sh --ollama     narrate with the local Ollama model instead of the stub
#   ./start.sh --no-open    do not open the browser automatically
#
# Prerequisites: Python 3.11+ (3.12 recommended) and Node.js 24+.
# The script creates .venv and installs Python/web dependencies only when missing.
# Stop with Ctrl+C; both services shut down together.
set -euo pipefail
cd "$(dirname "$0")"

API_HOST=127.0.0.1
API_PORT=8000
WEB_HOST=127.0.0.1
WEB_PORT=3000
API_URL="http://$API_HOST:$API_PORT"
WEB_URL="http://$WEB_HOST:$WEB_PORT"

DEMO=0
OLLAMA=0
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --demo) DEMO=1 ;;
    --ollama) OLLAMA=1 ;;
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mNote:\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Python -----------------------------------------------------------------
PY=""
if [ -x .venv/bin/python ] && .venv/bin/python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null; then
  PY=.venv/bin/python
else
  for candidate in python3.12 python3.11 python3 \
      /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 \
      /usr/local/bin/python3.12 /usr/local/bin/python3.11 \
      "$HOME"/.pyenv/versions/3.12*/bin/python3 "$HOME"/.pyenv/versions/3.11*/bin/python3 \
      "$HOME"/.local/share/uv/python/cpython-3.12*/bin/python3 "$HOME"/.local/share/uv/python/cpython-3.11*/bin/python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null; then
      PY="$candidate"
      break
    fi
  done
  [ -n "$PY" ] || fail "Python 3.11+ not found. Install it (for example: brew install python@3.12, or uv python install 3.12), then rerun ./start.sh"
  info "Creating virtual environment in .venv ..."
  "$PY" -m venv .venv
  PY=.venv/bin/python
fi

if ! "$PY" -c "import aml_guardian, fastapi, uvicorn" 2>/dev/null; then
  info "Installing Python dependencies (one time) ..."
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -e ".[web,dev]"
fi
info "Python ready: $("$PY" --version 2>&1) (.venv)"

# --- Node.js ----------------------------------------------------------------
NODE_BIN=""
for dir in "" /tmp/aml-guardian-node-runtime/*/bin /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
  candidate="${dir:+$dir/}node"
  if [ -x "$(command -v "$candidate" 2>/dev/null || echo "$candidate")" ] || command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" 2>/dev/null; then
      NODE_BIN="$candidate"
      break
    fi
  fi
done
[ -n "$NODE_BIN" ] || fail "Node.js 24+ not found. Install it (for example: brew install node), then rerun ./start.sh"
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH

if [ ! -d web/node_modules/next ]; then
  info "Installing web dependencies (one time) ..."
  (cd web && npm ci --no-audit --no-fund)
fi
info "Node.js ready: $("$NODE_BIN" --version)"

# --- Start services -----------------------------------------------------------
LOG_DIR="$(mktemp -d /tmp/aml-guardian-start.XXXXXX)"
API_PID=""
WEB_PID=""

cleanup() {
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

api_ready() { curl -sf "$API_URL/api/v1/runtime" >/dev/null 2>&1; }
web_ready() { curl -sf -o /dev/null "$WEB_URL" 2>/dev/null; }

if api_ready; then
  warn "API already running at $API_URL — reusing it (its startup flags still apply)."
else
  API_ENV=()
  [ "$DEMO" = 1 ] && API_ENV+=(AML_ENABLE_TEST_DATA_CONTROLS=1)
  [ "$OLLAMA" = 1 ] && API_ENV+=(AML_LLM_PROVIDER=ollama)
  info "Starting API at $API_URL ..."
  if [ "${#API_ENV[@]}" -gt 0 ]; then
    env "${API_ENV[@]}" "$PY" -m uvicorn aml_guardian.api:app --host "$API_HOST" --port "$API_PORT" >"$LOG_DIR/api.log" 2>&1 &
  else
    "$PY" -m uvicorn aml_guardian.api:app --host "$API_HOST" --port "$API_PORT" >"$LOG_DIR/api.log" 2>&1 &
  fi
  API_PID=$!
  for _ in $(seq 1 30); do
    api_ready && break
    kill -0 "$API_PID" 2>/dev/null || { tail -20 "$LOG_DIR/api.log" >&2; fail "API exited during startup. Log: $LOG_DIR/api.log"; }
    sleep 1
  done
  api_ready || { tail -20 "$LOG_DIR/api.log" >&2; fail "API did not become ready in 30s. Log: $LOG_DIR/api.log"; }
fi

if web_ready; then
  warn "Web already running at $WEB_URL — reusing it."
else
  info "Starting web workbench at $WEB_URL (first compile can take a minute) ..."
  (cd web && npm run dev -- --port "$WEB_PORT") >"$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!
  for _ in $(seq 1 90); do
    web_ready && break
    kill -0 "$WEB_PID" 2>/dev/null || { tail -20 "$LOG_DIR/web.log" >&2; fail "Web exited during startup. Log: $LOG_DIR/web.log"; }
    sleep 1
  done
  web_ready || { tail -20 "$LOG_DIR/web.log" >&2; fail "Web did not become ready in 90s. Log: $LOG_DIR/web.log"; }
fi

echo
info "AML Guardian is running:"
echo "    Workbench:  $WEB_URL"
echo "    Usage guide: $WEB_URL/usage-guide.html"
echo "    API:        $API_URL (docs at $API_URL/docs)"
[ "$DEMO" = 1 ] && echo "    Demo mode:  test-data seed/reset controls enabled"
[ "$OLLAMA" = 1 ] && echo "    Narration:  local Ollama model (AML_LLM_PROVIDER=ollama)"
echo

if [ "$OPEN_BROWSER" = 1 ]; then
  if command -v open >/dev/null 2>&1; then open "$WEB_URL";
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$WEB_URL";
  fi
fi

if [ -z "$API_PID" ] && [ -z "$WEB_PID" ]; then
  info "Both services were already running; nothing to supervise. Stop them with Ctrl+C in their own terminals."
  exit 0
fi

info "Press Ctrl+C to stop both services."
wait ${API_PID:+$API_PID} ${WEB_PID:+$WEB_PID} 2>/dev/null || true
