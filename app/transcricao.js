// Transcrição de áudio no próprio computador (plano de voz e reuniões, V1).
//
// Motor: o faster-whisper, quando já existe um Python com ele (é o mais rápido na CPU e não
// precisa baixar nada se os modelos já estão no computador). O áudio nunca sai do computador;
// baixar um modelo só acontece quando a pessoa pede (opção --baixar do voz/transcrever.py).
//
//   acharMotor()            → { ok, python, versao } ou { ok: false, motivo }
//   acharMotorSemTravar()   → o mesmo, numa Promise (não segura o processo principal)
//   maquina()               → { nucleos, memoriaGB, nvidia }
//   modelos()               → [{ id, nome, tamanho, local, recomendado }]
//   transcrever(arquivo, o) → Promise<{ trechos: [{ ini, fim, texto }], duracao, modelo, aparelho }>
//                             o: { modelo, idioma, aoProgresso(pct), sinal (AbortSignal) }
//
// Uma transcrição por vez (fila), num processo à parte com prioridade baixa.
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'voz', 'transcrever.py');
// Os três modelos sugeridos (whisper convertido para o faster-whisper) e onde o Hugging Face os guarda.
const MODELOS = [
  { id: 'small', nome: 'Leve', tamanho: '~480 MB', repo: 'Systran/faster-whisper-small', nota: 'rápido; erra mais nome próprio' },
  { id: 'large-v3-turbo', nome: 'Robusto', tamanho: '~1,6 GB', repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', nota: 'quase tão preciso quanto o melhor e bem mais rápido' },
  { id: 'large-v3', nome: 'Melhor', tamanho: '~3 GB', repo: 'Systran/faster-whisper-large-v3', nota: 'o mais preciso; lento sem placa de vídeo NVIDIA' },
];

const casa = () => os.homedir();
const pastaHF = () => process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(casa(), '.cache', 'huggingface'), 'hub');
const modeloLocal = (repo) => {
  const dir = path.join(pastaHF(), `models--${repo.replace('/', '--')}`, 'snapshots');
  try { return fs.readdirSync(dir).some((s) => fs.existsSync(path.join(dir, s, 'model.bin'))); } catch { return false; }
};

// O computador: núcleos, memória e se há placa NVIDIA (pelo nvidia-smi).
let maquinaGuardada = null;
function maquina() {
  if (maquinaGuardada) return maquinaGuardada;
  let nvidia = null;
  try {
    const s = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [nome, mem] = s.split('\n')[0].split(',').map((x) => x.trim());
    if (nome) nvidia = { nome, memoriaGB: Math.round(Number(mem) / 1024) || null };
  } catch { /* sem NVIDIA */ }
  maquinaGuardada = { nucleos: os.cpus().length, memoriaGB: Math.round(os.totalmem() / 2 ** 30), nvidia };
  return maquinaGuardada;
}

// O modelo que combina com o computador: com NVIDIA, o melhor; com CPU boa, o robusto; senão, o leve.
function recomendado(m = maquina()) {
  if (m.nvidia && (m.nvidia.memoriaGB || 0) >= 6) return 'large-v3';
  if (m.nucleos >= 8 && m.memoriaGB >= 12) return 'large-v3-turbo';
  return 'small';
}
function modelos(m = maquina()) {
  const rec = recomendado(m);
  return MODELOS.map(({ repo, ...x }) => ({ ...x, local: modeloLocal(repo), recomendado: x.id === rec }));
}

