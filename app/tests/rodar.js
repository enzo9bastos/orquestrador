#!/usr/bin/env node
// Roda os testes do app, por área.
//   npm test                    tudo
//   npm test -- notas           só a área "notas" (unidade + tela)
//   npm test -- notas janela    várias áreas
//   npm test -- --so-unidade    sem abrir o app
//   npm test -- --rapido        pula os arquivos marcados [lento]
//   npm test -- --lento         só os arquivos marcados [lento]
//   npm test -- --trabalhadores=4   quantos testes de tela ao mesmo tempo
// Cada arquivo diz a área na primeira linha ("// Área: notas"). Na mesma linha
// podem vir as marcas [lento] (pulado no --rapido) e [sozinho] (nunca roda ao
// lado de outro teste de tela: mede tempo, ou depende da posição de janela na
// tela). Os testes de tela abrem o app de verdade numa casa temporária (HOME
// falso), nunca nos arquivos reais, e conversam com ele pelo DevTools.
//
// Tela virtual: os testes de tela nunca abrem janela na tela de verdade. Fora
// de uma tela virtual (Xvfb), o próprio npm test se reexecuta dentro do
// `xvfb-run -a`; sem o xvfb-run, para e diz como instalar. ORQ_TESTE_NA_TELA=1
// deixa rodar na tela real (para depurar olhando).
//
// Paralelo: cada arquivo roda no seu processo, com a própria casa e a própria
// porta. Os de tela rodam N por vez (padrão pelos núcleos da máquina; ou
// --trabalhadores=N / ORQ_TESTE_TRABALHADORES=N); os [sozinho] rodam depois,
// um de cada vez. No fim saem o resumo e os 10 arquivos mais lentos.
// O código de saída é 0 só se tudo passou.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const args = process.argv.slice(2);
const soUnidade = args.includes('--so-unidade');
const rapido = args.includes('--rapido');
const soLentos = args.includes('--lento');
const areas = args.filter((a) => !a.startsWith('--'));
const primeiraLinha = (arq) => fs.readFileSync(arq, 'utf8').split('\n', 1)[0];
const area = (arq) => (fs.readFileSync(arq, 'utf8').match(/^\/\/ Área: (\S+)/m) || [])[1] || '';
const marca = (arq, m) => primeiraLinha(arq).includes(`[${m}]`);
const escolhe = (arq) => (!areas.length || areas.includes(area(arq)))
  && !(rapido && marca(arq, 'lento')) && !(soLentos && !marca(arq, 'lento'));

const pasta = (p) => path.join(__dirname, p);
const unidade = fs.readdirSync(pasta('unit')).filter((f) => f.endsWith('.test.js')).sort().map((f) => pasta(`unit/${f}`)).filter(escolhe);
const tela = fs.readdirSync(pasta('e2e')).filter((f) => f.endsWith('.e2e.js')).sort().map((f) => pasta(`e2e/${f}`)).filter(escolhe);

let electron = null;
try { electron = require(path.join(__dirname, '..', 'node_modules', 'electron')); } catch { /* sem electron instalado */ }
const vaiAbrirApp = !soUnidade && tela.length > 0 && !!electron && fs.existsSync(electron);

// ── Tela virtual ────────────────────────────────────────────────────────────
// Estamos numa tela virtual? O DISPLAY aponta para um Xvfb: o arquivo de trava
// do X (/tmp/.X<n>-lock) diz o processo do servidor, e ele tem de ser o Xvfb.
function telaVirtual(env = process.env) {
  const n = (String(env.DISPLAY || '').match(/^:(\d+)(\.\d+)?$/) || [])[1];
  if (n === undefined) return false;
  try {
    const pid = Number(fs.readFileSync(`/tmp/.X${n}-lock`, 'utf8').trim());
    return pid > 0 && fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'Xvfb';
  } catch { return false; }
}
const noPath = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => { try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch { return false; } });

