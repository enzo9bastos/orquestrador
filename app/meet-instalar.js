// Prepara o navegador para a extensão "quem fala no Meet" (extensao-meet/): põe o arquivo que diz
// ao navegador onde está o programa do computador (orq-meet-host.py) e qual extensão pode falar
// com ele. É o "native messaging host" dos navegadores do tipo Chrome; no Linux mora em
// <perfil do navegador>/NativeMessagingHosts/com.orquestrador.meet.json.
//
// Só escreve nos navegadores que existem neste computador. Nunca passa por cima de um arquivo com
// esse nome que não foi o app que pôs (fica "alheio"); o do app é atualizado quando muda.
const fs = require('fs');
const os = require('os');
const path = require('path');

const NOME = 'com.orquestrador.meet';
const MARCA = 'App de Orquestração';
const PASTA_EXTENSAO = path.join(__dirname, 'extensao-meet');
// Extensão carregada de uma pasta ("Carregar sem compactação") ganha do navegador um identificador
// que vem do caminho dela: os 32 primeiros dígitos do SHA-256 do caminho completo, com 0-f virando
// a-p. Só essa extensão, dessa pasta, pode falar com o programa.
function idDaPasta(pasta = PASTA_EXTENSAO) {
  let real = pasta;
  try { real = fs.realpathSync(pasta); } catch { /* a pasta ainda não existe: vale o caminho dado */ }
  const h = require('crypto').createHash('sha256').update(real, 'utf8').digest('hex').slice(0, 32);
  return [...h].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
const ID_EXTENSAO = idDaPasta();
const PROGRAMA = path.join(PASTA_EXTENSAO, 'orq-meet-host.py');

const NAVEGADORES = [
  ['Brave', ['.config', 'BraveSoftware', 'Brave-Browser']],
  ['Google Chrome', ['.config', 'google-chrome']],
  ['Chromium', ['.config', 'chromium']],
  ['Microsoft Edge', ['.config', 'microsoft-edge']],
  ['Vivaldi', ['.config', 'vivaldi']],
];
// Como abrir cada um (o atalho do sistema, .desktop, e os nomes do programa) e a página de extensões.
const ABRIR = {
  Brave: { desktop: /^brave/i, programas: ['brave-browser', 'brave', 'brave-browser-stable'], pagina: 'brave://extensions/' },
  'Google Chrome': { desktop: /^google-chrome/i, programas: ['google-chrome', 'google-chrome-stable'], pagina: 'chrome://extensions/' },
  Chromium: { desktop: /^chromium/i, programas: ['chromium', 'chromium-browser'], pagina: 'chrome://extensions/' },
  'Microsoft Edge': { desktop: /^microsoft-edge/i, programas: ['microsoft-edge', 'microsoft-edge-stable'], pagina: 'edge://extensions/' },
  Vivaldi: { desktop: /^vivaldi/i, programas: ['vivaldi', 'vivaldi-stable'], pagina: 'vivaldi://extensions/' },
};

// O "Modo do desenvolvedor" da página de extensões, no perfil em uso (só lê). null = não deu para saber.
function modoDesenvolvedor(perfil) {
  try {
    let usado = 'Default';
    try { usado = JSON.parse(fs.readFileSync(path.join(perfil, 'Local State'), 'utf8')).profile.last_used || 'Default'; } catch { /* fica o Default */ }
    if (!/^[\w .-]{1,80}$/.test(usado)) usado = 'Default';
    const p = JSON.parse(fs.readFileSync(path.join(perfil, usado, 'Preferences'), 'utf8'));
    const v = p && p.extensions && p.extensions.ui && p.extensions.ui.developer_mode;
    return typeof v === 'boolean' ? v : false;
  } catch { return null; }
}

// Qual navegador abrir: o padrão do sistema, se for um destes; senão, o primeiro que existe.
function navegadorParaAbrir({ casa = os.homedir(), padrao = '', existe = (p) => { try { return require('child_process').execFileSync('sh', ['-c', 'command -v "$1"', 'sh', p], { encoding: 'utf8' }).trim(); } catch { return ''; } } } = {}) {
  const presentes = NAVEGADORES.filter(([, partes]) => fs.existsSync(path.join(casa, ...partes)));
  const ordem = [...presentes].sort((a, b) => (ABRIR[b[0]].desktop.test(padrao) ? 1 : 0) - (ABRIR[a[0]].desktop.test(padrao) ? 1 : 0));
  for (const [nome, partes] of ordem) {
    for (const prog of ABRIR[nome].programas) {
      const caminho = existe(prog);
      if (caminho) return { navegador: nome, perfil: path.join(casa, ...partes), comando: [caminho, ABRIR[nome].pagina], pagina: ABRIR[nome].pagina };
    }
  }
  return null;
}

function conteudo() {
  return JSON.stringify({
    name: NOME,
    description: `${MARCA}: quem fala no Google Meet (extensao-meet/orq-meet-host.py)`,
    path: PROGRAMA,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${ID_EXTENSAO}/`],
  }, null, 2) + '\n';
}

// Para cada navegador que existe: 'instalado' | 'atualizado' | 'igual' | 'alheio' (não mexe).
function instalar({ casa = os.homedir() } = {}) {
  const novo = conteudo();
  const saida = [];
  for (const [nome, partes] of NAVEGADORES) {
    const perfil = path.join(casa, ...partes);
    if (!fs.existsSync(perfil)) continue;
    const pasta = path.join(perfil, 'NativeMessagingHosts');
    const arq = path.join(pasta, `${NOME}.json`);
    let atual = null;
    try { atual = fs.readFileSync(arq, 'utf8'); } catch { /* ainda não tem */ }
    if (atual === novo) { saida.push({ navegador: nome, arquivo: arq, resultado: 'igual' }); continue; }
    if (atual !== null && !atual.includes(MARCA)) { saida.push({ navegador: nome, arquivo: arq, resultado: 'alheio' }); continue; }
    fs.mkdirSync(pasta, { recursive: true });
    const tmp = path.join(pasta, `.${NOME}-${process.pid}.tmp`);
    fs.writeFileSync(tmp, novo);
    fs.renameSync(tmp, arq);
    saida.push({ navegador: nome, arquivo: arq, resultado: atual === null ? 'instalado' : 'atualizado' });
  }
  try { fs.chmodSync(PROGRAMA, 0o755); } catch { /* segue: o git já guarda o modo */ }
  return saida;
}

// O que as Configurações mostram: em quais navegadores está pronto e quando a extensão falou por
// último com o programa (o programa anota em ~/.local/share/orq-app/meet/contato.json).
function estado({ casa = os.homedir() } = {}) {
  const navegadores = [];
  for (const [nome, partes] of NAVEGADORES) {
    const perfil = path.join(casa, ...partes);
    if (!fs.existsSync(perfil)) continue;
    let pronto = false;
    try { pronto = fs.readFileSync(path.join(perfil, 'NativeMessagingHosts', `${NOME}.json`), 'utf8') === conteudo(); } catch { /* não tem */ }
    navegadores.push({ navegador: nome, pronto, desenvolvedor: modoDesenvolvedor(perfil) });
  }
  let contato = null;
  try { contato = JSON.parse(fs.readFileSync(path.join(casa, '.local', 'share', 'orq-app', 'meet', 'contato.json'), 'utf8')).ts || null; } catch { /* nunca falou */ }
  return { navegadores, contato, pastaExtensao: PASTA_EXTENSAO };
}

module.exports = { instalar, estado, conteudo, idDaPasta, modoDesenvolvedor, navegadorParaAbrir, NOME, ID_EXTENSAO, PASTA_EXTENSAO, PROGRAMA };
