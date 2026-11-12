// Pedido avulso: uma tarefa só, feita por um Claude ou um Codex que não é
// agente de ninguém (ex.: o orquestrador Claude pede ao Codex uma imagem).
//
// Roda num container DESCARTÁVEL feito da mesma imagem do devcontainer do
// projeto, com o mesmo firewall e os logins compartilhados (volumes
// claude-code-config-shared e codex-config-shared). A pasta do projeto entra
// montada SÓ LEITURA, a não ser que o usuário tenha aprovado escrita: quem
// garante é o Docker, não a IA (o sandbox do próprio Codex não roda dentro de
// container). O container some no fim (--rm). Não toca no container do agente.
const { execFile } = require('child_process');
const path = require('path');

const LIMITE_MS = 20 * 60 * 1000;
const MOTORES = ['codex', 'claude'];

// O que o ajudante recebe: o pedido e as regras de quem não tem ninguém para
// perguntar.
function instrucoes({ texto, escrever, nota }) {
  return [
    'Você é um ajudante avulso, acionado pelo orquestrador do App de Orquestração para UMA tarefa neste projeto.',
    escrever ? 'Você pode criar e alterar arquivos nesta pasta.' : 'Esta pasta está montada só para leitura: você não consegue gravar nada nela.',
    'Faça só o que foi pedido, sem fazer perguntas (ninguém vai responder). No fim, responda em poucas linhas o resultado e liste os arquivos que criou ou alterou, com o caminho relativo.',
    nota ? `Orientação do usuário: ${nota}` : '',
    '',
    'Pedido:',
    texto,
  ].filter((l, i) => l || i > 3).join('\n');
}

// O script que roda dentro do container descartável: firewall, marca de tempo,
// a IA, e a lista do que mudou na pasta. As partes saem entre marcadores.
function script(motor, modelo) {
  const m = modelo ? ` -m ${JSON.stringify(String(modelo))}` : '';
  const ia = motor === 'codex'
    ? `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --color never${m} -o /tmp/orq-resposta.txt "$ORQ_PEDIDO" > /tmp/orq-log.txt 2>&1`
    : `claude -p "$ORQ_PEDIDO" --permission-mode auto${modelo ? ` --model ${JSON.stringify(String(modelo))}` : ''} > /tmp/orq-resposta.txt 2> /tmp/orq-log.txt`;
  return [
    'sudo /usr/local/bin/init-firewall.sh > /tmp/orq-firewall.txt 2>&1 || { echo "@@ERRO@@ o firewall não subiu"; tail -5 /tmp/orq-firewall.txt; exit 90; }',
    'touch /tmp/orq-marca; sleep 1',
    `timeout ${Math.round(LIMITE_MS / 1000)} ${ia}; cod=$?`,
    'echo "@@CODIGO@@ $cod"',
    'echo "@@RESPOSTA@@"; cat /tmp/orq-resposta.txt 2>/dev/null | head -c 20000',
    'echo; echo "@@ARQUIVOS@@"; find . -newer /tmp/orq-marca -type f -not -path "./.git/*" -not -path "*/node_modules/*" -not -path "./.orq/*" 2>/dev/null | sed "s#^\\./##" | head -100',
    'echo "@@LOG@@"; tail -c 3000 /tmp/orq-log.txt 2>/dev/null',
  ].join('\n');
}

// Argumentos do docker run. ctx: { imagem, rede, dir, escrever, pedido }.
function argumentosDocker(ctx, motor, modelo, id) {
  const base = path.basename(ctx.dir);
  const destino = `/workspace/${base}`;
  return ['run', '--rm', '--name', `orq-avulso-${id}`,
    '--cap-add=NET_ADMIN', '--cap-add=NET_RAW',
    ...(ctx.rede ? ['--network', ctx.rede] : []),
    '-u', 'node', '-w', destino,
    '-v', `${ctx.dir}:${destino}${ctx.escrever ? '' : ':ro'}`,
    '-v', 'claude-code-config-shared:/home/node/.claude',
    '-v', 'codex-config-shared:/home/node/.codex',
    '-e', 'CLAUDE_CONFIG_DIR=/home/node/.claude', '-e', 'CODEX_HOME=/home/node/.codex',
    '-e', 'ORQ_PEDIDO',
    '--label', 'orq.avulso=1',
    ctx.imagem, 'bash', '-c', script(motor, modelo)];
}

