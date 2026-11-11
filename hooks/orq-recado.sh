#!/usr/bin/env bash
# orq-recado — recados e memória do projeto, do lado do agente.
# (arquivo do App de Orquestração: o app instala e atualiza esta cópia)
#
#   .orq/bin/orq-recado enviar "texto" [--tipo pergunta|aviso|pronto|travado] [--para <agente|projeto>]
#        manda um recado ao orquestrador (padrão: aviso) ou, com --para, a
#        outro agente do app. Uma linha curta e direta; o app entrega.
#   .orq/bin/orq-recado agentes              quem está aberto no app agora
#   .orq/bin/orq-recado passar "onde parei" [--falta "…"] [--falhou "…"] [--para <agente|projeto>]
#        passa a vez: outro agente (ou o que você indicar) continua daqui
#   .orq/bin/orq-recado vezes                vezes passadas que você pode pegar
#   .orq/bin/orq-recado pegar <id>           pega a vez (só um agente consegue)
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

opcao() { # opcao --tipo padrão "$@": devolve o valor em VAL, --para em PARA,
           # --falta/--falhou em FALTA/FALHOU e os posicionais em POS
    local nome="$1" padrao="$2"; shift 2
    VAL="$padrao"; PARA=""; FALTA=""; FALHOU=""; POS=()
    while [ $# -gt 0 ]; do
        case "$1" in
            "$nome") VAL="${2:-}"; shift 2 ;;
            --para) PARA="${2:-}"; shift 2 ;;
            --falta) FALTA="${2:-}"; shift 2 ;;
            --falhou) FALHOU="${2:-}"; shift 2 ;;
            *) POS+=("$1"); shift ;;
        esac
    done
}

# Deixa um pedido para o app em .orq/recados/saida/ (JSON dos pares chave valor).
deixar() {
    mkdir -p "$raiz/.orq/recados/saida"
    python3 - "$raiz/.orq/recados/saida" "${CLAUDE_CODE_SESSION_ID:-}" "$@" <<'PY'
import json, os, sys, time, secrets
pasta, sessao, *kv = sys.argv[1:]
ts = int(time.time() * 1000)
rid = os.environ.get("ORQ_REQ") or f"{ts}-{secrets.token_hex(3)}"
d = {"id": rid, "ts": ts, "sessao": sessao or None}
for k, v in zip(kv[::2], kv[1::2]):
    d[k] = v[:4000]
tmp = os.path.join(pasta, f".{rid}.tmp")
open(tmp, "w").write(json.dumps(d, ensure_ascii=False) + "\n")
os.replace(tmp, os.path.join(pasta, f"{rid}.json"))
PY
}

case "$cmd" in
    enviar)
        opcao --tipo aviso "$@"
        case "$VAL" in pergunta|aviso|pronto|travado) ;; *) echo "tipo inválido: $VAL (pergunta|aviso|pronto|travado)"; exit 1 ;; esac
        texto="${POS[*]:-}"
        [ -n "${texto// /}" ] || { echo 'uso: orq-recado enviar "texto" [--tipo pergunta|aviso|pronto|travado] [--para <agente|projeto>]'; exit 1; }
        if [ -n "$PARA" ]; then
            deixar acao recado tipo "$VAL" texto "$texto" para "$PARA"
            echo "recado deixado para $PARA ($VAL). O app entrega no terminal dele; se não achar o agente, o recado aparece recusado na aba Recados."
        else
            deixar acao recado tipo "$VAL" texto "$texto"
            echo "recado deixado para o orquestrador ($VAL). O app entrega quando estiver aberto."
        fi
        ;;
    agentes|vezes)
        python3 - "$raiz/.orq/recados" "$cmd" <<'PY'
import json, os, sys, time
base, cmd = sys.argv[1:3]
arq = os.path.join(base, "agentes.json" if cmd == "agentes" else "vezes.json")
try:
    idade = time.time() - os.stat(arq).st_mtime
    dados = json.load(open(arq, encoding="utf-8"))
except (FileNotFoundError, ValueError):
    print("O app ainda não deixou a lista aqui (está aberto?)."); sys.exit(0)
if cmd == "agentes":
    print("Agentes abertos no app" + (" (lista de mais de 1 min atrás)" if idade > 60 else "") + ":")
    for a in dados:
        print(f"- {a['nome']} ({a['projeto']})" + (" ← você" if a.get("voce") else "") + (f" · {a['estado']}" if a.get("estado") else "") + (f" · {a['tarefa']}" if a.get("tarefa") else ""))
    print('Para falar com um deles: .orq/bin/orq-recado enviar "texto" --para "<nome ou projeto>"')
else:
    if not dados:
        print("Nenhuma vez aberta para você."); sys.exit(0)
    for v in dados:
        print(f"- {v['id']}  de {v['de']} ({v['projeto']})" + (f", para {v['para']}" if v.get("para") else "") + f"\n    {v['texto'][:300]}")
    print("Para pegar: .orq/bin/orq-recado pegar <id> (só um agente consegue).")
PY
        ;;
    passar)
        opcao --tipo x "$@"
        texto="${POS[*]:-}"
        [ -n "${texto// /}" ] || { echo 'uso: orq-recado passar "onde parei" [--falta "…"] [--falhou "…"] [--para <agente|projeto>]'; exit 1; }
        deixar acao vez texto "$texto" falta "$FALTA" falhou "$FALHOU" para "$PARA"
        echo "vez passada${PARA:+ para $PARA}. O orquestrador fica sabendo; quem continuar pega com .orq/bin/orq-recado pegar <id>."
        ;;
    pegar)
        id="${1:-}"
        [[ "$id" =~ ^[0-9]+-[0-9a-f]+$ ]] || { echo 'uso: orq-recado pegar <id> (veja .orq/bin/orq-recado vezes)'; exit 1; }
        req="$(date +%s%3N)-p$RANDOM"
        ORQ_REQ="$req" deixar acao pegar vez "$id" req "$req"
        resp="$raiz/.orq/recados/entrada/$req.json"
        for _ in $(seq 1 "${ORQ_ESPERA_PEGAR:-40}"); do
            [ -f "$resp" ] && break
            sleep 0.5
        done
        [ -f "$resp" ] || { echo "o app não respondeu (está aberto?). O pedido fica e vale quando ele abrir; confira depois com .orq/bin/orq-recado vezes."; exit 2; }
        python3 - "$resp" <<'PY'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
if not r.get("ok"):
    print("não deu para pegar:", r.get("erro")); sys.exit(1)
v = r["vez"]
print(f"A vez é sua. {v['de']['nome']} ({v['de']['alvo']}) parou assim:\n\n{v['texto']}")
if v.get("falta"): print(f"\nFalta: {v['falta']}")
if v.get("falhou"): print(f"\nNão funcionou (não repita): {v['falhou']}")
print("\nAvise o orquestrador quando terminar: .orq/bin/orq-recado enviar \"…\" --tipo pronto")
PY
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
        sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
        [ -z "$cmd" ] || exit 1
        ;;
esac
