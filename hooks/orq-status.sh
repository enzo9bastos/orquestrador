#!/usr/bin/env bash
# Status publicado pelo próprio agente, lido pelo App de Orquestração.
#   .orq/bin/orq-status "o que estou fazendo" [--estado E] [--progresso N/M]
#   E: trabalhando | travado | revisao | pronto   (padrão: trabalhando)
# Grava <projeto>/.orq/status.json (a pasta do projeto é a mesma no container
# e no host, então o app enxerga na hora). Só escreve nesse arquivo.
set -euo pipefail
texto="${1:-}"; shift || true
estado="trabalhando"; progresso=""
while [ $# -gt 0 ]; do
    case "$1" in
        --estado) estado="$2"; shift 2 ;;
        --progresso) progresso="$2"; shift 2 ;;
        *) shift ;;
    esac
done
case "$estado" in trabalhando|travado|revisao|pronto) ;; *) echo "estado inválido: $estado (trabalhando|travado|revisao|pronto)"; exit 1 ;; esac
[ -z "$progresso" ] || [[ "$progresso" =~ ^[0-9]+/[0-9]+$ ]] || { echo "progresso no formato N/M (ex.: 2/5)"; exit 1; }
raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
mkdir -p "$raiz/.orq"
python3 - "$raiz/.orq/status.json" "$texto" "$estado" "$progresso" <<'PY'
import json, sys, time, os
arq, texto, estado, progresso = sys.argv[1:5]
d = {"texto": texto[:300], "estado": estado, "progresso": progresso or None, "ts": int(time.time() * 1000)}
tmp = arq + ".tmp"
open(tmp, "w").write(json.dumps(d, ensure_ascii=False) + "\n")
os.replace(tmp, arq)
PY
echo "status publicado: $estado${progresso:+ ($progresso)} — $texto"
