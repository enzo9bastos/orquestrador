// Área: recados (o comando orq-recado de verdade, contra um tmux privado)
// 16/11: o coletor passou a devolver o estado como promessa (0.C1) e o
// `orq-recado para` continuou lendo `.frentes` na hora: quebrava com
// "Cannot read properties of undefined (reading 'filter')" e o orquestrador
// não conseguia mandar recado a nenhum agente. Nenhum teste rodava o comando.
// Aqui ele roda como o orquestrador roda, num tmux PRIVADO (TMUX_TMPDIR
// próprio), com casa temporária e docker falso: nada do tmux do usuário.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '../../bin/orq-recado');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('orq-recado para: acha o agente pelo estado do coletor e escreve no painel dele', async (t) => {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { t.skip('sem tmux'); return; }
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-teste-'));
  const dir = path.join(casa, 'dev', 'emp', 'proj-ana');
  const tmuxDir = path.join(casa, 'tm');
  const bin = path.join(casa, 'bin');
  for (const d of [dir, tmuxDir, bin, path.join(casa, '.config', 'orq-app')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(casa, '.config', 'orq-app', 'config.json'), JSON.stringify({ raizProjetos: path.join(casa, 'dev'), niveis: 2, ignorar: '^[_-]' }));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const agenteSh = path.join(casa, 'agente.sh');
  fs.writeFileSync(agenteSh, `#!/bin/bash
printf '\\033]0;✳ Agente 1\\007'
printf '%b\\n' 'Terminei.\\n────────\\n│ > \\n────────\\n  ⏵⏵ auto mode on (shift+tab to cycle)'
exec sleep 3600
`, { mode: 0o755 });
  const env = { ...process.env, HOME: casa, TMUX_TMPDIR: tmuxDir, PATH: `${bin}:${process.env.PATH}` };
  delete env.TMUX;
  const tmux = (...a) => execFileSync('tmux', ['-f', '/dev/null', ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { tmux('kill-server'); } catch { /* já não havia */ } });
  const rodar = (...a) => spawnSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8', timeout: 20000 });

  await t.test('sem nenhum agente aberto: diz isso (e não quebra)', () => {
    const r = rodar('para', 'proj-ana', 'tem alguém aí?');
    assert.doesNotMatch(r.stderr, /Cannot read properties|TypeError/, r.stderr);
    assert.match(r.stderr, /nenhum agente do app em "proj-ana"\. Agentes abertos: nenhum/);
    assert.strictEqual(r.status, 1);
  });

  tmux('new-session', '-d', '-s', 'agente-1', '-x', '120', '-y', '40', '-c', dir, '--', 'bash', agenteSh);
  for (let i = 0; i < 50 && !/auto mode on/.test(tmux('capture-pane', '-p', '-t', 'agente-1')); i++) await espera(100);

  await t.test('alvo que não existe: lista os agentes abertos', () => {
    const r = rodar('para', 'nao-existe', 'oi');
    assert.match(r.stderr, /nenhum agente do app em "nao-existe"\. Agentes abertos: Agente 1 \(emp\/proj-ana\)/, r.stderr);
    assert.strictEqual(r.status, 1);
  });

  await t.test('pelo projeto: o recado é digitado no painel do agente e fica no registro', async () => {
    const r = rodar('para', 'proj-ana', 'pode seguir com o relatório', '--tipo', 'aviso');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /recado entregue a Agente 1 \(emp\/proj-ana\)/);
    let tela = '';
    for (let i = 0; i < 30 && !/pode seguir com o relatório/.test(tela); i++) { await espera(100); tela = tmux('capture-pane', '-p', '-J', '-t', 'agente-1'); }
    assert.match(tela, /\[recado do orquestrador\] pode seguir com o relatório/);
    const registro = fs.readFileSync(path.join(casa, '.local', 'share', 'orq-app', 'recados', 'recados.jsonl'), 'utf8');
    assert.match(registro, /"texto":"pode seguir com o relatório"/);
  });

  await t.test('o comando termina sozinho (não fica preso depois de responder)', () => {
    const r = rodar('para', 'Agente 1', 'segundo recado');
    assert.strictEqual(r.signal, null, 'o comando não terminou em 20 s');
    assert.strictEqual(r.status, 0, r.stderr);
  });
});
