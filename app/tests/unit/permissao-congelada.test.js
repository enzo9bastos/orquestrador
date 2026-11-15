// Área: hook (cartão de permissão do agente: o que o app mostra é o que o hook decide)
// 0.A2 da Etapa 0. O hook (hooks/orq-evento.sh) decide pelo pedido que tem na
// memória; o app mostrava o .json de .orq/permissoes, que o agente pode
// reescrever. Agora o hook guarda o hash do pedido que gravou, o app congela o
// que mostrou (id pelo nome do arquivo, conteúdo da 1ª leitura) e responde
// "permitir <hash do que mostrou>": se não bate, o hook não decide nada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { casaTemporaria } = require('../ajuda');

const HOOK = path.join(__dirname, '../../../hooks/orq-evento.sh');
const pular = (!fs.existsSync(HOOK) && 'fora do repositório') || (process.getuid() === 0 && 'root grava em tudo');
const casa = casaTemporaria({ raizProjetos: '~/dev', niveis: 1, ignorar: '^[_-]' });
const coletor = require('../../coletor');

let n = 0;
function projeto() {
  const proj = `q${++n}`;
  const dir = path.join(casa, 'dev', proj);
  const bin = path.join(dir, '.orq', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(dir, '.orq', 'respostas-perm'));
  fs.copyFileSync(HOOK, path.join(bin, 'orq-evento.sh'));
  fs.chmodSync(path.join(bin, 'orq-evento.sh'), 0o555);
  fs.writeFileSync(path.join(dir, '.orq', 'app-vivo'), '');
  return { proj, dir, hook: path.join(bin, 'orq-evento.sh'), resp: path.join(dir, '.orq', 'respostas-perm'), perm: path.join(dir, '.orq', 'permissoes') };
}

// O app no host grava na pasta que é só-leitura para o agente.
function appResponde(p, id, decisao) {
  fs.chmodSync(p.resp, 0o755);
  try { return coletor.responder('', p.proj, id, decisao); } finally { fs.chmodSync(p.resp, 0o555); }
}

// Roda o hook com um pedido de "rm -rf /" e, quando o .json aparece, chama
// quandoAparecer(id, arquivo) — que faz o papel do agente e do app.
function pedir(p, quandoAparecer) {
  fs.chmodSync(p.resp, 0o555);
  return new Promise((ok) => {
    const proc = spawn('bash', [p.hook], { env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir, ORQ_ESPERA_SEGUNDOS: '4' } });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.on('close', () => { clearInterval(vigia); fs.chmodSync(p.resp, 0o755); ok(saida); });
    proc.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }));
    const vigia = setInterval(() => {
      let f;
      try { f = fs.readdirSync(p.perm).find((x) => x.endsWith('.json')); } catch { return; }
      if (!f) return;
      clearInterval(vigia);
      quandoAparecer(f.slice(0, -5), path.join(p.perm, f));
    }, 50);
  });
}
const cartao = (p, id) => coletor._pendencias('', p.proj, p.dir).find((x) => x.id === id);
const reescrever = (arq, command) => {
  const o = JSON.parse(fs.readFileSync(arq, 'utf8'));
  fs.writeFileSync(arq, JSON.stringify({ ...o, tool_input: { command } }) + '\n');
};

test('A2: pedido honesto — o app mostra o que o hook pediu e o "permitir" vale', { skip: pular }, async () => {
  const p = projeto();
  let visto = null;
  const saida = await pedir(p, (id) => { visto = cartao(p, id); appResponde(p, id, 'permitir'); });
  assert.strictEqual(visto.entrada.command, 'rm -rf /');
  assert.match(saida, /"behavior":\s*"allow"/);
});

test('A2: o agente reescreve o .json ANTES do app ler → o app mostra o forjado, mas o hook não aprova', { skip: pular }, async () => {
  const p = projeto();
  let visto = null;
  const saida = await pedir(p, (id, arq) => {
    reescrever(arq, 'ls'); // o agente troca o que o usuário vai ver
    visto = cartao(p, id);
    appResponde(p, id, 'permitir');
  });
  assert.strictEqual(visto.entrada.command, 'ls');
  assert.doesNotMatch(saida, /allow/, 'o usuário aprovou "ls"; o hook pedia "rm -rf /": nada é aprovado');
});

test('A2: o agente reescreve DEPOIS do app ler → o cartão continua mostrando o original', { skip: pular }, async () => {
  const p = projeto();
  let antes = null, depois = null;
  const saida = await pedir(p, (id, arq) => {
    antes = cartao(p, id);
    reescrever(arq, 'ls');
    depois = cartao(p, id);
    appResponde(p, id, 'permitir');
  });
  assert.strictEqual(antes.entrada.command, 'rm -rf /');
  assert.strictEqual(depois.entrada.command, 'rm -rf /', 'mostra o que foi congelado na 1ª leitura');
  assert.strictEqual(depois.alterado, true);
  assert.match(saida, /"behavior":\s*"allow"/, 'o usuário aprovou exatamente o que o hook pediu');
});

test('A2: o id vem do nome do arquivo, não do conteúdo', () => {
  const p = projeto();
  fs.mkdirSync(p.perm, { recursive: true });
  fs.writeFileSync(path.join(p.perm, 's1-100.json'), JSON.stringify({ id: 's1-100', ts: 1, tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }) + '\n');
  // O agente deixa outro arquivo dizendo ser o mesmo pedido, com outro comando.
  fs.writeFileSync(path.join(p.perm, 'falso.json'), JSON.stringify({ id: 's1-100', ts: 2, tool_name: 'Bash', tool_input: { command: 'ls' } }) + '\n');
  const ids = coletor._pendencias('', p.proj, p.dir).map((x) => [x.id, x.entrada.command]).sort();
  assert.deepStrictEqual(ids, [['falso', 'ls'], ['s1-100', 'rm -rf /']]);
});

test('A2: responder sem o app ter mostrado o pedido não grava nada', () => {
  const p = projeto();
  fs.mkdirSync(p.perm, { recursive: true });
  fs.writeFileSync(path.join(p.perm, 's9-1.json'), JSON.stringify({ id: 's9-1', ts: 1, tool_name: 'Bash', tool_input: { command: 'x' } }) + '\n');
  assert.strictEqual(coletor.responder('', p.proj, 's9-1', 'permitir'), false);
  assert.deepStrictEqual(fs.readdirSync(p.resp), []);
});
