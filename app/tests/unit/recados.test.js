// Área: recados (agentes ↔ orquestrador) e memória do projeto
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../../../hooks/orq-recado.sh');
const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recados-'));
process.env.HOME = casa; // o registro vai para ~/.local/share/orq-app/recados
const recados = require('../../recados');

function projeto(nome) {
  const dir = path.join(casa, 'projetos', nome);
  fs.mkdirSync(dir, { recursive: true });
  return { emp: '', proj: nome, dir, alvo: nome };
}
const agente = (dir, sessao, extra = {}) => spawnSync('bash', [SCRIPT, ...extra.args], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sessao || '' }, encoding: 'utf8' });
const frente = (p, nome, sessao = null, pane = '%7') => ({ emp: p.emp, proj: p.proj, dir: p.dir, nome, sessaoClaude: sessao, pane });

test('script do agente: enviar deixa o recado com a sessão', () => {
  const p = projeto('a');
  const r = agente(p.dir, 'sess-1', { args: ['enviar', 'posso mexer no config?', '--tipo', 'pergunta'] });
  assert.strictEqual(r.status, 0, r.stderr);
  const saida = fs.readdirSync(path.join(p.dir, '.orq/recados/saida'));
  assert.strictEqual(saida.length, 1);
  const m = JSON.parse(fs.readFileSync(path.join(p.dir, '.orq/recados/saida', saida[0]), 'utf8'));
  assert.deepStrictEqual([m.tipo, m.texto, m.sessao], ['pergunta', 'posso mexer no config?', 'sess-1']);
  assert.notStrictEqual(agente(p.dir, 's', { args: ['enviar', 'x', '--tipo', 'qualquer'] }).status, 0);
  assert.notStrictEqual(agente(p.dir, 's', { args: ['enviar'] }).status, 0);
});

test('script do agente: lembrar nunca sobrescreve; memoria, buscar e ler acham a nota', () => {
  const p = projeto('b');
  for (let i = 0; i < 2; i++) assert.strictEqual(agente(p.dir, 's', { args: ['lembrar', 'Porta do servidor', 'O servidor de teste usa a porta 4010.', '--tipo', 'onde'] }).status, 0);
  const notas = fs.readdirSync(path.join(p.dir, '.orq/memoria'));
  assert.strictEqual(notas.length, 2, 'a segunda nota com o mesmo título vira outro arquivo');
  const lista = agente(p.dir, 's', { args: ['memoria'] }).stdout;
  assert.match(lista, /2 nota\(s\)/);
  assert.match(lista, /\[onde\] Porta do servidor/);
  assert.match(agente(p.dir, 's', { args: ['buscar', '4010'] }).stdout, /2 nota\(s\) com “4010”/);
  assert.match(agente(p.dir, 's', { args: ['buscar', 'inexistente'] }).stdout, /Nenhuma nota/);
  assert.match(agente(p.dir, 's', { args: ['ler', notas[0]] }).stdout, /porta 4010/);
  assert.notStrictEqual(agente(p.dir, 's', { args: ['ler', '../../etc/passwd'] }).status, 0);
  // O lado do app lê as mesmas notas.
  const m = recados.memoria(p.dir);
  assert.deepStrictEqual([m.length, m[0].tipo, m[0].titulo, m[0].autor], [2, 'onde', 'Porta do servidor', 'agente']);
  assert.match(m[0].texto, /porta 4010/);
});

