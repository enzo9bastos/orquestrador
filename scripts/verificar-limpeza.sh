#!/usr/bin/env bash
# Portão de limpeza: reprova se o repositório tiver algum termo proibido ou
# segredo. Use antes de todo push.
#   scripts/verificar-limpeza.sh <arquivo-de-termos>
# O arquivo de termos tem uma expressão regular (grep -E, sem diferenciar
# maiúsculas) por linha; linhas vazias e com # são ignoradas. A lista fica
# fora deste repositório: ela mesma diz o que não pode aparecer aqui.
set -u
termos="${1:?uso: $0 <arquivo-de-termos>}"
raiz="$(git rev-parse --show-toplevel)" || exit 2
cd "$raiz" || exit 2
falhou=0

padrao=$(grep -vE '^\s*(#|$)' "$termos" | paste -sd'|')
if [ -n "$padrao" ]; then
    achados=$(git ls-files -z --cached --others --exclude-standard | xargs -0 grep -nIiE "$padrao" -- 2>/dev/null)
    if [ -n "$achados" ]; then echo "TERMOS PROIBIDOS nos arquivos:"; echo "$achados"; falhou=1; fi
    if git rev-parse HEAD >/dev/null 2>&1; then
        hist=$(git log --all -p | grep -nIiE "$padrao" | head -20)
        if [ -n "$hist" ]; then echo "TERMOS PROIBIDOS no histórico:"; echo "$hist"; falhou=1; fi
        msgs=$(git log --all --format=%B | grep -iE "$padrao" | head -5)
        if [ -n "$msgs" ]; then echo "TERMOS PROIBIDOS em mensagens de commit:"; echo "$msgs"; falhou=1; fi
    fi
fi

if command -v gitleaks >/dev/null; then
    gitleaks dir . --no-banner --redact -l warn || falhou=1
    if git rev-parse HEAD >/dev/null 2>&1; then gitleaks git . --no-banner --redact -l warn || falhou=1; fi
else
    echo "aviso: gitleaks não instalado — segredos NÃO conferidos"; falhou=1
fi

[ "$falhou" = 0 ] && echo "limpo" || { echo "REPROVADO"; exit 1; }
