// Leitor de arquivos .jsonl (transcripts do Claude, recados, eventos): nunca
// lê o arquivo inteiro quando só precisa do começo, do fim ou do que entrou
// desde a última vez. Uma linha cortada na borda de um pedaço nunca vira JSON
// quebrado: o pedaço só entrega linhas inteiras (o resto fica para o próximo).
const fs = require('fs');

const PAGINA = 256 * 1024;
// Contadores para os testes e a medição ("releituras completas" = 0).
const estatisticas = { completas: 0, bytesLidos: 0 };

function lerFaixa(fd, ini, fim) {
  const n = Math.max(0, fim - ini);
  const buf = Buffer.allocUnsafe(n);
  let got = 0;
  while (got < n) {
    const r = fs.readSync(fd, buf, got, n - got, ini + got);
    if (r <= 0) break;
    got += r;
  }
  estatisticas.bytesLidos += got;
  return got === n ? buf : buf.subarray(0, got);
}

const NL = 0x0a;
// Linhas inteiras de um pedaço de bytes que começa em `ini` do arquivo.
// descartaInicio: o pedaço pode começar no meio de uma linha (ini > 0).
// descartaFim: o pedaço pode terminar no meio de uma linha.
function linhasDe(buf, { descartaInicio, descartaFim }) {
  let a = 0;
  let b = buf.length;
  if (descartaInicio) { const i = buf.indexOf(NL); if (i < 0) return []; a = i + 1; }
  if (descartaFim) { const i = buf.lastIndexOf(NL); if (i < a) return []; b = i; }
  if (b <= a) return [];
  return buf.toString('utf8', a, b).split('\n').filter((l) => l !== '');
}

// As últimas linhas inteiras que cabem nos últimos `bytes` do arquivo.
function lerFim(arq, bytes = 64 * 1024) {
  let fd;
  try { fd = fs.openSync(arq, 'r'); } catch { return { linhas: [], tamanho: 0, inicio: 0, completo: true }; }
  try {
    const tamanho = fs.fstatSync(fd).size;
    const ini = Math.max(0, tamanho - bytes);
    const buf = lerFaixa(fd, ini, tamanho);
    // O fim do arquivo é fim de verdade: uma última linha sem \n continua valendo.
    return { linhas: linhasDe(buf, { descartaInicio: ini > 0, descartaFim: false }), tamanho, inicio: ini, completo: ini === 0 };
  } finally { fs.closeSync(fd); }
}

// As primeiras linhas inteiras dentro dos primeiros `bytes` do arquivo.
function lerCabeca(arq, bytes = 64 * 1024) {
  let fd;
  try { fd = fs.openSync(arq, 'r'); } catch { return { linhas: [], tamanho: 0, completo: true }; }
  try {
    const tamanho = fs.fstatSync(fd).size;
    const fim = Math.min(tamanho, bytes);
    const buf = lerFaixa(fd, 0, fim);
    return { linhas: linhasDe(buf, { descartaInicio: false, descartaFim: fim < tamanho }), tamanho, completo: fim >= tamanho };
  } finally { fs.closeSync(fd); }
}

// Linhas do arquivo de trás para frente (da mais nova à mais antiga), em
// páginas de `pagina` bytes. `ate`: só vale o que está antes deste deslocamento
// (o fim de uma linha). Devolve um gerador de { linha, fim } (fim = deslocamento
// logo depois da linha), então quem quebra o laço não paga pelo resto do arquivo.
function* linhasDeTras(arq, { pagina = PAGINA, ate = null } = {}) {
  let fd;
  try { fd = fs.openSync(arq, 'r'); } catch { return; }
  try {
    const tamanho = fs.fstatSync(fd).size;
    let pos = ate == null ? tamanho : Math.min(ate, tamanho);
    let resto = Buffer.alloc(0); // começo de linha cuja ponta antiga ainda não foi lida
    while (pos > 0) {
      const ini = Math.max(0, pos - pagina);
      const buf = lerFaixa(fd, ini, pos);
      pos = ini; // juntado[k] está no deslocamento pos + k do arquivo
      const juntado = resto.length ? Buffer.concat([buf, resto]) : buf;
      let fimLinha = juntado.length;
      let i = juntado.lastIndexOf(NL, fimLinha - 1);
      while (i >= 0) {
        if (fimLinha > i + 1) yield { linha: juntado.toString('utf8', i + 1, fimLinha), fim: pos + fimLinha };
        fimLinha = i;
        i = fimLinha > 0 ? juntado.lastIndexOf(NL, fimLinha - 1) : -1;
      }
      resto = juntado.subarray(0, fimLinha);
    }
    if (resto.length) yield { linha: resto.toString('utf8'), fim: resto.length };
  } finally { fs.closeSync(fd); }
}

// Deslocamento do fim da linha mais nova que contém `trecho` (ou null).
function fimDaLinhaCom(arq, trecho, opcoes = {}) {
  for (const { linha, fim } of linhasDeTras(arq, opcoes)) if (linha.includes(trecho)) return fim;
  return null;
}

// Leitor incremental: guarda arquivo, tamanho e deslocamento e entrega só as
// linhas que entraram desde a última chamada. Arquivo truncado, trocado ou
// reescrito recomeça do zero (`recomecou: true`). Uma última linha ainda sem \n
// espera a próxima chamada, a não ser que já seja um JSON completo.
function incremental(arq, { semJson = false } = {}) {
  let ino = null;
  let offset = 0;
  let cabeca = '';
  function ler() {
    let fd;
    try { fd = fs.openSync(arq, 'r'); } catch { const era = offset > 0; ino = null; offset = 0; cabeca = ''; return { linhas: [], recomecou: era }; }
    try {
      const st = fs.fstatSync(fd);
      const cab = lerFaixa(fd, 0, Math.min(st.size, 64)).toString('latin1');
      let recomecou = false;
      if (offset > 0 && (st.ino !== ino || st.size < offset || !cab.startsWith(cabeca))) { offset = 0; recomecou = true; }
      ino = st.ino;
      cabeca = cab;
      if (offset === 0) estatisticas.completas++;
      if (st.size === offset) return { linhas: [], recomecou };
      const buf = lerFaixa(fd, offset, st.size);
      const ult = buf.lastIndexOf(NL);
      let usados = ult + 1;
      let texto = ult >= 0 ? buf.toString('utf8', 0, ult) : null;
      // Última linha sem \n: vale só se já é um JSON inteiro (então avança).
      if (usados < buf.length && !semJson) {
        const cauda = buf.toString('utf8', usados);
        try { JSON.parse(cauda); texto = texto == null ? cauda : texto + '\n' + cauda; usados = buf.length; } catch { /* ainda sendo escrita */ }
      }
      offset += usados;
      return { linhas: texto == null ? [] : texto.split('\n').filter((l) => l !== ''), recomecou };
    } finally { fs.closeSync(fd); }
  }
  return { ler, deslocamento: () => offset };
}

module.exports = { lerFim, lerCabeca, linhasDeTras, fimDaLinhaCom, incremental, estatisticas, PAGINA };
