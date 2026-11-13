// Configuração do app: ~/.config/orq-app/config.json por cima dos padrões
// abaixo. Tudo o que depende de como cada pessoa organiza os projetos e as
// rodadas mora aqui, não no código.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ias = require('./ias');

const ARQ = path.join(os.homedir(), '.config', 'orq-app', 'config.json');

const PADRAO = {
  // Aparência (o painel de Configurações grava estas duas).
  tema: 'dark',
  idioma: 'pt-BR', // 'pt-BR' ou 'en'
  destaque: '#8b5cf6',
  mostrarBichinho: true,

  // Onde estão os projetos. niveis 1: <raiz>/<projeto>; niveis 2:
  // <raiz>/<grupo>/<projeto>. Pastas que casam com ignorar ficam de fora.
  raizProjetos: '~/projetos',
  niveis: 1,
  ignorar: '^[_.-]',

  // Projetos que dividem a memória dos agentes (.orq/memoria), além das cópias
  // do mesmo repositório git (worktrees), que já dividem sozinhas:
  // [["grupo/projeto", "grupo/projeto-copia"], ...].
  memoriaGrupos: [],

  // Pastas que o editor de notas abre: [{ "nome": "...", "caminho": "~/..." }].
  // Vazia: usa a pastaNotas abaixo.
  pastasNotas: [],

  // Pasta de notas da orquestração: <pastaNotas>/topicos.md e
  // <pastaNotas>/diario/AAAA-MM-DD.md. null esconde a aba de notas vazia.
  pastaNotas: null,

  // Comando mandado ao abrir uma rodada nova e o que encerra a rodada
  // (o botão Desligar só aparece se este existir).
  comandoInicial: null,
  comandoDesligar: null,

  // Linha do arquivo de tópicos que diz o que cada agente está fazendo.
  // Expressão regular com os grupos nomeados numero, alvo e tarefa;
  // alvo é "<grupo>/<projeto>" (niveis 2) ou "<projeto>".
  linhaTarefa: null,

  // Comando do orquestrador que dá ordem a um agente, para o bichinho dizer
  // "Agente N, sua vez!". Grupos nomeados acao e alvo.
  comandoOrdem: null,

  // Devcontainers: rótulo com a pasta do projeto no host e o nome da pasta
  // de transcripts dentro do container ({projeto} vira o nome do projeto).
  rotuloContainer: 'devcontainer.local_folder',
  pastaTranscript: '-workspace-{projeto}',

  // Repertório: o app acha sozinho o que você criou em cada ferramenta de IA
  // (Claude, Codex, Gemini, OpenCode, Windsurf, Cursor, padrão dos agentes).
  // fontesRepertorio: pastas extras de skills (cada skill = pasta com SKILL.md).
  detectarFerramentas: true,
  fontesRepertorio: [],

  // Notificações do sistema quando uma conversa do app precisa de você:
  // pedidos = pergunta ou permissão (sempre); respostas = o Claude terminou
  // de responder (só quando a janela não está em foco).
  // pedidos: pergunta/permissão de conversa do app; respostas: o orquestrador
  // terminou de responder; agentes: pedido de permissão de agente (fila);
  // ajudante: o bichinho vem à tela trazer a pergunta.
  notificacoes: { pedidos: true, respostas: true, agentes: true, ajudante: true },

  // Variáveis extras no ambiente das conversas e dos terminais do app.
  ambiente: {},

  // IAs conectadas (ias.js): qual CLI conduz o orquestrador e qual os agentes
  // novos usam. Hoje só o 'claude' está ligado; outra escolha fica guardada,
  // mas o app usa o Claude até ela ser suportada.
  iaOrquestrador: 'claude',
  iaAgentes: 'claude',
  // Caminho do executável de cada CLI, para quem instala fora do PATH:
  // { "claude": "/opt/claude/bin/claude" }. Sem entrada: acha no PATH.
  iasCaminhos: {},

  // Canal entre orquestradores de computadores diferentes (canal.js), por um
  // servidor ntfy. Desligado enquanto não houver caixa nem contato.
  // canalServidor: vazio = o default-host do arquivo do cliente do ntfy.
  // canalArquivoCliente: client.yml do ntfy, de onde sai o token (default-token).
  // canalMinhaCaixa: o tópico que só eu leio. canalMeuNome: como me apresento.
  // canalContatos: [{ nome, caixa }]. canalAprovarEnvio: nada sai sem eu aprovar.
  canalServidor: null,
  canalArquivoCliente: '~/.config/ntfy/client.yml',
  canalMinhaCaixa: null,
  canalMeuNome: null,
  canalContatos: [],
  canalAprovarEnvio: true,
  // Tipos que saem sem aprovar (o orquestrador marca; o app confere e, na
  // dúvida, segura): ciente ("recebi") e informação (fatos).
  canalSemAprovarCiente: false,
  canalSemAprovarInformacao: false,

  // Programa que recorta um pedaço da tela para o ajudante (bichinho): lista
  // com o caminho e os argumentos; ele imprime o caminho da imagem na última
  // linha. Sem ele: gnome-screenshot. Ex.: ["~/bin/meu-print", "--salvar"].
  capturaTela: null,
};

