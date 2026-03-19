#!/usr/bin/env bash
# ============================================================
#  cmux.sh — Claude Code + Codex CLI 병렬 실행 (tmux)
#  Usage:  ./scripts/cmux.sh
#  Requires: macOS, Homebrew, tmux, claude-code, codex
# ============================================================
set -euo pipefail

# ── 설정 ──────────────────────────────────────────────────
SESSION="kdt"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_PANE_TITLE="Claude Code"
CODEX_PANE_TITLE="Codex CLI"

# ── 색상 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[cmux]${NC} $*"; }
warn()  { echo -e "${YELLOW}[cmux]${NC} $*"; }
error() { echo -e "${RED}[cmux]${NC} $*" >&2; }

# ── 의존성 체크 & 자동 설치 ──────────────────────────────
check_deps() {
  # Homebrew
  if ! command -v brew &>/dev/null; then
    error "Homebrew가 필요합니다: https://brew.sh"
    exit 1
  fi

  # tmux
  if ! command -v tmux &>/dev/null; then
    info "tmux 설치 중..."
    brew install tmux
  fi

  # Claude Code
  if ! command -v claude &>/dev/null; then
    info "Claude Code 설치 중..."
    npm install -g @anthropic-ai/claude-code
  fi

  # Codex CLI (OpenAI)
  if ! command -v codex &>/dev/null; then
    warn "Codex CLI가 설치되지 않았습니다."
    warn "설치: npm install -g @openai/codex"
    warn "Codex 패널은 빈 셸로 시작합니다."
  fi
}

# ── 기존 세션 처리 ────────────────────────────────────────
handle_existing_session() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    info "기존 세션 '$SESSION' 에 연결합니다..."
    tmux attach-session -t "$SESSION"
    exit 0
  fi
}

# ── tmux 세션 생성 ────────────────────────────────────────
create_session() {
  info "프로젝트: $PROJECT_DIR"
  info "tmux 세션 '$SESSION' 생성 중..."

  # 새 세션 (좌측 패널: Claude Code)
  tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR" -x "$(tput cols)" -y "$(tput lines)"

  # 좌측 패널 설정
  tmux send-keys -t "$SESSION" "echo '── $CLAUDE_PANE_TITLE ──'" C-m
  tmux send-keys -t "$SESSION" "claude" C-m

  # 우측 패널 생성 (Codex CLI)
  tmux split-window -h -t "$SESSION" -c "$PROJECT_DIR"
  tmux send-keys -t "$SESSION" "echo '── $CODEX_PANE_TITLE ──'" C-m

  if command -v codex &>/dev/null; then
    tmux send-keys -t "$SESSION" "codex" C-m
  else
    tmux send-keys -t "$SESSION" "echo 'Codex CLI 미설치. npm i -g @openai/codex 로 설치 후 codex 실행'" C-m
  fi

  # 레이아웃: 50/50 수평 분할
  tmux select-layout -t "$SESSION" even-horizontal

  # 좌측(Claude) 패널에 포커스
  tmux select-pane -t "$SESSION:.0"

  # 상태 바 커스텀
  tmux set-option -t "$SESSION" status-style "bg=#ede9f3,fg=#333333"
  tmux set-option -t "$SESSION" status-left "#[fg=#6c5ce7,bold] KDT 대시보드 "
  tmux set-option -t "$SESSION" status-right "#[fg=#888] %H:%M | Claude + Codex "

  info "완료! 세션에 연결합니다..."
  tmux attach-session -t "$SESSION"
}

# ── 메인 ──────────────────────────────────────────────────
main() {
  echo ""
  info "╔══════════════════════════════════════════╗"
  info "║  cmux — AI 코딩 어시스턴트 병렬 실행     ║"
  info "║  좌측: Claude Code  |  우측: Codex CLI   ║"
  info "╚══════════════════════════════════════════╝"
  echo ""

  check_deps
  handle_existing_session
  create_session
}

main "$@"
