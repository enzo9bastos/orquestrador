#!/usr/bin/env bash
# orq-recado — recados e memória do projeto, do lado do agente.
# (arquivo do App de Orquestração: o app instala e atualiza esta cópia)
#
#   .orq/bin/orq-recado enviar "texto" [--tipo pergunta|aviso|pronto|travado]
#        manda um recado ao orquestrador (padrão: aviso). Uma linha curta e
#        direta; o app entrega na conversa do orquestrador.
#   .orq/bin/orq-recado lembrar "título" "texto" [--tipo decisao|falhou|onde|aviso]
#        grava uma nota na memória do projeto (padrão: decisao). Vale para todo
#        agente que trabalhar aqui depois, de qualquer IA.
#   .orq/bin/orq-recado memoria [N]          as N notas mais recentes (padrão 15)
#   .orq/bin/orq-recado buscar "termo"       notas que citam o termo
#   .orq/bin/orq-recado ler <nota>           uma nota inteira
#
# Tudo fica em <projeto>/.orq/ (a pasta do projeto é a mesma no container e no
# host). Recado: .orq/recados/saida/<id>.json, que o app recolhe. Memória:
# .orq/memoria/<data>-<assunto>.md, uma nota por arquivo; nunca apaga nem
# reescreve nota, só acrescenta.
set -euo pipefail
raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cmd="${1:-}"; shift || true

opcao() { # opcao --tipo padrão "$@": devolve o valor e os posicionais em POS
    local nome="$1" padrao="$2"; shift 2
    VAL="$padrao"; POS=()
    while [ $# -gt 0 ]; do
        if [ "$1" = "$nome" ]; then VAL="${2:-}"; shift 2; else POS+=("$1"); shift; fi
    done
}

case "$cmd" in
    enviar)
        opcao --tipo aviso "$@"
        case "$VAL" in pergunta|aviso|pronto|travado) ;; *) echo "tipo inválido: $VAL (pergunta|aviso|pronto|travado)"; exit 1 ;; esac
        texto="${POS[*]:-}"
        [ -n "${texto// /}" ] || { echo 'uso: orq-recado enviar "texto" [--tipo pergunta|aviso|pronto|travado]'; exit 1; }
        mkdir -p "$raiz/.orq/recados/saida"
        python3 - "$raiz/.orq/recados/saida" "$VAL" "$texto" "${CLAUDE_CODE_SESSION_ID:-}" <<'PY'
import json, os, sys, time, secrets
pasta, tipo, texto, sessao = sys.argv[1:5]
ts = int(time.time() * 1000)
rid = f"{ts}-{secrets.token_hex(3)}"
d = {"id": rid, "ts": ts, "tipo": tipo, "texto": texto[:2000], "sessao": sessao or None}
tmp = os.path.join(pasta, f".{rid}.tmp")
open(tmp, "w").write(json.dumps(d, ensure_ascii=False) + "\n")
os.replace(tmp, os.path.join(pasta, f"{rid}.json"))
PY
        echo "recado deixado para o orquestrador ($VAL). O app entrega quando estiver aberto."
        ;;
    lembrar)
        opcao --tipo decisao "$@"
        case "$VAL" in decisao|falhou|onde|aviso) ;; *) echo "tipo inválido: $VAL (decisao|falhou|onde|aviso)"; exit 1 ;; esac
        [ "${#POS[@]}" -ge 2 ] || { echo 'uso: orq-recado lembrar "título" "texto" [--tipo decisao|falhou|onde|aviso]'; exit 1; }
        mkdir -p "$raiz/.orq/memoria"
        python3 - "$raiz/.orq/memoria" "$VAL" "${POS[0]}" "${POS[*]:1}" "${CLAUDE_CODE_SESSION_ID:-}" <<'PY'
import os, re, sys, time, unicodedata
pasta, tipo, titulo, texto, sessao = sys.argv[1:6]
titulo = " ".join(titulo.split())[:120]
base = unicodedata.normalize("NFKD", titulo).encode("ascii", "ignore").decode().lower()
slug = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:50] or "nota"
agora = time.localtime()
nome = time.strftime("%Y-%m-%d-%H%M%S", agora) + "-" + slug
arq = os.path.join(pasta, nome + ".md")
n = 2
while os.path.exists(arq):  # nunca sobrescreve
    arq = os.path.join(pasta, f"{nome}-{n}.md"); n += 1
cab = ["---", f"tipo: {tipo}", f"titulo: {titulo}", f"quando: {time.strftime('%Y-%m-%d %H:%M', agora)}", "autor: agente"]
if sessao: cab.append(f"sessao: {sessao}")
cab.append("---")
fd = os.open(arq, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
with os.fdopen(fd, "w") as f:
    f.write("\n".join(cab) + "\n\n# " + titulo + "\n\n" + texto.strip()[:8000] + "\n")
print("nota gravada:", os.path.basename(arq))
PY
        ;;
    memoria|buscar|ler)
        python3 - "$raiz/.orq/memoria" "$cmd" "${1:-}" <<'PY'
import os, sys
pasta, cmd, arg = sys.argv[1:4]
try:
    nomes = sorted((n for n in os.listdir(pasta) if n.endswith(".md")), reverse=True)
except FileNotFoundError:
    nomes = []
def cabeca(n):
    t = open(os.path.join(pasta, n), encoding="utf-8", errors="replace").read()
    meta = {}
    if t.startswith("---\n"):
        fim = t.find("\n---", 4)
        for l in t[4:fim].splitlines():
            if ":" in l:
                k, v = l.split(":", 1); meta[k.strip()] = v.strip()
    return meta, t
if cmd == "ler":
    alvo = arg if arg.endswith(".md") else arg + ".md"
    if os.path.basename(alvo) != alvo or alvo not in nomes:
        print("nota não encontrada:", arg); sys.exit(1)
    print(cabeca(alvo)[1]); sys.exit(0)
if not nomes:
    print("A memória deste projeto ainda está vazia."); sys.exit(0)
if cmd == "memoria":
    n = int(arg) if arg.isdigit() else 15
    print(f"Memória do projeto: {len(nomes)} nota(s); as {min(n, len(nomes))} mais recentes:")
    for nome in nomes[:n]:
        m, _ = cabeca(nome)
        print(f"- [{m.get('tipo', '?')}] {m.get('titulo', nome)}  ({m.get('quando', '')}; {nome[:-3]})")
    sys.exit(0)
termo = arg.lower().strip()
if not termo:
    print('uso: orq-recado buscar "termo"'); sys.exit(1)
achou = 0
for nome in nomes:
    m, t = cabeca(nome)
    if termo in t.lower():
        achou += 1
        linha = next((l.strip() for l in t.splitlines() if termo in l.lower() and not l.startswith(("titulo:", "# "))), "")
        print(f"- [{m.get('tipo', '?')}] {m.get('titulo', nome)}  ({nome[:-3]})" + (f"\n    {linha[:200]}" if linha else ""))
print(f"{achou} nota(s) com “{arg}”." if achou else f"Nenhuma nota cita “{arg}”.")
PY
        ;;
    *)
        sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
        [ -z "$cmd" ] || exit 1
        ;;
esac