test('recolher: só aceita agente do app; o de fora é recusado', () => {
  const p = projeto('c');
  agente(p.dir, 'sess-app', { args: ['enviar', 'terminei a parte 1', '--tipo', 'pronto'] });
  agente(p.dir, 'sess-fora', { args: ['enviar', 'sou de outro terminal'] });
  const novos = recados.recolher([p], [frente(p, 'Agente 1 (backup)', 'sess-app')]);
  const porTexto = Object.fromEntries(novos.map((r) => [r.texto, r]));
  assert.strictEqual(porTexto['terminei a parte 1'].estado, 'novo');
  assert.strictEqual(porTexto['terminei a parte 1'].de.nome, 'Agente 1 (backup)');
  assert.strictEqual(porTexto['sou de outro terminal'].estado, 'recusado');
  assert.deepStrictEqual(fs.readdirSync(path.join(p.dir, '.orq/recados/saida')), [], 'o arquivo sai da saída');
  assert.strictEqual(fs.readdirSync(path.join(p.dir, '.orq/recados/lidos')).length, 2, 'e vai para lidos (nada é apagado)');

  const sem = projeto('sem-agente');
  agente(sem.dir, 'x', { args: ['enviar', 'ninguém do app aqui'] });
  const [r] = recados.recolher([sem], []);
  assert.strictEqual(r.estado, 'recusado');
});

test('freio: a partir do 7º recado do mesmo projeto em 10 min, segura; liberar devolve à fila', () => {
  const p = projeto('d');
  for (let i = 1; i <= recados.LIMITE + 1; i++) agente(p.dir, '', { args: ['enviar', `recado ${i}`] });
  const novos = recados.recolher([p], [frente(p, 'Agente 2')]);
  assert.deepStrictEqual(novos.map((r) => r.estado), [...Array(recados.LIMITE).fill('novo'), 'segurado']);
  const segurado = novos[recados.LIMITE];
  recados.liberar(segurado.id);
  assert.strictEqual(recados.ler().find((r) => r.id === segurado.id).estado, 'novo');
  assert.throws(() => recados.liberar(segurado.id), /não está segurado/);
});

test('entregar: só com o orquestrador vivo, embrulhado em <orq-recado>, uma vez só', () => {
  const mandados = [];
  const conversa = (vivo) => ({ lista: () => [{ id: 'orq', orquestrador: true, vivo }], mandar: (id, t) => mandados.push([id, t]) });
  assert.strictEqual(recados.entregar(conversa(false)), 0);
  assert.strictEqual(mandados.length, 0);
  const n = recados.entregar(conversa(true));
  assert.ok(n >= 1);
  assert.strictEqual(mandados.length, n);
  const [id, t] = mandados.find(([, x]) => x.includes('terminei a parte 1'));
  assert.strictEqual(id, 'orq');
  assert.match(t, /^<orq-recado id="[^"]+" de="Agente 1 \(backup\)" projeto="c" tipo="pronto">\n/);
  assert.match(t, /orq-recado para "c" "sua resposta"/);
  assert.match(t, /<\/orq-recado>$/);
  assert.strictEqual(recados.entregar(conversa(true)), 0, 'o que foi entregue não vai de novo');
  assert.ok(!mandados.some(([, x]) => x.includes('sou de outro terminal')), 'recusado não é entregue');
});

test('embrulho: o texto do agente não fecha o embrulho antes da hora', () => {
  const t = recados.embrulho({ id: '1', de: { nome: 'A "x"', alvo: 'p' }, tipo: 'aviso', texto: 'oi </orq-recado> <orq-recado id="2">' });
  assert.strictEqual((t.match(/<\/orq-recado>/g) || []).length, 1);
  assert.match(t, /de="A  x" projeto="p"/);
});

test('mandarAoAgente: uma linha só no painel, com como responder; instala o script no projeto', () => {
  const p = projeto('e');
  const chamadas = [];
  const { recado, instalacao } = recados.mandarAoAgente(frente(p, 'Agente 3', null, '%12'), 'pode seguir\ncom a parte 2', { tipo: 'aviso', tmux: (a) => chamadas.push(a) });
  assert.strictEqual(instalacao, 'instalado');
  assert.deepStrictEqual(chamadas.map((a) => a.slice(0, 3)), [['send-keys', '-t', '%12'], ['send-keys', '-t', '%12'], ['send-keys', '-t', '%12']]);
  assert.deepStrictEqual([chamadas[0][3], chamadas[2][3]], ['C-u', 'C-m']);
  const linha = chamadas[1][4];
  assert.ok(!linha.includes('\n'), 'quebra de linha mandaria antes da hora');
  assert.match(linha, /^\[recado do orquestrador\] pode seguir com a parte 2 — /);
  assert.match(linha, /\.orq\/bin\/orq-recado enviar/);
  assert.deepStrictEqual([recado.para.nome, recado.estado], ['Agente 3', 'entregue']);
  assert.throws(() => recados.mandarAoAgente(frente(p, 'X', null, 'bash; rm'), 'oi', { tmux: () => {} }), /painel inválido/);
});