const casa = (p) => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

// Arquivo que não existe vale como vazio. Arquivo que existe e não é JSON
// válido é marcado: quem grava guarda o original ao lado antes de escrever,
// para a configuração não sumir em silêncio.
const ESTRAGADO = Symbol('estragado');
function lerArquivo() {
  let bruto;
  try { bruto = fs.readFileSync(ARQ, 'utf8'); } catch { return {}; }
  try {
    const c = JSON.parse(bruto);
    return c && typeof c === 'object' && !Array.isArray(c) ? c : { [ESTRAGADO]: true };
  } catch { return { [ESTRAGADO]: true }; }
}

function ler() {
  const c = { ...PADRAO, ...lerArquivo() };
  c.raizProjetos = casa(process.env.ORQ_APP_DEV || c.raizProjetos);
  c.pastaNotas = casa(c.pastaNotas);
  c.iasCaminhos = caminhosIas(c.iasCaminhos) || {};
  return c;
}

// Como está escrito (sem expandir ~), por cima dos padrões: o que a tela de
// configurações mostra para editar.
function cru() { return { ...PADRAO, ...lerArquivo() }; }

// iasCaminhos: só ids conhecidos, caminho absoluto (~ expandido). Texto vazio
// tira a entrada (volta a usar o detectado no PATH). null: valor inválido.
function caminhosIas(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = {};
  for (const [id, cam] of Object.entries(v)) {
    if (!ias.IDS.includes(id) || (cam != null && typeof cam !== 'string')) return null;
    const abs = casa(texto(cam));
    if (!abs) continue;
    if (!path.isAbsolute(abs) || abs.includes('\0')) return null;
    r[id] = path.normalize(abs);
  }
  return r;
}

