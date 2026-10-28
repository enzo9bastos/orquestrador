// Configuração do app: ~/.config/orq-app/config.json por cima dos padrões
// abaixo. Tudo o que depende de como cada pessoa organiza os projetos e as
// rodadas mora aqui, não no código.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARQ = path.join(os.homedir(), '.config', 'orq-app', 'config.json');

const PADRAO = {
  // Aparência (o painel de Configurações grava estas duas).
  tema: 'dark',
  destaque: '#8b5cf6',

  // Onde estão os projetos. niveis 1: <raiz>/<projeto>; niveis 2:
  // <raiz>/<grupo>/<projeto>. Pastas que casam com ignorar ficam de fora.
  raizProjetos: '~/projetos',
  niveis: 1,
  ignorar: '^[_.-]',

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

  // Variáveis extras no ambiente das conversas e dos terminais do app.
  ambiente: {},
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

// Grava só as chaves mudadas, sem copiar os padrões para o arquivo.
function gravar(mudancas) {
  const atual = lerArquivo();
  Object.assign(atual, mudancas);
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify(atual, null, 2) + '\n');
  return ler();
}

module.exports = { ler, gravar, ARQ };
