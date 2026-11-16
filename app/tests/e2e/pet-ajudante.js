// O ajudante fora do app (a janelinha do bichinho, processo próprio em X11)
// para os testes de chegada e saída de cada espécie: abre a janelinha numa casa
// temporária, chama o bichinho, acompanha a chegada até ele parar e a saída até
// sumir. Usado pelos arquivos pet-especies-*.e2e.js (o teste das espécies foi
// dividido em três para rodar em paralelo; antes era um só, de ~70 s).
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

const semTela = !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11';

async function acompanhar(especie, noMeio) {
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') } });
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 50; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 50)); } throw new Error(`não chegou: ${fn}`); };
  const estado = async () => { recebidas.length = 0; manda({ t: 'estado' }); return espera((m) => m.t === 'estado'); };
  try {
    await espera((m) => m.t === 'iniciado', 20000);
    manda({ t: 'visual', visual: { especie, cor: 'azul', itens: {} }, tema: 'dark' });
    manda({ t: 'pendencia', texto: 'teste', total: 1 });
    const chegada = [];
    for (let i = 0; i < 120; i++) { const e = await estado(); e.ms = Date.now(); chegada.push(e); if (e.modo === 'parado' && chegada.length > 2) break; await new Promise((x) => setTimeout(x, 60)); }
    const parado = chegada.at(-1);
    const extra = noMeio ? await noMeio({ manda, estado, espera, recebidas }) : null;
    manda({ t: 'sumir' });
    const saida = [];
    for (let i = 0; i < 120; i++) { const e = await estado(); saida.push(e); if (e.modo === 'escondido') break; await new Promise((x) => setTimeout(x, 60)); }
    const entrando = chegada.filter((e) => e.modo === 'entrando');
    const saindo = saida.filter((e) => e.modo === 'saindo');
    return {
      chegada: entrando.map((e) => e.pos.y), chegadaX: entrando.map((e) => e.pos.x), parado, extra,
      msChegada: entrando.length ? parado.ms - entrando[0].ms : 0,
      saida: saindo.map((e) => e.pos.y), saidaX: saindo.map((e) => e.pos.x), floreioSaida: saida.at(-1).floreio,
    };
  } finally { p.kill(); }
}
const varia = (ys) => Math.max(...ys) - Math.min(...ys);

// O nome do teste de antes, o mesmo nos três arquivos (cada um com uma parte dos subtestes).
const NOME = 'ajudante fora do app: chegada e saída de cada espécie';

module.exports = { acompanhar, varia, semTela, NOME };
