// As peças de verdade do modo reunião (reuniao.js recebe estas funções):
//   gravar(trilha, arquivo)  → ffmpeg lendo do servidor de som (PipeWire ou PulseAudio) e gravando
//                              em Opus: 'voce' = o microfone padrão, 'outros' = o som que o computador toca
//   resumir(texto, o)        → Claude (só o texto sai do computador) ou modelo local pelo Ollama
//   recomendacaoResumo()     → qual dos dois combina com o computador, e por quê
//
// Nos testes (ORQ_REUNIAO_ENTRADA=teste) o ffmpeg grava um tom gerado por ele mesmo, sem microfone.
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ENTRADA = { voce: '@DEFAULT_SOURCE@', outros: '@DEFAULT_MONITOR@' };
// O nome do aparelho, para a pessoa conferir antes de a reunião ir longe (wpctl, se houver).
function nomeDoAparelho(trilha) {
  try {
    const alvo = trilha === 'voce' ? '@DEFAULT_AUDIO_SOURCE@' : '@DEFAULT_AUDIO_SINK@';
    const s = execFileSync('wpctl', ['inspect', alvo], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /node\.description = "([^"]+)"/.exec(s);
    return m ? m[1] : null;
  } catch { return null; }
}

function gravar(trilha, arquivo, { ffmpeg = process.env.ORQ_REUNIAO_FFMPEG || 'ffmpeg' } = {}) {
  return new Promise((ok, falhou) => {
    const teste = process.env.ORQ_REUNIAO_ENTRADA === 'teste';
    // O tom de teste é gerado mais rápido que o tempo real: -re faz o ffmpeg ler no ritmo de verdade.
    const entrada = teste ? ['-re', '-f', 'lavfi', '-i', `sine=frequency=${trilha === 'voce' ? 440 : 660}:sample_rate=16000`] : ['-f', 'pulse', '-i', ENTRADA[trilha]];
    // -n: nunca passa por cima de um arquivo que já existe.
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...entrada, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-n', arquivo], { stdio: ['ignore', 'ignore', 'pipe'] });
    let erro = '';
    let saiu = false;
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-1000); });
    const fechou = new Promise((r) => p.on('close', (c) => { saiu = true; r(c); }));
    p.on('error', (e) => { saiu = true; falhou(new Error(`não consegui rodar o ffmpeg: ${e.message}`)); });
    // Se em 700 ms ele não morreu, está gravando.
    setTimeout(() => {
      if (saiu) { falhou(new Error(erro.trim().split('\n').pop() || 'o ffmpeg parou logo ao começar')); return; }
      ok({
        dispositivo: teste ? `tom de teste (${trilha})` : nomeDoAparelho(trilha),
        // Ctrl+C (SIGINT): o ffmpeg fecha o arquivo direito. Se travar, encerra à força depois de 8 s.
        parar: async () => {
          if (saiu) return;
          p.kill('SIGINT');
          const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, 8000);
          await fechou;
          clearTimeout(t);
        },
      });
    }, 700);
  });
}

const PEDIDO = (texto, titulo) => `Você recebe a transcrição de uma reunião (feita por reconhecimento de voz; pode ter erros de palavra).
"Você" é quem gravou; "Outros" são os demais participantes.${titulo ? `\nTítulo dado por quem gravou: ${titulo}` : ''}

Responda SÓ com um JSON, sem texto antes ou depois, neste formato:
{"assunto": "assunto principal em até 6 palavras, sem data", "resumo": "um parágrafo curto com o que foi tratado", "decisoes": ["cada decisão tomada"], "pendencias": ["cada pendência, com quem ficou responsável se foi dito"]}
Use português do Brasil. Não invente: listas vazias quando não houver.

Transcrição:
${texto}`;

function extrairJson(s) {
  const t = String(s || '');
  const i = t.indexOf('{');
  const f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('o resumo não veio no formato esperado');
  const o = JSON.parse(t.slice(i, f + 1));
  const lista = (x) => (Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y))) : []);
  return { assunto: String(o.assunto || ''), resumo: String(o.resumo || ''), decisoes: lista(o.decisoes), pendencias: lista(o.pendencias) };
}

// Claude sem ferramentas, sem servidores MCP e sem guardar a sessão: recebe só o texto.
function resumirClaude(texto, { titulo = '', comando = 'claude', env = process.env, modelo = 'sonnet' } = {}) {
  return new Promise((ok, falhou) => {
    const p = spawn(comando, ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--model', modelo, '--output-format', 'text'], { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    const t = setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* já saiu */ } }, 5 * 60 * 1000);
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-1000); });
    p.on('error', (e) => { clearTimeout(t); falhou(new Error(`não consegui rodar o Claude: ${e.message}`)); });
    p.on('close', (c) => {
      clearTimeout(t);
      if (c !== 0) { falhou(new Error(`o Claude não fez o resumo${erro.trim() ? `: ${erro.trim().split('\n').pop()}` : ` (código ${c})`}`)); return; }
      try { ok(extrairJson(saida)); } catch (e) { falhou(e); }
    });
    p.stdin.end(PEDIDO(texto, titulo));
  });
}

const OLLAMA = 'http://127.0.0.1:11434';
async function ollamaLigado() {
  try { const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) }); return r.ok ? (await r.json()).models || [] : null; } catch { return null; }
}
async function resumirLocal(texto, { titulo = '', modelo = 'qwen2.5:7b' } = {}) {
  let r;
  try {
    r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelo, prompt: PEDIDO(texto, titulo), stream: false, format: 'json' }), signal: AbortSignal.timeout(20 * 60 * 1000) });
  } catch { throw new Error('o Ollama não respondeu neste computador (ele está instalado e aberto?)'); }
  if (!r.ok) throw new Error(`o Ollama recusou: HTTP ${r.status}`);
  return extrairJson((await r.json()).response);
}

// Qual resumo combina com o computador: local só vale a pena com placa de vídeo boa e o Ollama
// instalado; sem isso, o local fica lento e bem pior, e a recomendação é o Claude.
async function recomendacaoResumo(maquina) {
  const modelosOllama = await ollamaLigado();
  const gpuBoa = !!(maquina.nvidia && (maquina.nvidia.memoriaGB || 0) >= 8);
  if (gpuBoa && modelosOllama) return { recomendado: 'local', ollama: true, motivo: `placa de vídeo ${maquina.nvidia.nome} com ${maquina.nvidia.memoriaGB} GB e o Ollama ligado: o resumo local fica rápido e tudo fica no computador` };
  if (!modelosOllama) return { recomendado: 'claude', ollama: false, motivo: 'o Ollama não está ligado neste computador; o resumo local precisa dele' };
  return { recomendado: 'claude', ollama: true, motivo: 'sem placa de vídeo NVIDIA com 8 GB ou mais, o resumo local fica lento e bem pior' };
}

module.exports = { gravar, resumirClaude, resumirLocal, recomendacaoResumo, extrairJson, PEDIDO };