const ambiente = { ...process.env };
// A configuração (e o login) do Claude e do Codex de quem roda os testes nunca
// chega aos testes: sem estas variáveis, cada teste usa a da casa falsa dele.
delete ambiente.CLAUDE_CONFIG_DIR;
delete ambiente.CODEX_HOME;
if (vaiAbrirApp) {
  if (process.env.ORQ_TESTE_NA_TELA === '1') {
    console.log('\n== tela REAL (ORQ_TESTE_NA_TELA=1): janelas e caixas de erro podem aparecer na sua tela ==');
  } else if (!telaVirtual()) {
    if (process.env.ORQ_TESTE_REEXECUTADO === '1') {
      console.error('\nO xvfb-run abriu, mas a tela dele não é um Xvfb: parei para não abrir janela na sua tela.');
      process.exit(1);
    }
    if (!noPath('xvfb-run')) {
      console.error([
        '',
        'Os testes de tela rodam numa tela virtual (Xvfb), para nunca abrir janela na sua tela,',
        'e o xvfb-run não está instalado. Instale e rode de novo:',
        '  Debian/Ubuntu:  sudo apt install xvfb',
        '  Fedora:         sudo dnf install xorg-x11-server-Xvfb',
        '  Arch:           sudo pacman -S xorg-server-xvfb',
        'Só os testes de unidade:  npm test -- --so-unidade',
        'Na tela real, de propósito (depuração):  ORQ_TESTE_NA_TELA=1 npm test',
      ].join('\n'));
      process.exit(1);
    }
    console.log('\n== fora de tela virtual: rodando de novo dentro do xvfb-run -a ==');
    const env = { ...process.env, ORQ_TESTE_REEXECUTADO: '1' };
    delete env.WAYLAND_DISPLAY; // sem isto, o Electron pode desenhar na sessão Wayland de verdade
    const r = spawnSync('xvfb-run', ['-a', process.execPath, __filename, ...args], { stdio: 'inherit', env });
    process.exit(r.status === null ? 1 : r.status);
  }
  // Dentro da tela virtual, nada pode ir para a sessão Wayland do usuário.
  if (process.env.ORQ_TESTE_NA_TELA !== '1') delete ambiente.WAYLAND_DISPLAY;
}

// ── Execução ────────────────────────────────────────────────────────────────
const nucleos = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
// Testes de tela: metade dos núcleos (cada app de teste é um Electron inteiro), entre 2 e 8.
const trabalhadoresPadrao = Math.max(2, Math.min(8, Math.floor(nucleos / 2)));
const pedido = Number((args.find((a) => a.startsWith('--trabalhadores=')) || '').split('=')[1] || process.env.ORQ_TESTE_TRABALHADORES);
const trabalhadores = Number.isInteger(pedido) && pedido > 0 ? pedido : trabalhadoresPadrao;

const semCor = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const CONTAS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
// Os números do resumo do reporter "spec" (ℹ tests 12, ℹ pass 12...).
function contas(saida) {
  const c = {};
  for (const k of CONTAS) c[k] = Number((semCor(saida).match(new RegExp(`^ℹ ${k} (\\d+)$`, 'm')) || [])[1] || 0);
  return c;
}