function ler(saida) {
  const parte = (de, ate) => {
    const i = saida.indexOf(de);
    if (i < 0) return '';
    const j = ate ? saida.indexOf(ate, i + de.length) : -1;
    return saida.slice(i + de.length, j < 0 ? undefined : j).trim();
  };
  const erro = /@@ERRO@@ (.*)/.exec(saida);
  const cod = /@@CODIGO@@ (\d+)/.exec(saida);
  return {
    erro: erro ? erro[1] : null,
    codigo: cod ? Number(cod[1]) : null,
    resposta: parte('@@RESPOSTA@@', '@@ARQUIVOS@@'),
    arquivos: parte('@@ARQUIVOS@@', '@@LOG@@').split('\n').map((l) => l.trim()).filter(Boolean),
    log: parte('@@LOG@@'),
  };
}

// Acha a imagem e a rede do devcontainer do projeto (rodando ou parado).
function docker(args, { timeout = 15000, env } = {}) {
  return new Promise((ok) => {
    execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: env || process.env }, (e, out, err) => ok({ e, out: out || '', err: err || '' }));
  });
}
async function contexto(dir) {
  const r = await docker(['ps', '-a', '--filter', `label=devcontainer.local_folder=${dir}`, '--format', '{{.ID}}']);
  const id = r.out.split('\n').filter(Boolean)[0];
  if (!id) return { erro: 'este projeto ainda não tem devcontainer (abra uma vez com dev)' };
  const i = await docker(['inspect', '-f', '{{.Config.Image}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', id]);
  const [imagem, redes] = i.out.trim().split('|');
  if (!imagem) return { erro: 'não consegui ler a imagem do devcontainer' };
  return { imagem, rede: (redes || '').trim().split(/\s+/).filter(Boolean)[0] || null };
}

// Roda o pedido. Devolve { ok, resposta, arquivos, erro, log }.
async function rodar(pedido, { executar = docker } = {}) {
  if (!MOTORES.includes(pedido.motor)) return { ok: false, erro: `motor desconhecido: ${pedido.motor}` };
  const ctx = await (pedido.contexto ? Promise.resolve(pedido.contexto) : contexto(pedido.dir));
  if (ctx.erro) return { ok: false, erro: ctx.erro };
  const args = argumentosDocker({ ...ctx, dir: pedido.dir, escrever: !!pedido.escrever }, pedido.motor, pedido.modelo, pedido.id);
  const env = { ...process.env, ORQ_PEDIDO: instrucoes(pedido) };
  const r = await executar(args, { timeout: LIMITE_MS + 120000, env });
  const l = ler(r.out);
  if (l.erro) return { ok: false, erro: l.erro, log: l.log };
  if (l.codigo === null) return { ok: false, erro: `o container não rodou: ${(r.err || (r.e && r.e.message) || '').trim().slice(0, 400)}` };
  if (l.codigo === 124) return { ok: false, erro: 'passou de 20 min e foi parado', resposta: l.resposta, arquivos: l.arquivos, log: l.log };
  if (l.codigo !== 0) {
    const login = /not logged in|login|unauthori|401|auth/i.test(l.log) ? ` Parece falta de login: entre num container do projeto (dev sh) e rode ${pedido.motor === 'codex' ? 'codex login --device-auth' : 'claude'} uma vez.` : '';
    return { ok: false, erro: `${pedido.motor} saiu com código ${l.codigo}.${login}`, resposta: l.resposta, arquivos: l.arquivos, log: l.log };
  }
  return { ok: true, resposta: l.resposta || '(sem resposta escrita)', arquivos: l.arquivos, log: l.log };
}

module.exports = { rodar, instrucoes, script, argumentosDocker, ler, contexto, MOTORES, LIMITE_MS };