const regexOk = (r) => { if (r == null || r === '') return true; try { new RegExp(r); return true; } catch { return false; } };
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
// Valida o que a tela de configurações manda; chave desconhecida ou valor
// inválido é ignorado (devolve a lista do que não foi aceito).
function validar(m) {
  const ok = {}, recusado = [];
  const aceitar = (k, cond, v) => { if (cond) ok[k] = v; else recusado.push(k); };
  for (const [k, v] of Object.entries(m || {})) {
    switch (k) {
      case 'tema': aceitar(k, ['dark', 'light'].includes(v), v); break;
      case 'idioma': aceitar(k, ['pt-BR', 'en'].includes(v), v); break;
      case 'destaque': aceitar(k, /^#[0-9a-f]{6}$/i.test(v || ''), String(v).toLowerCase()); break;
      case 'mostrarBichinho': aceitar(k, typeof v === 'boolean', v); break;
      case 'notificacoes': aceitar(k, v && typeof v === 'object', { pedidos: v.pedidos !== false, respostas: v.respostas !== false, agentes: v.agentes !== false, ajudante: v.ajudante !== false }); break;
      case 'comandoInicial': case 'comandoDesligar':
        aceitar(k, !texto(v) || /^\/\S+/.test(texto(v)), texto(v) || null); break;
      case 'raizProjetos': aceitar(k, !!texto(v), texto(v)); break;
      case 'pastaNotas': aceitar(k, true, texto(v) || null); break;
      case 'niveis': aceitar(k, v === 1 || v === 2, v); break;
      case 'ignorar': aceitar(k, !!texto(v) && regexOk(v), texto(v)); break;
      case 'linhaTarefa': case 'comandoOrdem': aceitar(k, regexOk(v), texto(v) || null); break;
      case 'rotuloContainer': case 'pastaTranscript': aceitar(k, !!texto(v), texto(v)); break;
      case 'memoriaGrupos': aceitar(k, Array.isArray(v) && v.every((g) => Array.isArray(g) && g.length >= 2 && g.every((a) => typeof a === 'string' && a.trim())), v); break;
      case 'ambiente': aceitar(k, v && typeof v === 'object' && Object.entries(v).every(([a, b]) => /^[A-Z_][A-Z0-9_]*$/.test(a) && typeof b === 'string'), v); break;
      case 'iaOrquestrador': case 'iaAgentes': aceitar(k, ias.IDS.includes(v), v); break;
      case 'iasCaminhos': { const c = caminhosIas(v); aceitar(k, !!c, c); break; }
      case 'detectarFerramentas': aceitar(k, typeof v === 'boolean', v); break;
      case 'canalServidor': aceitar(k, !texto(v) || /^https?:\/\/[^\s]+$/.test(texto(v)), texto(v).replace(/\/+$/, '') || null); break;
      case 'canalArquivoCliente': aceitar(k, true, texto(v) || '~/.config/ntfy/client.yml'); break;
      case 'canalMinhaCaixa': aceitar(k, !texto(v) || /^[A-Za-z0-9_-]{1,64}$/.test(texto(v)), texto(v) || null); break;
      case 'canalMeuNome': aceitar(k, true, texto(v).slice(0, 60) || null); break;
      case 'canalContatos': { const c = require('./canal').contatosDe(v); aceitar(k, Array.isArray(v) || typeof v === 'string', c); break; }
      case 'canalAprovarEnvio': case 'canalSemAprovarCiente': case 'canalSemAprovarInformacao': aceitar(k, typeof v === 'boolean', v); break;
      case 'fontesRepertorio': aceitar(k, Array.isArray(v) && v.every((f) => f && texto(f.nome) && texto(f.caminho)), v.map((f) => ({ nome: texto(f.nome), ferramenta: texto(f.ferramenta) || 'outra', caminho: texto(f.caminho) }))); break;
      case 'pastasNotas': aceitar(k, Array.isArray(v) && v.every((p) => p && texto(p.caminho)), v.map((p) => ({ nome: texto(p.nome) || null, caminho: texto(p.caminho) }))); break;
      default: recusado.push(k);
    }
  }
  return { ok, recusado };
}

// Grava só as chaves mudadas, sem copiar os padrões para o arquivo.
// Escrita atômica (arquivo temporário + rename): cair no meio não deixa o
// config.json cortado.
function gravar(mudancas) {
  const atual = lerArquivo();
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  if (atual[ESTRAGADO]) {
    fs.copyFileSync(ARQ, `${ARQ}.estragado-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    console.error(`[config] ${ARQ} não era JSON válido; o original ficou guardado ao lado (.estragado-*)`);
  }
  Object.assign(atual, mudancas);
  const tmp = `${ARQ}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(atual, null, 2) + '\n');
  fs.renameSync(tmp, ARQ);
  return ler();
}

module.exports = { ler, cru, validar, gravar, ARQ };