const resultados = [];
const rodando = new Set();
function rodarArquivo(arq, env) {
  return new Promise((ok) => {
    const inicio = Date.now();
    const vivo = { arq, inicio };
    rodando.add(vivo);
    const p = spawn(process.execPath, ['--test', '--test-reporter=spec', arq], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    p.on('close', (codigo, sinal) => {
      rodando.delete(vivo);
      const r = { arq, rel: path.relative(__dirname, arq), inicio, fim: Date.now(), ms: Date.now() - inicio, codigo: codigo === null ? 1 : codigo, sinal, saida, contas: contas(saida) };
      resultados.push(r);
      const s = (r.ms / 1000).toFixed(1);
      // Em falha, quem rodava ao mesmo tempo (para achar teste que só falha em paralelo).
      const juntos = r.codigo === 0 ? [] : [...resultados.filter((o) => o !== r), ...rodando].filter((o) => o.arq !== arq && o.inicio < r.fim && (o.fim || Infinity) > r.inicio).map((o) => path.relative(__dirname, o.arq));
      process.stdout.write(`\n── ${r.rel} (${s} s) ${r.codigo === 0 ? 'ok' : `FALHOU (código ${r.codigo}${sinal ? `, ${sinal}` : ''})`} ──\n${saida.replace(/\s+$/, '')}\n`);
      if (juntos.length) process.stdout.write(`rodando ao mesmo tempo: ${juntos.join(', ')}\n`);
      ok(r);
    });
  });
}

async function emFila(arquivos, n, env) {
  const fila = [...arquivos];
  const um = async () => { while (fila.length) await rodarArquivo(fila.shift(), env); };
  await Promise.all(Array.from({ length: Math.min(n, fila.length) }, um));
}

function somar(lista) {
  const t = Object.fromEntries(CONTAS.map((k) => [k, 0]));
  for (const r of lista) for (const k of CONTAS) t[k] += r.contas[k];
  return t;
}
const relogio = (ms) => `${Math.floor(ms / 60000)} min ${((ms % 60000) / 1000).toFixed(1)} s`;

(async () => {
  const inicio = Date.now();
  const fases = [];
  if (unidade.length) {
    console.log(`\n== unidade (${unidade.length} arquivo(s), ${Math.max(1, nucleos - 1)} por vez) ==`);
    const t0 = Date.now();
    await emFila(unidade, Math.max(1, nucleos - 1), ambiente);
    fases.push({ nome: 'unidade', ms: Date.now() - t0, arquivos: unidade });
  }
  if (soUnidade || !tela.length) {
    // nada de tela pedido
  } else if (!vaiAbrirApp) {
    console.log('\n== tela: PULADO (Electron não instalado aqui; rode na pasta que tem o app instalado) ==');
  } else {
    const env = { ...ambiente, ORQ_ELECTRON: electron };
    const juntos = tela.filter((a) => !marca(a, 'sozinho'));
    const sozinhos = tela.filter((a) => marca(a, 'sozinho'));
    if (juntos.length) {
      console.log(`\n== tela (${juntos.length} arquivo(s), ${Math.min(trabalhadores, juntos.length)} por vez; ${nucleos} núcleos) ==`);
      const t0 = Date.now();
      await emFila(juntos, trabalhadores, env);
      fases.push({ nome: `tela, ${Math.min(trabalhadores, juntos.length)} por vez`, ms: Date.now() - t0, arquivos: juntos });
    }
    if (sozinhos.length) {
      console.log(`\n== tela, um por vez (${sozinhos.length} arquivo(s) marcados [sozinho]) ==`);
      const t0 = Date.now();
      await emFila(sozinhos, 1, env);
      fases.push({ nome: 'tela, um por vez', ms: Date.now() - t0, arquivos: sozinhos });
    }
  }

  const falhas = resultados.filter((r) => r.codigo !== 0);
  console.log('\n== resumo ==');
  for (const f of fases) {
    const t = somar(resultados.filter((r) => f.arquivos.includes(r.arq)));
    console.log(`${f.nome}: ${f.arquivos.length} arquivo(s), ${t.tests} testes: ${t.pass} passaram, ${t.fail} falharam, ${t.cancelled} cancelados, ${t.skipped} pulados, ${t.todo} pendentes (todo) — ${relogio(f.ms)}`);
  }
  console.log('10 arquivos mais lentos:');
  for (const r of [...resultados].sort((a, b) => b.ms - a.ms).slice(0, 10)) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${r.rel}`);
  console.log(`tempo total: ${relogio(Date.now() - inicio)}`);
  if (falhas.length) console.log(`FALHARAM: ${falhas.map((r) => r.rel).join(', ')}`);
  process.exit(falhas.length ? 1 : 0);
})();