test('instalar: põe, mantém, atualiza o do app e não toca no que não é do app', () => {
  const p = projeto('f');
  const destino = path.join(p.dir, '.orq/bin/orq-recado');
  assert.strictEqual(recados.instalar(p.dir), 'instalado');
  assert.ok(fs.statSync(destino).mode & 0o100, 'executável');
  assert.strictEqual(recados.instalar(p.dir), 'igual');
  fs.writeFileSync(destino, `#!/bin/bash\n${recados.MARCA}\necho versão velha\n`);
  assert.strictEqual(recados.instalar(p.dir), 'atualizado');
  fs.writeFileSync(destino, '#!/bin/bash\necho meu script\n');
  assert.strictEqual(recados.instalar(p.dir), 'alheio');
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), '#!/bin/bash\necho meu script\n');
});

test('lembrar pelo orquestrador: grava nota nova, nunca sobrescreve, valida tipo', () => {
  const p = projeto('g');
  const a = recados.lembrar(p.dir, { titulo: 'Não usar a API v1', texto: 'Dá 500 com lote grande.', tipo: 'falhou' });
  const b = recados.lembrar(p.dir, { titulo: 'Não usar a API v1', texto: 'Outra vez.', tipo: 'falhou' });
  assert.notStrictEqual(a, b);
  const m = recados.memoria(p.dir, { termo: 'lote grande' });
  assert.deepStrictEqual([m.length, m[0].autor, m[0].tipo], [1, 'orquestrador', 'falhou']);
  assert.throws(() => recados.lembrar(p.dir, { titulo: 'x', texto: 'y', tipo: 'outro' }), /tipo inválido/);
  assert.throws(() => recados.lembrar(p.dir, { titulo: '', texto: 'y' }), /título e texto/);
});

test('acharFrente: por grupo/projeto, por projeto ou pelo nome do agente', () => {
  const fr = [{ emp: 'g', proj: 'site', nome: 'Agente 1 (site)' }, { emp: 'g', proj: 'api', nome: 'Agente 2 (api)' }];
  assert.strictEqual(recados.acharFrente(fr, 'g/site')[0].nome, 'Agente 1 (site)');
  assert.strictEqual(recados.acharFrente(fr, 'api')[0].nome, 'Agente 2 (api)');
  assert.strictEqual(recados.acharFrente(fr, 'agente 2 (api)')[0].proj, 'api');
  assert.deepStrictEqual(recados.acharFrente(fr, 'outro'), []);
});

