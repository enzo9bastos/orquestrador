// Área: pedido avulso (uma tarefa a um Claude ou Codex num container descartável)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-avulso-'));
process.env.HOME = casa;
const avulso = require('../../avulso');
const recados = require('../../recados');

const ctx = { imagem: 'vsc-proj-abc', rede: 'essentials' };
const saidaOk = (resp, arqs = []) => `algo antes\n@@CODIGO@@ 0\n@@RESPOSTA@@\n${resp}\n@@ARQUIVOS@@\n${arqs.join('\n')}\n@@LOG@@\nlog final\n`;

test('docker: pasta só leitura por padrão; gravável só com escrita aprovada', () => {
  const ro = avulso.argumentosDocker({ ...ctx, dir: '/home/x/dev/g/jogo', escrever: false }, 'codex', null, '1-a');
  assert.ok(ro.includes('/home/x/dev/g/jogo:/workspace/jogo:ro'));
  assert.ok(ro.includes('--rm'), 'container descartável');
  assert.ok(ro.includes('claude-code-config-shared:/home/node/.claude') && ro.includes('codex-config-shared:/home/node/.codex'), 'logins compartilhados');
  assert.deepStrictEqual(ro.slice(ro.indexOf('--network'), ro.indexOf('--network') + 2), ['--network', 'essentials']);
  assert.ok(ro.includes('ORQ_PEDIDO') && !ro.some((a) => a.startsWith('ORQ_PEDIDO=')), 'o pedido vai pelo ambiente, não na linha de comando');
  const rw = avulso.argumentosDocker({ ...ctx, dir: '/home/x/dev/g/jogo', escrever: true }, 'codex', null, '1-a');
  assert.ok(rw.includes('/home/x/dev/g/jogo:/workspace/jogo'));
  assert.match(avulso.script('codex', null), /init-firewall\.sh[\s\S]*codex exec --skip-git-repo-check/);
  assert.match(avulso.script('claude', 'haiku'), /claude -p "\$ORQ_PEDIDO" --permission-mode auto --model "haiku"/);
});

test('instruções: modo, orientação do usuário e o pedido', () => {
  const ro = avulso.instrucoes({ texto: 'liste as rotas', escrever: false });
  assert.match(ro, /só para leitura/);
  assert.match(ro, /Pedido:\nliste as rotas$/);
  assert.ok(!/Orientação/.test(ro));
  assert.match(avulso.instrucoes({ texto: 'x', escrever: true, nota: 'só PNG' }), /pode criar e alterar[\s\S]*Orientação do usuário: só PNG/);
});

test('rodar: resposta e arquivos; falta de login e tempo esgotado viram erro claro', async () => {
  const rodar = (out, extra = {}) => avulso.rodar({ id: '1', dir: '/p/jogo', motor: 'codex', texto: 'x', contexto: ctx, ...extra }, { executar: async (args, o) => { rodar.ultimo = { args, o }; return { out, err: '' }; } });
  const ok = await rodar(saidaOk('Fiz o sprite.', ['assets/heroi.png']));
  assert.deepStrictEqual([ok.ok, ok.resposta, ok.arquivos], [true, 'Fiz o sprite.', ['assets/heroi.png']]);
  assert.match(rodar.ultimo.o.env.ORQ_PEDIDO, /Pedido:\nx/);
  const login = await rodar('@@CODIGO@@ 1\n@@RESPOSTA@@\n\n@@ARQUIVOS@@\n\n@@LOG@@\nError: Not logged in\n');
  assert.strictEqual(login.ok, false);
  assert.match(login.erro, /codex saiu com código 1\. Parece falta de login.*codex login --device-auth/);
  assert.match((await rodar('@@CODIGO@@ 124\n@@RESPOSTA@@\n@@ARQUIVOS@@\n@@LOG@@\n')).erro, /20 min/);
  assert.match((await rodar('@@ERRO@@ o firewall não subiu\n')).erro, /firewall/);
  assert.match((await avulso.rodar({ id: '2', dir: '/p', motor: 'gpt', texto: 'x', contexto: ctx })).erro, /motor desconhecido/);
  assert.match((await avulso.rodar({ id: '3', dir: '/p', motor: 'codex', texto: 'x', contexto: { erro: 'este projeto ainda não tem devcontainer' } })).erro, /devcontainer/);
});

