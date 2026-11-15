// Abre o terminal de verdade de uma frente numa janela do sistema, como o
// `orq tv` faz. ignore-size: anexar não encolhe as janelas que já estão abertas.
//
// spawn de um programa que não existe não lança na hora: o ENOENT chega depois,
// no evento 'error'. Por isso cada candidato só conta como aberto quando o
// evento 'spawn' chega; com 'error', tenta o próximo. Nenhum: false (a tela
// avisa em vez de dizer que abriu).
const { spawn } = require('child_process');

const CANDIDATOS = ['gnome-terminal', 'kgx', 'x-terminal-emulator', 'xterm'];

function tentar(programa, args, env) {
  return new Promise((ok) => {
    let p;
    try { p = spawn(programa, args, { detached: true, stdio: 'ignore', env }); } catch { ok(false); return; }
    p.once('spawn', () => { p.unref(); ok(true); });
    p.once('error', () => ok(false));
  });
}

async function abrir(sessao, { candidatos = CANDIDATOS, env = process.env } = {}) {
  if (typeof sessao !== 'string' || !/^[\w.-]+$/.test(sessao)) return false;
  for (const t of candidatos) {
    if (await tentar(t, ['--', 'tmux', 'attach', '-f', 'ignore-size', '-t', sessao], env)) return true;
  }
  return false;
}

module.exports = { abrir, CANDIDATOS };
