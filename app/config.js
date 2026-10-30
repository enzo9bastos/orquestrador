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

  // Aba Navegador: o orquestrador (e scripts) controlam as janelas pelo
  // comando orq-nav, por um servidor só em 127.0.0.1 com chave.
  // navegadorPorta 0 = escolhe uma porta livre a cada abertura.
  navegadorControle: true,
  navegadorPorta: 0,

  // Variáveis extras no ambiente das conversas e dos terminais do app.
  ambiente: {},

  // IAs conectadas (ias.js): qual CLI conduz o orquestrador e qual os agentes
  // novos usam. Hoje só o 'claude' está ligado; outra escolha fica guardada,
  // mas o app usa o Claude até ela ser suportada.
  iaOrquestrador: 'claude',
  iaAgentes: 'claude',
};

const casa = (p) => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

function lerArquivo() {
  try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { return {}; }
}

function ler() {
  const c = { ...PADRAO, ...lerArquivo() };
  c.raizProjetos = casa(process.env.ORQ_APP_DEV || c.raizProjetos);
  c.pastaNotas = casa(c.pastaNotas);
  return c;
}

// Como está escrito (sem expandir ~), por cima dos padrões: o que a tela de
// configurações mostra para editar.
function cru() { return { ...PADRAO, ...lerArquivo() }; }

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
      case 'ambiente': aceitar(k, v && typeof v === 'object' && Object.entries(v).every(([a, b]) => /^[A-Z_][A-Z0-9_]*$/.test(a) && typeof b === 'string'), v); break;
      case 'navegadorControle': aceitar(k, typeof v === 'boolean', v); break;
      case 'navegadorPorta': aceitar(k, Number.isInteger(v) && (v === 0 || (v >= 1024 && v <= 65535)), v); break;
      case 'iaOrquestrador': case 'iaAgentes': aceitar(k, ias.IDS.includes(v), v); break;
      case 'detectarFerramentas': aceitar(k, typeof v === 'boolean', v); break;
      case 'fontesRepertorio': aceitar(k, Array.isArray(v) && v.every((f) => f && texto(f.nome) && texto(f.caminho)), v.map((f) => ({ nome: texto(f.nome), ferramenta: texto(f.ferramenta) || 'outra', caminho: texto(f.caminho) }))); break;
      case 'pastasNotas': aceitar(k, Array.isArray(v) && v.every((p) => p && texto(p.caminho)), v.map((p) => ({ nome: texto(p.nome) || null, caminho: texto(p.caminho) }))); break;
      default: recusado.push(k);
    }
  }
  return { ok, recusado };
}

// Grava só as chaves mudadas, sem copiar os padrões para o arquivo.
function gravar(mudancas) {
  const atual = lerArquivo();
  Object.assign(atual, mudancas);
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify(atual, null, 2) + '\n');
  return ler();
}

module.exports = { ler, cru, validar, gravar, ARQ };
