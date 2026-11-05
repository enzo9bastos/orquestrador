#!/usr/bin/env bash
# orq-evento — hook do Claude Code para o App de Orquestração.
#
# Grava cada evento do agente em <projeto>/.orq/eventos/<sessão>.jsonl, uma
# linha JSON por evento. O app lê esses arquivos; o orq pode ler também. A
# pasta do projeto é montada do host em todo devcontainer, então o aviso sai do
# container sem rede e sem mexer no firewall.
#
# Na permissão (PermissionRequest) o hook só espera resposta se o app estiver
# aberto (.orq/app-vivo atualizado há menos de 15 s) e se o canal de resposta
# for à prova do agente (veja abaixo). App fechado, travado, sem resposta ou
# canal gravável pelo agente: sai sem decidir, e a pergunta aparece no
# terminal como sempre. O hook nunca permite nem nega nada sozinho.
set -u

entrada=$(cat)
raiz="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$entrada")}"
dir="$raiz/.orq"
mkdir -p "$dir/eventos" 2>/dev/null || exit 0

sessao=$(jq -r '.session_id // "sem-sessao"' <<<"$entrada")
evento=$(jq -r '.hook_event_name // "?"' <<<"$entrada")
ts=$(date +%s%3N)

# Resumo de ferramenta curto na linha do tempo; a resposta do agente (Stop) e
# o pedido de permissão vão inteiros — é para isso que o arquivo existe.
jq -c --argjson ts "$ts" '
  {ts: $ts, evento: .hook_event_name, sessao: .session_id, cwd, source, model,
   message, notification_type, tool_name, prompt, last_assistant_message,
   transcript_path,
   resumo: (if .hook_event_name == "PermissionRequest" then null
            else (.tool_input // null | if . == null then null else (tostring | .[0:300]) end) end),
   tool_input: (if .hook_event_name == "PermissionRequest" then .tool_input else null end)}
  | with_entries(select(.value != null))' <<<"$entrada" >> "$dir/eventos/$sessao.jsonl"

[ "$evento" = PermissionRequest ] || exit 0

app_vivo() {
    [ -f "$dir/app-vivo" ] && [ $(( $(date +%s) - $(stat -c %Y "$dir/app-vivo") )) -lt 15 ]
}
app_vivo || exit 0

# A resposta do app só é confiável se o agente NÃO consegue forjá-la: a
# pasta de respostas e este próprio script têm de ser só-leitura para quem
# roda o hook (no devcontainer, montados com :ro; o app grava do host). Se o
# agente consegue gravar em um dos dois, o app não decide nada: a pergunta
# fica no terminal, como sem o app.
respostas="${ORQ_RESPOSTAS_DIR:-$dir/respostas-perm}"
if [ -w "$0" ] || [ ! -d "$respostas" ] || [ -w "$respostas" ]; then exit 0; fi

id="$sessao-$ts"
mkdir -p "$dir/permissoes"
jq -c --arg id "$id" --argjson ts "$ts" \
   '{id: $id, ts: $ts, sessao: .session_id, tool_name, tool_input}' \
   <<<"$entrada" > "$dir/permissoes/$id.json"
resp="$respostas/$id.resposta"

limite=$(( $(date +%s) + ${ORQ_ESPERA_SEGUNDOS:-300} ))
while [ "$(date +%s)" -lt "$limite" ]; do
    if [ -f "$resp" ]; then
        case "$(head -c 16 "$resp")" in
            permitir*) jq -n '{hookSpecificOutput: {hookEventName: "PermissionRequest",
                               decision: {behavior: "allow"}}}' ;;
            negar*)    jq -n '{hookSpecificOutput: {hookEventName: "PermissionRequest",
                               decision: {behavior: "deny", message: "Negado pelo usuário no app de orquestração."}}}' ;;
        esac
        mv "$dir/permissoes/$id.json" "$dir/permissoes/$id.respondida" 2>/dev/null
        exit 0
    fi
    app_vivo || break
    # Respondido no terminal: a pergunta aparece nos dois lugares ao mesmo
    # tempo, e se o usuário responder na tela a sessão segue e grava eventos
    # novos. Só conta o que prova que a sessão andou: o aviso "precisa da sua
    # permissão" (Notification) chega DEPOIS do pedido e não quer dizer nada.
    if jq -e --argjson ts "$ts" 'select(.ts > $ts and (.evento | IN("PostToolUse",
            "PostToolUseFailure", "PermissionDenied", "Stop", "UserPromptSubmit", "SessionEnd")))' \
          "$dir/eventos/$sessao.jsonl" >/dev/null 2>&1; then
        mv "$dir/permissoes/$id.json" "$dir/permissoes/$id.no-terminal" 2>/dev/null
        exit 0
    fi
    sleep 1
done
# Ninguém respondeu: a pergunta volta para o terminal.
mv "$dir/permissoes/$id.json" "$dir/permissoes/$id.expirada" 2>/dev/null
exit 0
