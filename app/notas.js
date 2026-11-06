// Notas: as pastas de Markdown que o editor do app abre (config.pastasNotas).
//
// Salvar por cima de um arquivo apaga o que estava lá, então toda gravação
// guarda antes a versão anterior em ~/.local/share/orq-app/versoes/ (nenhuma
// versão é apagada pelo app). E se o
// arquivo mudou por fora desde que foi aberto (um agente, outra sessão, o
// Obsidian), a gravação não acontece: volta como conflito para a tela decidir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const VERSOES = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes');
const MAX_ARQUIVOS = 3000;
const casa = (p) => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

// Lista de pastas: config.pastasNotas ([{nome, caminho}]); sem ela, a
// pastaNotas da orquestração.
function listaConfigurada() {
  const c = config.ler();
  let lista = Array.isArray(c.pastasNotas) && c.pastasNotas.length ? c.pastasNotas : [];
  if (!lista.length && c.pastaNotas) lista = [{ nome: 'Notas', caminho: c.pastaNotas }];
  return lista;
}
function pastas() {
  const lista = listaConfigurada();
  return lista.map((p) => ({ nome: p.nome || path.basename(casa(p.caminho)), caminho: casa(p.caminho) }))
    .filter((p) => p.caminho && fs.existsSync(p.caminho));
}

// Caminho absoluto de um arquivo dentro da pasta i, recusando sair dela.
function resolver(i, rel) {
  const p = pastas()[i];
  if (!p) throw new Error('pasta desconhecida');
  const abs = path.resolve(p.caminho, rel || '');
  if (abs !== p.caminho && !abs.startsWith(p.caminho + path.sep)) throw new Error('fora da pasta');
  return abs;
}

// Árvore só com .md (e as pastas que levam a algum .md).
function arvore(i) {
  const raiz = resolver(i, '');
  let conta = 0;
  function andar(dir, rel, nivel) {
    if (nivel > 8 || conta > MAX_ARQUIVOS) return [];
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const pastasF = [], arquivos = [];
    for (const d of itens) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        const filhos = andar(path.join(dir, d.name), r, nivel + 1);
        // Pasta entra se leva a algum .md ou se está vazia (acabou de ser criada).
        let vazia = false;
        if (!filhos.length) { try { vazia = fs.readdirSync(path.join(dir, d.name)).length === 0; } catch { /* sem acesso */ } }
        if (filhos.length || vazia) pastasF.push({ tipo: 'pasta', nome: d.name, rel: r, filhos });
      } else if (d.name.toLowerCase().endsWith('.md')) {
        conta++;
        let m = 0;
        try { m = fs.statSync(path.join(dir, d.name)).mtimeMs; } catch { /* sumiu */ }
        arquivos.push({ tipo: 'nota', nome: d.name.slice(0, -3), rel: r, mtime: m });
      }
    }
    const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });
    return [...pastasF.sort(porNome), ...arquivos.sort(porNome)];
  }
  return andar(raiz, '', 0);
}

function ler(i, rel) {
  const abs = resolver(i, rel);
  return { conteudo: fs.readFileSync(abs, 'utf8'), mtime: fs.statSync(abs).mtimeMs, bytes: fs.statSync(abs).size };
}

function pastaVersoes(abs) {
  const pasta = path.join(VERSOES, crypto.createHash('sha1').update(abs).digest('hex').slice(0, 16));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'caminho.txt'), abs + '\n');
  return pasta;
}
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-');

function guardarVersao(abs) {
  if (!fs.existsSync(abs)) return;
  fs.copyFileSync(abs, path.join(pastaVersoes(abs), `${carimbo()}.md`));
}