// Onde procurar um Python com o faster-whisper, além do caminho escolhido nas Configurações:
// os ambientes virtuais de sempre na pasta da pessoa e o python3 do sistema.
function candidatos(escolhido) {
  const l = [];
  if (escolhido) l.push(escolhido.replace(/^~(?=$|\/)/, casa()));
  for (const base of [path.join(casa(), '.local', 'share'), path.join(casa(), '.venvs'), path.join(casa(), '.virtualenvs'), path.join(casa(), '.local', 'pipx', 'venvs')]) {
    let nomes = [];
    try { nomes = fs.readdirSync(base); } catch { continue; }
    for (const n of nomes) for (const sub of ['venv/bin/python', 'bin/python', '.venv/bin/python']) l.push(path.join(base, n, sub));
  }
  l.push('python3');
  return [...new Set(l)];
}
let motorGuardado = null;
function acharMotor({ escolhido = '', deNovo = false } = {}) {
  if (motorGuardado && !deNovo && motorGuardado.escolhido === escolhido) return motorGuardado.r;
  let r = { ok: false, motivo: 'não achei um Python com o faster-whisper neste computador' };
  for (const py of candidatos(escolhido)) {
    if (py !== 'python3' && !fs.existsSync(py)) continue;
    try {
      const v = execFileSync(py, ['-c', 'import faster_whisper; print(faster_whisper.__version__)'], { timeout: 20000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (v) { r = { ok: true, python: py, versao: v }; break; }
    } catch { /* este não tem */ }
  }
  motorGuardado = { escolhido, r };
  return r;
}

// O mesmo, sem segurar o processo principal enquanto pergunta a cada Python (o ditado começa
// com a tela viva). Guarda a resposta no mesmo lugar.
async function acharMotorSemTravar({ escolhido = '', deNovo = false } = {}) {
  if (motorGuardado && !deNovo && motorGuardado.escolhido === escolhido) return motorGuardado.r;
  let r = { ok: false, motivo: 'não achei um Python com o faster-whisper neste computador' };
  for (const py of candidatos(escolhido)) {
    if (py !== 'python3' && !fs.existsSync(py)) continue;
    const v = await new Promise((ok) => {
      execFile(py, ['-c', 'import faster_whisper; print(faster_whisper.__version__)'], { timeout: 20000, encoding: 'utf8' }, (erro, saida) => ok(erro ? '' : String(saida || '').trim()));
    });
    if (v) { r = { ok: true, python: py, versao: v }; break; }
  }
  motorGuardado = { escolhido, r };
  return r;
}

// --- a fila ---------------------------------------------------------------------
let fila = Promise.resolve();
function transcrever(arquivo, o = {}) {
  const vez = fila.then(() => rodar(arquivo, o));
  fila = vez.catch(() => {});
  return vez;
}
function rodar(arquivo, { modelo = 'large-v3-turbo', idioma = 'pt', baixar = false, aoProgresso = () => {}, sinal = null, escolhido = '' } = {}) {
  return new Promise((ok, falhou) => {
    if (!fs.existsSync(arquivo)) { falhou(new Error(`o arquivo não existe: ${arquivo}`)); return; }
    const motor = process.env.ORQ_VOZ_PYTHON ? { ok: true, python: process.env.ORQ_VOZ_PYTHON } : acharMotor({ escolhido });
    if (!motor.ok) { falhou(new Error(motor.motivo)); return; }
    if (sinal && sinal.aborted) { falhou(new Error('cancelado')); return; }
    const args = [process.env.ORQ_VOZ_SCRIPT || SCRIPT, arquivo, '--modelo', modelo, '--idioma', idioma, ...(baixar ? ['--baixar'] : [])];
    const p = spawn(motor.python, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    const trechos = [];
    let inicio = null, erro = null, resto = '', errSaida = '';
    const aoCancelar = () => { try { p.kill('SIGTERM'); } catch { /* já saiu */ } };
    if (sinal) sinal.addEventListener('abort', aoCancelar, { once: true });
    p.stdout.on('data', (d) => {
      resto += d;
      const linhas = resto.split('\n');
      resto = linhas.pop();
      for (const l of linhas) {
        let e;
        try { e = JSON.parse(l); } catch { continue; }
        if (e.t === 'inicio') inicio = e;
        else if (e.t === 'trecho' && typeof e.texto === 'string') trechos.push({ ini: Number(e.ini) || 0, fim: Number(e.fim) || 0, texto: e.texto.slice(0, 4000) });
        else if (e.t === 'progresso') { try { aoProgresso(Math.max(0, Math.min(100, Number(e.pct) || 0))); } catch { /* a tela fechou */ } }
        else if (e.t === 'erro') erro = String(e.erro || 'erro').slice(0, 500);
      }
    });
    p.stderr.on('data', (d) => { errSaida = (errSaida + d).slice(-2000); });
    p.on('error', (e) => falhou(new Error(`não consegui rodar o Python: ${e.message}`)));
    p.on('close', (codigo) => {
      if (sinal) sinal.removeEventListener('abort', aoCancelar);
      if (sinal && sinal.aborted) { falhou(new Error('cancelado')); return; }
      if (codigo !== 0 || erro) { falhou(new Error(erro || `a transcrição parou (código ${codigo})${errSaida.trim() ? `: ${errSaida.trim().split('\n').pop()}` : ''}`)); return; }
      ok({ trechos, duracao: inicio ? inicio.duracao : null, modelo: inicio ? inicio.modelo : modelo, aparelho: inicio ? inicio.aparelho : null });
    });
  });
}

module.exports = { acharMotor, acharMotorSemTravar, maquina, modelos, recomendado, transcrever, MODELOS, _candidatos: candidatos };
