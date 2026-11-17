// "!" da caixa de texto: o comando que o USUÁRIO digitou roda no computador dele,
// na pasta da conversa, como rodaria num terminal. Este módulo só executa: quem
// decide se pode rodar é quem chama (main.js só aceita o pedido vindo do Enter
// da caixa; nada que chegue por recado, workflow, atalho ou pelo modelo passa
// por aqui).
//
// O que ele garante:
// - roda pelo shell do usuário, sem terminal ligado e sem entrada (não fica
//   esperando resposta de teclado);
// - pasta e ambiente são os de quem chama (o ambiente das conversas, já sem as
//   credenciais do cofre);
// - saída e erro cortados no limite, dizendo quantos caracteres ficaram de fora;
// - tempo limite e "parar" encerram o grupo inteiro de processos (o comando e os
//   filhos que ele deixou em segundo plano);
// - o texto que vai ao modelo usa a mesma marcação do Claude Code no terminal
//   (<bash-input>, <bash-stdout>, <bash-stderr>) e a saída do comando não
//   consegue se passar por essa marcação.
const fs = require('fs');
const { spawn } = require('child_process');

const LIMITE = 30000; // caracteres de cada saída
const TEMPO = 120000; // 2 minutos
const MAX_COMANDO = 20000;

function conferirComando(comando) {
  if (typeof comando !== 'string' || !comando.trim()) throw new Error('comando vazio');
  if (comando.length > MAX_COMANDO || comando.includes('\0')) throw new Error('comando inválido (grande demais ou com byte nulo)');
}
function conferir(comando, cwd) {
  conferirComando(comando);
  let st = null;
  try { st = fs.statSync(cwd); } catch { /* cai no erro abaixo */ }
  if (!st || !st.isDirectory()) throw new Error('a pasta da conversa não existe mais');
}

// Devolve { fim: Promise<resultado>, parar() }. resultado:
// { comando, saida, erro, cortado: { saida, erro }, codigo, sinal, tempoEsgotado, parado, ms }
function rodar(comando, { cwd, env = process.env, tempo = TEMPO, limite = LIMITE } = {}) {
  conferir(comando, cwd);
  const t0 = Date.now();
  const filho = spawn(env.SHELL || '/bin/sh', ['-c', comando], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = { comando, saida: '', erro: '', cortado: { saida: 0, erro: 0 }, codigo: null, sinal: null, tempoEsgotado: false, parado: false, ms: 0 };
  const junta = (campo) => (d) => {
    const s = d.toString('utf8');
    const cabe = Math.max(0, limite - r[campo].length);
    r[campo] += s.slice(0, cabe);
    r.cortado[campo] += s.length - Math.min(s.length, cabe);
  };
  filho.stdout.on('data', junta('saida'));
  filho.stderr.on('data', junta('erro'));
  // O grupo inteiro: o shell e o que ele deixou rodando.
  const matar = (sinal) => { try { process.kill(-filho.pid, sinal); } catch { try { filho.kill(sinal); } catch { /* já saiu */ } } };
  let tForca = null;
  const encerrar = () => { matar('SIGTERM'); tForca = setTimeout(() => matar('SIGKILL'), 1500); if (tForca.unref) tForca.unref(); };
  const tTempo = setTimeout(() => { r.tempoEsgotado = true; encerrar(); }, tempo);
  const fim = new Promise((ok) => {
    let feito = false;
    const fechar = (codigo, sinal) => {
      if (feito) return;
      feito = true;
      clearTimeout(tTempo);
      // Filho que ficou em segundo plano depois de o comando terminar sozinho continua
      // (como num terminal); com tempo esgotado ou parado, o grupo já foi encerrado.
      r.codigo = typeof codigo === 'number' ? codigo : null;
      r.sinal = sinal || null;
      r.ms = Date.now() - t0;
      ok(r);
    };
    filho.on('error', (e) => { r.erro += `${r.erro ? '\n' : ''}não consegui rodar: ${e.message}`; fechar(null, null); });
    // 'exit' (e não 'close'): um filho em segundo plano que herdou a saída não segura a resposta.
    filho.on('exit', (codigo, sinal) => setTimeout(() => fechar(codigo, sinal), 30));
  });
  return { fim, parar: () => { if (!r.tempoEsgotado) r.parado = true; encerrar(); } };
}

// A saída de um comando é texto qualquer: o que parecer marcação nossa perde o "<".
const semMarca = (s) => String(s || '').replace(/<(\/?bash-(?:input|stdout|stderr)\b)/g, '&lt;$1');
const sufixos = (r, campo) => [
  r.cortado && r.cortado[campo] ? `[cortado: ${r.cortado[campo]} caracteres]` : '',
].filter(Boolean);
// O que o modelo recebe, junto com a próxima mensagem do usuário.
function paraOModelo(r) {
  const estado = [r.tempoEsgotado ? '[tempo esgotado: o comando foi encerrado]' : '', r.parado ? '[parado pelo usuário]' : '',
    typeof r.codigo === 'number' && r.codigo !== 0 ? `[código de saída ${r.codigo}]` : ''].filter(Boolean);
  const bloco = (texto, extras) => [semMarca(texto).replace(/\n+$/, ''), ...extras].filter((x) => x !== '').join('\n');
  return `<bash-input>${semMarca(r.comando)}</bash-input>\n<bash-stdout>${bloco(r.saida, sufixos(r, 'saida'))}</bash-stdout><bash-stderr>${bloco(r.erro, [...sufixos(r, 'erro'), ...estado])}</bash-stderr>`;
}
// O caminho de volta, para a tela desenhar uma mensagem que veio do histórico: os
// blocos de comando do começo do texto e o resto (o que o usuário escreveu).
const BLOCO = /^<bash-input>([\s\S]*?)<\/bash-input>\n<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>\n*/;
const comMarca = (s) => String(s || '').replace(/&lt;(\/?bash-(?:input|stdout|stderr)\b)/g, '<$1');
function separar(texto) {
  let resto = String(texto || '');
  const blocos = [];
  for (let m = BLOCO.exec(resto); m; m = BLOCO.exec(resto)) {
    blocos.push({ comando: comMarca(m[1]), saida: comMarca(m[2]), erro: comMarca(m[3]) });
    resto = resto.slice(m[0].length);
  }
  return { blocos, resto };
}

module.exports = { rodar, conferirComando, paraOModelo, separar, LIMITE, TEMPO };