// mtimeBase: o mtime de quando a tela abriu o arquivo. Diferente = mudou por fora.
function gravar(i, rel, conteudo, mtimeBase) {
  const abs = resolver(i, rel);
  if (fs.existsSync(abs)) {
    const atual = fs.statSync(abs).mtimeMs;
    if (mtimeBase != null && Math.abs(atual - mtimeBase) > 1) {
      return { conflito: true, conteudo: fs.readFileSync(abs, 'utf8'), mtime: atual };
    }
    guardarVersao(abs);
  }
  const tmp = `${abs}.orq-tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, abs);
  return { mtime: fs.statSync(abs).mtimeMs };
}

// Texto que não chegou a ser salvo no arquivo (ex.: a edição de quem escolheu
// ficar com a versão de fora num conflito) vai para as versões, não some.
function guardarCopia(i, rel, texto) {
  const abs = resolver(i, rel);
  const arq = path.join(pastaVersoes(abs), `${carimbo()}-nao-salva.md`);
  fs.writeFileSync(arq, texto);
  return arq;
}

function criar(i, relPasta, nome) {
  const limpo = String(nome || '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!limpo) throw new Error('nome vazio');
  const rel = (relPasta ? `${relPasta}/` : '') + (limpo.toLowerCase().endsWith('.md') ? limpo : `${limpo}.md`);
  const abs = resolver(i, rel);
  if (fs.existsSync(abs)) return { rel, existia: true };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // O título da nota é o nome do arquivo (mostrado grande pelo editor).
  fs.writeFileSync(abs, '');
  return { rel };
}

// Um arquivo vigiado por vez: o que está aberto no editor.
let vigia = null;
function vigiar(i, rel, avisar) {
  if (vigia) { vigia.close(); vigia = null; }
  if (rel == null) return;
  const abs = resolver(i, rel);
  let espera;
  try {
    vigia = fs.watch(abs, () => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        try { avisar({ i, rel, mtime: fs.statSync(abs).mtimeMs }); } catch { /* sumiu */ }
      }, 200);
    });
  } catch { vigia = null; }
}

function criarPasta(i, relPai, nome) {
  const limpo = String(nome || '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!limpo) throw new Error('nome vazio');
  const rel = (relPai ? `${relPai}/` : '') + limpo;
  const abs = resolver(i, rel);
  if (fs.existsSync(abs)) return { rel, existia: true };
  fs.mkdirSync(abs, { recursive: true });
  return { rel };
}

// Renomear nunca sobrescreve: se já existe algo com o nome novo, recusa.
function renomear(i, rel, novoNome) {
  const abs = resolver(i, rel);
  const ehNota = rel.toLowerCase().endsWith('.md');
  const limpo = String(novoNome || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\.md$/i, '');
  if (!limpo) throw new Error('nome vazio');
  const relNovo = path.posix.join(path.posix.dirname(rel), ehNota ? `${limpo}.md` : limpo).replace(/^\.\//, '');
  const absNovo = resolver(i, relNovo);
  if (absNovo === abs) return { rel };
  if (fs.existsSync(absNovo)) return { erro: 'Já existe um arquivo ou pasta com esse nome aqui.' };
  fs.renameSync(abs, absNovo);
  return { rel: relNovo };
}
const caminho = (i, rel) => resolver(i, rel || '');

// Imagem colada ou arrastada numa nota: vira arquivo novo em anexos/, ao lado
// da nota (nunca sobrescreve), e a nota guarda o caminho relativo.
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
function salvarImagem(i, relNota, base64, tipo) {
  const ext = EXT[tipo];
  if (!ext) throw new Error('tipo de imagem não aceito');
  const dados = Buffer.from(String(base64), 'base64');
  if (dados.length > 15 * 1024 * 1024) throw new Error('imagem acima de 15 MB');
  const dirNota = path.posix.dirname(relNota);
  const base = path.posix.basename(relNota).replace(/\.md$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'nota';
  let nome, n = 0;
  do { nome = `${base}-${Date.now()}${n ? `-${n}` : ''}.${ext}`; n++; } while (fs.existsSync(resolver(i, path.posix.join(dirNota, 'anexos', nome))));
  const abs = resolver(i, path.posix.join(dirNota, 'anexos', nome));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, dados, { flag: 'wx' });
  return `anexos/${nome}`;
}

// Acrescentar/tirar pasta só mexe na lista da configuração; nada no disco.
function adicionarPasta(caminho) {
  const lista = listaConfigurada().map((p) => ({ ...p }));
  if (lista.some((p) => casa(p.caminho) === caminho)) return pastas().findIndex((p) => p.caminho === caminho);
  lista.push({ nome: path.basename(caminho), caminho });
  config.gravar({ pastasNotas: lista });
  return pastas().findIndex((p) => p.caminho === caminho);
}
function removerPasta(i) {
  const alvo = pastas()[i];
  if (!alvo) return false;
  const lista = listaConfigurada().filter((p) => casa(p.caminho) !== alvo.caminho);
  config.gravar({ pastasNotas: lista });
  return true;
}

// Caminho absoluto de uma nota existente (para a lixeira); só .md dentro da pasta.
// Pasta de notas e caminho relativo de um arquivo absoluto (a demanda que o
// painel manda abrir). null se não estiver em nenhuma pasta de notas.
function localizar(abs) {
  const lista = pastas();
  for (let i = 0; i < lista.length; i++) {
    const base = lista[i].caminho;
    if (abs.startsWith(base + path.sep)) return { i, rel: path.relative(base, abs).split(path.sep).join('/') };
  }
  return null;
}

function caminhoDaNota(i, rel) {
  const abs = resolver(i, rel);
  if (!/\.md$/i.test(abs) || !fs.statSync(abs).isFile()) throw new Error('não é uma nota');
  return abs;
}

module.exports = { localizar, caminhoDaNota, salvarImagem, adicionarPasta, removerPasta, criarPasta, renomear, caminho, pastas: () => pastas().map((p) => ({ nome: p.nome })), arvore, ler, gravar, guardarCopia, criar, vigiar };