test('pedido: só leitura vai direto à fila; escrita espera aprovação; negar volta com o motivo', () => {
  const ro = recados.pedir({ alvo: 'jogo', motor: 'codex', texto: 'descreva a pasta' });
  assert.strictEqual(ro.estado, 'na-fila');
  const rw = recados.pedir({ alvo: 'jogo', motor: 'codex', texto: 'crie o sprite do herói', escrever: true });
  assert.strictEqual(rw.estado, 'aguardando');
  assert.ok(recados.pedidosNaFila().some((p) => p.id === ro.id) && !recados.pedidosNaFila().some((p) => p.id === rw.id));
  recados.decidirPedido(rw.id, true, 'só PNG, 64x64');
  const aprovado = recados.ler().find((r) => r.id === rw.id);
  assert.deepStrictEqual([aprovado.estado, aprovado.nota], ['na-fila', 'só PNG, 64x64']);
  assert.throws(() => recados.decidirPedido(rw.id, true), /não está esperando/);

  const outro = recados.pedir({ alvo: 'jogo', motor: 'claude', texto: 'reescreva o README', escrever: true });
  recados.decidirPedido(outro.id, false, 'o README é meu');
  assert.strictEqual(recados.ler().find((r) => r.id === outro.id).estado, 'negado');
  const aviso = recados.ler().find((r) => r.tipo === 'negado' && r.pedido === outro.id);
  assert.match(aviso.texto, /negou o pedido ao Claude avulso[\s\S]*Motivo: o README é meu/);
  const semMotivo = recados.pedir({ alvo: 'jogo', texto: 'y', escrever: true });
  recados.decidirPedido(semMotivo.id, false);
  assert.match(recados.ler().find((r) => r.pedido === semMotivo.id).texto, /\(sem motivo\)/);
  assert.throws(() => recados.pedir({ alvo: 'jogo', motor: 'gpt', texto: 'x' }), /motor inválido/);
});

test('concluir: a resposta volta ao orquestrador como recado, com os arquivos', () => {
  const p = recados.pedir({ alvo: 'jogo', motor: 'codex', texto: 'gere o ícone' });
  recados.marcarRodando(p.id);
  recados.concluirPedido(p.id, { ok: true, resposta: 'Pronto.', arquivos: ['assets/icone.png'] });
  assert.strictEqual(recados.ler().find((r) => r.id === p.id).estado, 'pronto');
  const resp = recados.ler().find((r) => r.tipo === 'resposta' && r.pedido === p.id);
  assert.deepStrictEqual([resp.de.nome, resp.para.tipo, resp.estado], ['Codex avulso', 'orquestrador', 'novo']);
  const mandados = [];
  recados.entregar({ lista: () => [{ id: 'o', orquestrador: true, vivo: true }], mandar: (id, t) => mandados.push(t) });
  const t = mandados.find((x) => x.includes('gere o ícone') || x.includes('Pronto.'));
  assert.match(t, /tipo="resposta"[\s\S]*Resposta ao seu pedido avulso \(Codex avulso, projeto jogo\):\nPronto\.\nArquivos criados ou alterados \(1\): assets\/icone\.png/);
});

test('app fechou com pedido rodando: vira falhou e o orquestrador fica sabendo', () => {
  const p = recados.pedir({ alvo: 'jogo', texto: 'demora' });
  recados.marcarRodando(p.id);
  recados.largarRodando();
  assert.strictEqual(recados.ler().find((r) => r.id === p.id).estado, 'falhou');
  assert.match(recados.ler().find((r) => r.tipo === 'falhou' && r.pedido === p.id).texto, /o app fechou no meio/);
  assert.strictEqual(recados.pedidosRodando().length, 0);
});
