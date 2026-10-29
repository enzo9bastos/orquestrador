#!/usr/bin/env bash
# Commit só se o portão de limpeza passar. Uso:
#   scripts/commit-limpo.sh <arquivo-de-termos> -m "mensagem"
# (Ligar o portão com "| tail && git commit" não barra nada: o pipe devolve o
# resultado do tail. Este script devolve o do portão.)
set -euo pipefail
termos="$1"; shift
git add -A
"$(dirname "$0")/verificar-limpeza.sh" "$termos"
git commit "$@"
