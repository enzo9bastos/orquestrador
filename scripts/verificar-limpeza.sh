#!/usr/bin/env bash
# Portão de limpeza: reprova se o repositório tiver algum termo proibido ou
# segredo. Use antes de todo push.
#   scripts/verificar-limpeza.sh <arquivo-de-termos>
# Confere os arquivos e o histórico do ramo atual (o que vai publicado), não
# os outros ramos locais (ex.: cópia de segurança antes de uma reescrita).
# O arquivo de termos tem uma expressão regular (grep -E) por linha; linhas
# vazias e com # são ignoradas; "CASO:" na frente respeita maiúsculas. A lista fica
# fora deste repositório: ela mesma diz o que não pode aparecer aqui.
set -u
termos="${1:?uso: $0 <arquivo-de-termos>}"
raiz="$(git rev-parse --show-toplevel)" || exit 2
cd "$raiz" || exit 2
falhou=0

# Linhas com "CASO:" na frente são comparadas respeitando maiúsculas (ex.: o
# código de ticket, sempre maiúsculo, que sem isso casa com CSS como
# "grid-row-end"). As outras ignoram maiúsculas.
sem_caso=$(grep -vE '^\s*(#|$)|^CASO:' "$termos" | paste -sd'|')
com_caso=$(grep -E '^CASO:' "$termos" | sed 's/^CASO://' | paste -sd'|')
for modo in sem com; do
    if [ "$modo" = sem ]; then PADRAO="$sem_caso"; OPCAO="-i"; else PADRAO="$com_caso"; OPCAO=""; fi
    [ -n "$PADRAO" ] || continue
    achados=$(git ls-files -z --cached --others --exclude-standard | xargs -0 grep -nIE $OPCAO "$PADRAO" -- 2>/dev/null)
    if [ -n "$achados" ]; then echo "TERMOS PROIBIDOS nos arquivos:"; echo "$achados" | cut -c1-300; falhou=1; fi
    if git rev-parse HEAD >/dev/null 2>&1; then
        hist=$(git log -p HEAD | grep -nIE $OPCAO "$PADRAO" | head -20 | cut -c1-300)
        if [ -n "$hist" ]; then echo "TERMOS PROIBIDOS no histórico:"; echo "$hist"; falhou=1; fi
        msgs=$(git log --format=%B HEAD | grep -E $OPCAO "$PADRAO" | head -5)
        if [ -n "$msgs" ]; then echo "TERMOS PROIBIDOS em mensagens de commit:"; echo "$msgs"; falhou=1; fi
    fi
done

if command -v gitleaks >/dev/null; then
    gitleaks dir . --no-banner --redact -l warn || falhou=1
    if git rev-parse HEAD >/dev/null 2>&1; then gitleaks git . --no-banner --redact -l warn || falhou=1; fi
else
    echo "aviso: gitleaks não instalado — segredos NÃO conferidos"; falhou=1
fi

[ "$falhou" = 0 ] && echo "limpo" || { echo "REPROVADO"; exit 1; }