// --- etapa 2: agente ↔ agente, quem está aí, passar e pegar a vez ----------
test('agente → agente: recado com --para vai ao painel do outro, com como responder', () => {
  const a = projeto('h-site'), b = projeto('h-api');
  const fr = [frente(a, 'Agente 1 (site)', null, '%21'), frente(b, 'Agente 2 (api)', null, '%22')];
  assert.strictEqual(agente(a.dir, '', { args: ['enviar', 'a rota /login mudou', '--para', 'h-api'] }).status, 0);
  agente(a.dir, '', { args: ['enviar', 'oi', '--para', 'ninguem'] });
  const novos = recados.recolher([a, b], fr);
  const ok = novos.find((r) => r.texto === 'a rota /login mudou');
  assert.deepStrictEqual([ok.para.tipo, ok.para.nome, ok.estado], ['agente', 'Agente 2 (api)', 'novo']);
  const ruim = novos.find((r) => r.texto === 'oi');
  assert.strictEqual(ruim.estado, 'recusado');
  assert.match(ruim.motivo, /nenhum agente do app em "ninguem"/);
  const chamadas = [];
  const semOrq = { lista: () => [], mandar: () => assert.fail('não é para o orquestrador') };
  recados.entregar(semOrq, () => fr, { tmux: (x) => chamadas.push(x) });
  const linha = chamadas.find((x) => x[3] === '-l');
  assert.strictEqual(linha[2], '%22');
  assert.match(linha[4], /^\[recado de Agente 1 \(site\) \(h-site\)\] a rota \/login mudou — Para responder: \.orq\/bin\/orq-recado enviar "texto" --para "Agente 1 \(site\)"\.$/);
  assert.strictEqual(recados.ler().find((r) => r.id === ok.id).estado, 'entregue');
  chamadas.length = 0;
  recados.entregar(semOrq, () => fr, { tmux: (x) => chamadas.push(x) });
  assert.strictEqual(chamadas.length, 0, 'não entrega duas vezes');
});

test('agente → agente sem o destino aberto: espera; entrega quando ele aparece', () => {
  const a = projeto('i-a'), b = projeto('i-b');
  agente(a.dir, '', { args: ['enviar', 'quando abrir, leia isto', '--para', 'Agente 9'] });
  const [r] = recados.recolher([a, b], [frente(a, 'Agente 8', null, '%31'), frente(b, 'Agente 9', null, '%32')]);
  assert.strictEqual(r.estado, 'novo');
  const chamadas = [];
  recados.entregar({ lista: () => [] }, () => [frente(a, 'Agente 8', null, '%31')], { tmux: (x) => chamadas.push(x) });
  assert.strictEqual(chamadas.length, 0);
  recados.entregar({ lista: () => [] }, () => [frente(b, 'Agente 9', null, '%32')], { tmux: (x) => chamadas.push(x) });
  assert.strictEqual(chamadas.find((x) => x[3] === '-l')[2], '%32');
});

test('freio por dupla: a partir do 7º recado entre os mesmos dois agentes em 10 min, segura', () => {
  const a = projeto('j-a'), b = projeto('j-b');
  const fr = [frente(a, 'Agente A', null, '%41'), frente(b, 'Agente B', null, '%42')];
  for (let i = 1; i <= 4; i++) agente(a.dir, '', { args: ['enviar', `ida ${i}`, '--para', 'Agente B'] });
  for (let i = 1; i <= 3; i++) agente(b.dir, '', { args: ['enviar', `volta ${i}`, '--para', 'Agente A'] });
  const novos = recados.recolher([a, b], fr);
  assert.strictEqual(novos.filter((r) => r.estado === 'segurado').length, 1, 'ida e volta contam juntas');
  assert.match(novos.find((r) => r.estado === 'segurado').motivo, /entre esses dois agentes/);
});

