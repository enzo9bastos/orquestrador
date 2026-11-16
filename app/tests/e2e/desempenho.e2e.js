// Área: desempenho
// Orçamento do processo principal com 10 agentes falsos: o atraso do laço de
// eventos (medidor.js) não passa de 100 ms no p99, e o estado mostrado de cada
// agente é o esperado. Tudo isolado: tmux PRIVADO (TMUX_TMPDIR próprio),
// `docker` falso no PATH, casa temporária; nada de claude real nem do tmux do usuário.
//   ORQ_MEDIDAS_SAIDA=arquivo.json  grava os números (para o laudo)
//   ORQ_MEDIR_S=20                  segundos de amostragem com 10 agentes
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { abrirApp } = require('./app');

const N = 10;
const SEGUNDOS = Number(process.env.ORQ_MEDIR_S) || 20;
const SEGUNDOS_VAZIO = 8;

// Tela de cada tipo de agente falso (as mesmas marcas que o coletor reconhece).
const TELAS = {
  trabalhando: '✶ Pensando… (12s · ↓ 1.2k tokens)\\n────────\\n│ > \\n────────\\n  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt',
  esperando: 'Terminei.\\n────────\\n│ > \\n────────\\n  ⏵⏵ auto mode on (shift+tab to cycle)',
  permissao: 'Do you want to proceed?\\n❯ 1. Yes\\n  2. No\\n────────\\n  ⏵⏵ auto mode on (shift+tab to cycle)',
};
// 0..9: quatro pelo sinal do hook (Stop = esperando, PostToolUse = trabalhando), seis pela tela.
const PLANO = [
  { sinal: 'Stop', esperado: 'esperando' }, { sinal: 'PostToolUse', esperado: 'trabalhando' },
  { sinal: 'Stop', esperado: 'esperando' }, { sinal: 'PostToolUse', esperado: 'trabalhando' },
  { tela: 'trabalhando', esperado: 'trabalhando' }, { tela: 'esperando', esperado: 'esperando' },
  { tela: 'trabalhando', esperado: 'trabalhando' }, { tela: 'esperando', esperado: 'esperando' },
  { tela: 'esperando', esperado: 'esperando' }, { tela: 'permissao', esperado: 'permissao' },
];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('desempenho: 10 agentes falsos, atraso do laço no orçamento', async (t) => {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { t.skip('sem tmux'); return; }

  // tmux privado + docker falso (via PATH), herdados pelo app que o abrirApp lança.
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-perf-'));
  const tmuxDir = path.join(area, 'tm');
  const bin = path.join(area, 'bin');
  fs.mkdirSync(tmuxDir); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
# Docker falso: "ps" lista um container por projeto; "exec" demora como o de verdade (~150 ms).
case "$1" in
  ps) cat "${area}/docker-ps.txt" 2>/dev/null ;;
  exec) sleep 0.15; echo '"model":"claude-opus-5-5"' ;;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(area, 'docker-ps.txt'), '');
  const agenteSh = path.join(area, 'agente.sh');
  fs.writeFileSync(agenteSh, `#!/bin/bash
printf '\\033]0;✳ Agente %s\\007' "$2"
printf '%b\\n' "$1"
exec sleep 3600
`, { mode: 0o755 });
  process.env.TMUX_TMPDIR = tmuxDir;
  delete process.env.TMUX;
  process.env.PATH = `${bin}:${process.env.PATH}`;
  const tmux = (...a) => execFileSync('tmux', ['-f', '/dev/null', ...a], { stdio: 'ignore' });

  const arquivos = {};
  for (let i = 0; i < N; i++) arquivos[`dev/emp/proj-${i}/.keep`] = '';
  const app = await abrirApp({ config: { raizProjetos: '~/dev', niveis: 2, ignorar: '^[_-]' }, arquivos });
  t.after(async () => { await app.fechar(); try { tmux('kill-server'); } catch { /* já não havia */ } });

  const snap = (zerar = false) => app.avaliar(`window.orq.diagLaco(${zerar})`);
  const retrato = () => app.avaliar('window.orq.estado()');

  // Fase 1: nenhum agente.
  await app.esperar("document.readyState === 'complete'");
  await snap(true);
  await espera(SEGUNDOS_VAZIO * 1000);
  const vazio = await snap();

  // Sobe os 10 agentes falsos: pasta com git e eventos, painel no tmux privado.
  const ps = [];
  for (let i = 0; i < N; i++) {
    const dir = path.join(app.casa, 'dev', 'emp', `proj-${i}`);
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com' } });
    git('init', '-q'); git('add', '.keep'); git('commit', '-q', '-m', 'primeiro');
    const p = PLANO[i];
    if (p.sinal) {
      // Arquivo de eventos de tamanho realista: 400 eventos de ~1 KB, o último é o que vale.
      const linhas = [];
      const ts = Date.now();
      linhas.push(JSON.stringify({ ts: ts - 900000, evento: 'SessionStart', sessao: `s-${i}`, model: 'claude-opus-5-5' }));
      for (let k = 0; k < 400; k++) linhas.push(JSON.stringify({ ts: ts - 800000 + k * 1000, evento: 'PostToolUse', tool_name: 'Edit', resumo: 'x'.repeat(900) }));
      linhas.push(JSON.stringify({ ts, evento: p.sinal, last_assistant_message: 'ok' }));
      fs.mkdirSync(path.join(dir, '.orq', 'eventos'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.orq', 'eventos', 's.jsonl'), linhas.join('\n') + '\n');
    }
    const tela = TELAS[p.tela || 'esperando'];
    tmux('new-session', '-d', '-s', `agente-${i}`, '-x', '120', '-y', '40', '-c', dir, '--', 'bash', agenteSh, tela, String(i + 1));
    ps.push(`orq-falso-${i}\t${dir}`);
  }
  fs.writeFileSync(path.join(area, 'docker-ps.txt'), ps.join('\n') + '\n');

  // Espera o app enxergar os 10 (a tela pergunta de 2 em 2 s).
  let r = null;
  for (let k = 0; k < 40; k++) { r = await retrato(); if (r.frentes.length === N) break; await espera(500); }
  assert.strictEqual(r.frentes.length, N, 'o app deve ver os 10 agentes falsos');
  await espera(2500); // deixa o cache do git e do modelo esquentarem

  // Fase 2: 10 agentes.
  await snap(true);
  await espera(SEGUNDOS * 1000);
  const cheio = await snap();
  r = await retrato();

  // Estado mostrado de cada agente: o esperado, com o modelo do container.
  const porProj = Object.fromEntries(r.frentes.map((f) => [f.proj, f]));
  for (let i = 0; i < N; i++) {
    const f = porProj[`proj-${i}`];
    assert.ok(f, `proj-${i} sem agente`);
    assert.strictEqual(f.estado, PLANO[i].esperado, `estado de proj-${i}`);
    assert.strictEqual(f.fonte, PLANO[i].sinal ? 'sinal' : 'tela', `fonte de proj-${i}`);
    assert.strictEqual(f.nome, `Agente ${i + 1}`);
    assert.strictEqual(f.modeloAgente, 'Opus 5.5', `modelo de proj-${i}`);
    assert.strictEqual(f.git.commits20h, 1, `git de proj-${i}`);
    assert.strictEqual(f.git.assunto, 'primeiro');
  }

  const numeros = { agentes0: vazio, agentes10: cheio, segundos: { vazio: SEGUNDOS_VAZIO, cheio: SEGUNDOS } };
  console.log('# medidas', JSON.stringify(numeros));
  if (process.env.ORQ_MEDIDAS_SAIDA) fs.appendFileSync(process.env.ORQ_MEDIDAS_SAIDA, JSON.stringify(numeros) + '\n');

  // Orçamento: o laço do processo principal não trava mais que 100 ms (p99).
  // O p99 por amostra deixa passar um travamento de 300 ms a cada 2 s (é 1 amostra
  // de cada 200); por isso vale também o p99 ponderado pelo tempo (ver medidor.js).
  const resumo = `p50 ${cheio.laco.p50}, p99 ${cheio.laco.p99}, p99 ponderado ${cheio.laco.p99Ponderado}, máx ${cheio.laco.max}, travado ${cheio.laco.porcentoDoTempoTravado} % do tempo`;
  assert.ok(cheio.laco.p99 <= 100, `atraso do laço p99 acima de 100 ms: ${resumo}`);
  assert.ok(cheio.laco.p99Ponderado <= 100, `atraso do laço (p99 ponderado pelo tempo) acima de 100 ms: ${resumo}`);
});
