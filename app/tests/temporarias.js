// Pastas temporárias dos testes, sem sobras: toda pasta que um teste cria em
// /tmp passa por pastaTemporaria(), que anota quem a criou. Quando o processo
// do arquivo de teste termina, apaga as pastas dos testes que PASSARAM; a de um
// teste que falhou fica, e o caminho sai na saída (stderr) para quem for
// investigar. ORQ_TESTE_GUARDAR=1 guarda todas.
//
// A limpeza só remove o que este processo criou: a pasta tem de estar na lista
// dele, ficar direto na pasta temporária do sistema, ter o prefixo "orq-",
// ser uma pasta de verdade (não um link) do mesmo usuário, e o caminho real
// tem de ser o anotado. Qualquer coisa diferente fica onde está.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.realpathSync(os.tmpdir());
const PREFIXO = /^orq-[\w.-]+$/;
const guardarTudo = () => process.env.ORQ_TESTE_GUARDAR === '1';

// Quem criou cada pasta: o teste em andamento (o mais de dentro), ou o arquivo
// (pasta criada fora de qualquer teste, no começo do arquivo).
const ARQUIVO = { nome: '(começo do arquivo)', falhou: false };
const pilha = [];
const criadas = new Map(); // caminho real → dono

function pastaTemporaria(prefixo) {
  if (!PREFIXO.test(`${prefixo}x`)) throw new Error(`prefixo de pasta temporária fora do padrão "orq-…": ${prefixo}`);
  const dir = fs.mkdtempSync(path.join(RAIZ, prefixo));
  criadas.set(dir, pilha[pilha.length - 1] || ARQUIVO);
  return dir;
}

// A pasta pode ser apagada? Todas as conferências, nenhuma a menos.
function podeApagar(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !criadas.has(dir)) return false;
  if (path.dirname(dir) !== RAIZ || !PREFIXO.test(path.basename(dir))) return false;
  let st;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
  try { if (fs.realpathSync(dir) !== dir) return false; } catch { return false; }
  return true;
}

function apagar(dir) {
  if (!podeApagar(dir)) return false;
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (e) {
    process.stderr.write(`# não consegui apagar a pasta temporária ${dir}: ${e.message}\n`);
    return false;
  }
  criadas.delete(dir);
  return true;
}

// No fim do processo: process.exitCode já diz se houve falha de verdade (um
// teste "todo" que falha não conta). Sem falha, nada fica; com falha, fica o
// que é do teste que falhou e o que foi criado fora de teste.
function limparNaSaida() {
  const falhouArquivo = !!process.exitCode;
  for (const [dir, dono] of [...criadas]) {
    const ficar = guardarTudo() || (falhouArquivo && (dono.falhou || dono === ARQUIVO));
    if (ficar) process.stderr.write(`# pasta temporária guardada${guardarTudo() ? '' : ' (teste falhou)'}: ${dir} — ${dono.nome}\n`);
    else apagar(dir);
  }
}

// Só no processo de um arquivo de teste (node --test arquivo.test.js ou
// .e2e.js): um script avulso que carrega os ajudantes não ganha ganchos.
if (/\.(test|e2e)\.js$/.test(process.argv[1] || '')) {
  const { beforeEach, afterEach } = require('node:test');
  beforeEach((t) => { pilha.push({ nome: t.fullName || t.name, falhou: false }); });
  // Falha de um subteste conta também para os de fora (o pai falha depois).
  afterEach((t) => {
    const dono = pilha.pop();
    if (dono && !t.passed) { dono.falhou = true; for (const d of pilha) d.falhou = true; }
  });
  process.on('exit', limparNaSaida);
}

module.exports = { pastaTemporaria, podeApagar, RAIZ };