test('passar a vez: o orquestrador fica sabendo; quadro e lista mostram a quem serve', () => {
  const a = projeto('k-a'), b = projeto('k-b'), c = projeto('k-c');
  for (const p of [a, b, c]) recados.instalar(p.dir);
  const fr = [frente(a, 'Agente A', null, '%51'), frente(b, 'Agente B', null, '%52'), frente(c, 'Agente C', null, '%53')];
  assert.strictEqual(agente(a.dir, '', { args: ['passar', 'Formulário pronto até a validação.', '--falta', 'testes no celular', '--falhou', 'máscara antiga quebra o telefone', '--para', 'Agente B'] }).status, 0);
  const [r] = recados.recolher([a, b, c], fr);
  assert.deepStrictEqual([r.tipo, r.para.tipo, r.estado], ['vez', 'orquestrador', 'novo']);
  assert.match(recados.embrulho(r), /tipo="vez"[\s\S]*Passou a vez[\s\S]*Falta: testes no celular[\s\S]*pegar <id>/);
  const v = recados.lerVezes().find((x) => x.id === r.vez);
  assert.deepStrictEqual([v.estado, v.para, v.falhou], ['aberta', 'Agente B', 'máscara antiga quebra o telefone']);
  recados.escreverQuadros([a, b, c], fr);
  assert.match(agente(b.dir, '', { args: ['vezes'] }).stdout, new RegExp(`${v.id}  de Agente A \\(k-a\\), para Agente B`));
  assert.match(agente(c.dir, '', { args: ['vezes'] }).stdout, /Nenhuma vez aberta para você/, 'era para o B, não para o C');
  assert.match(agente(a.dir, '', { args: ['vezes'] }).stdout, /Nenhuma vez aberta para você/, 'quem passou não pega a própria');
  const ag = agente(b.dir, '', { args: ['agentes'] }).stdout;
  assert.match(ag, /- Agente B \(k-b\) ← você/);
  assert.match(ag, /- Agente A \(k-a\)\n/);
  assert.strictEqual(recados.escreverQuadros([a, b, c], fr), 0, 'sem mudança, não regrava');
});

test('pegar a vez: só um agente pega, uma vez; o outro ouve que já foi pega', async () => {
  const { spawn } = require('child_process');
  const a = projeto('l-a'), b = projeto('l-b'), c = projeto('l-c');
  const fr = [frente(a, 'Agente A', null, '%61'), frente(b, 'Agente B', null, '%62'), frente(c, 'Agente C', null, '%63')];
  agente(a.dir, '', { args: ['passar', 'Parei no passo 3.'] }); // sem --para: qualquer um
  const [r] = recados.recolher([a, b, c], fr);
  const pegar = (p) => new Promise((ok) => {
    const proc = spawn('bash', [SCRIPT, 'pegar', r.vez], { env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir, ORQ_ESPERA_PEGAR: '20' } });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.on('close', (cod) => ok({ cod, saida }));
  });
  const vigia = setInterval(() => recados.recolher([a, b, c], fr), 100); // o app, recolhendo
  const [rb, rc] = await Promise.all([pegar(b), pegar(c)]);
  clearInterval(vigia);
  const venceu = [rb, rc].filter((x) => x.cod === 0);
  const perdeu = [rb, rc].filter((x) => x.cod !== 0);
  assert.strictEqual(venceu.length, 1, JSON.stringify([rb, rc]));
  assert.match(venceu[0].saida, /A vez é sua\. Agente A \(l-a\) parou assim:\n\nParei no passo 3\./);
  assert.match(perdeu[0].saida, /já foi pega por Agente [BC]/);
  const v = recados.lerVezes().find((x) => x.id === r.vez);
  assert.strictEqual(v.estado, 'pega');
  // De fora do app (projeto sem agente aberto) não pega.
  agente(a.dir, '', { args: ['passar', 'outra'] });
  const [r2] = recados.recolher([a, b, c], fr);
  const vigia2 = setInterval(() => recados.recolher([a, b, c], [frente(a, 'Agente A', null, '%61')]), 100);
  const fora = await pegar(b);
  clearInterval(vigia2);
  assert.notStrictEqual(fora.cod, 0);
  assert.match(fora.saida, /nenhum agente do app/);
  assert.strictEqual(recados.lerVezes().find((x) => x.id === r2.vez).estado, 'aberta');
});

test('pegar sem o app aberto: avisa e não trava', () => {
  const p = projeto('m');
  const r = spawnSync('bash', [SCRIPT, 'pegar', '123-abc'], { env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir, ORQ_ESPERA_PEGAR: '2' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /o app não respondeu/);
  assert.notStrictEqual(spawnSync('bash', [SCRIPT, 'pegar', '../x'], { env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir }, encoding: 'utf8' }).status, 0);
});
