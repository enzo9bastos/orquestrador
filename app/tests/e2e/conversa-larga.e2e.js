// Área: colunas
// Terceira rodada da tela limpa (v3), no jeito do app do Claude: a coluna da
// conversa (mensagens + caixa) usa ~88% do centro, com teto de 1200 px e nunca
// menos que antes (860 px), com as colunas abertas ou recolhidas (uma regra só).
// Cada lado deixa margem do outro, como no app do Claude: o que é do assistente
// (texto, ferramenta, código, cartão) fica à esquerda e vai até ~84% da coluna;
// o balão do usuário fica à direita e vai até ~64%. Em coluna estreita os dois
// usam o que cabe. O texto corrido ainda para num limite de leitura (960 px).
// A caixa de texto usa a coluna inteira. Nada estoura em 1480 nem em 1000 px.
// (1ª versão da v3: teto de 1500 e os dois lados quase de ponta a ponta; ficou
// esticado e sem margem entre a mensagem do usuário e a resposta.)
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const TETO = 1200, PISO = 860, PROPORCAO = 0.88, LIMITE_TEXTO = 960;
// Até onde vai cada lado, para uma coluna de largura col.
const ladoClaude = (col) => Math.max(0.84 * col, Math.min(col, 760));
const ladoVoce = (col) => Math.max(0.64 * col, Math.min(0.75 * col, 520));
// A coluna esperada para um centro de largura c (com 24 px de respiro de cada lado).
const esperada = (c) => Math.min(TETO, Math.max(PISO, PROPORCAO * c), c - 48);

const agora = Date.now();
const frente = (n) => ({ chave: `g/p${n}:%${n}`, emp: 'g', proj: `proj-${n}`, dir: `/x/${n}`, pane: `%${n}`, sessaoTmux: `proj-${n}`, nome: `Agente ${n}`, estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: `Tarefa ${n}`, modeloAgente: null, ultimaResposta: null, git: {}, linhaDoTempo: [] });
const CALMO = { lidoEm: agora, semTerminal: 0, frentes: [frente(1), frente(2)], fila: [] };

const CURTA = 'Bom dia! Como está o relatório do Bruno?';
const LONGA = 'Preciso que você confira três coisas antes do almoço: o cadastro de clientes da Ana (os campos novos de endereço, que ela pediu ontem), a correção do relatório mensal do Bruno, que ainda mostra os totais de outubro, e as notas fiscais da Carla, que chegaram duplicadas na pasta compartilhada. Se algo depender de mim, me pergunte antes de seguir.';
const RESPOSTA = [
  'Conferi as três frentes. O cadastro da Ana já tem os campos de rua, número, complemento, bairro, cidade e CEP, e a validação do CEP aceita o formato com e sem hífen. Falta só o texto de ajuda do campo de complemento, que deixei como rascunho para você revisar antes de publicar; o resto passou nos testes e está pronto para a revisão da Ana amanhã cedo, como combinado na reunião de segunda-feira.',
  'O relatório do Bruno mostrava outubro porque o filtro de data usava o fuso errado na virada do mês. Corrigi o filtro, rodei o relatório de novo e os totais de novembro batem com a planilha que ele mandou. Veja o [relatório corrigido](https://exemplo.com/relatorios/bruno-novembro) antes de eu avisar o Bruno.',
  '```bash\norq-topico abrir "Notas fiscais duplicadas da Carla" --prioridade alta --responsavel carla --prazo amanha --anexar ~/compartilhado/notas-fiscais/2026-11/duplicadas.csv\n```',
  'As notas da Carla estão duplicadas porque o importador rodou duas vezes no mesmo dia. Abri a demanda acima e não apaguei nada: as cópias continuam na pasta até você decidir.',
].join('\n\n');

async function encherConversa(app) {
  await app.avaliar(`(() => {
    const T = window.__orqTeste;
    T.desenharEvento({ tipo: 'user', antigo: true, message: { content: ${JSON.stringify(CURTA)} } });
    T.desenharEvento({ tipo: 'assistant', antigo: true, message: { content: [{ type: 'text', text: 'O relatório do Bruno está quase pronto: falta conferir os totais de novembro.' }] } });
    T.desenharEvento({ tipo: 'user', antigo: true, message: { content: ${JSON.stringify(LONGA)} } });
    T.desenharEvento({ tipo: 'assistant', antigo: true, message: { content: [
      { type: 'tool_use', id: 'f1', name: 'Bash', input: { command: 'orq-topico listar --projeto relatorio-bruno', description: 'Listar as demandas do relatório' } },
      { type: 'text', text: ${JSON.stringify(RESPOSTA)} },
    ] } });
    T.desenharEvento({ tipo: 'user', antigo: true, message: { content: [{ type: 'tool_result', tool_use_id: 'f1', content: '3 demandas abertas' }] } });
    T.cartaoPedido({ id: 'perg-1', ferramenta: 'AskUserQuestion', entrada: { questions: [{ header: 'Notas da Carla', question: 'O que faço com as notas fiscais duplicadas da Carla?', options: [
      { label: 'Deixar como está', description: 'A Carla confere e decide amanhã' },
      { label: 'Mover para uma pasta à parte', description: 'Nada é apagado; as cópias ficam em "duplicadas/"' },
    ] }] } });
  })()`);
  await app.esperar("!!document.querySelector('#mensagens .cartao-pedido') && document.querySelectorAll('#mensagens .msg-voce .balao').length === 2");
}

// Tudo o que a regra mede, em px da janela.
const medir = (app) => app.avaliar(`(() => {
  const caixa = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; };
  const q = (s) => caixa(document.querySelector(s));
  const m = document.getElementById('mensagens');
  const cs = getComputedStyle(m);
  const mb = m.getBoundingClientRect();
  // A coluna das mensagens: a caixa de conteúdo da lista (sem o respiro e sem a barra de rolagem).
  const col = { l: mb.left + parseFloat(cs.paddingLeft), r: mb.left + m.clientWidth - parseFloat(cs.paddingRight) };
  col.w = col.r - col.l;
  return {
    centro: document.querySelector('.mensagens-area').getBoundingClientRect().width,
    col, caixa: q('.caixa-entrada'), trabalhando: q('#trabalhando'),
    ferramenta: q('#mensagens .ferramenta'), cartao: q('#mensagens .cartao-pedido'), codigo: q('#mensagens .caixa-codigo'),
    textos: [...document.querySelectorAll('#mensagens .md.texto-claude > p')].map(caixa),
    baloes: [...document.querySelectorAll('#mensagens .msg-voce .balao')].map(caixa),
    // Rolagem para o lado na conversa: a lista, a aba, ou alguma coisa da
    // conversa saindo do centro. (A janela em si não rola: o body corta; ver achados.md.)
    rolaX: m.scrollWidth > m.clientWidth + 1
      || document.querySelector('.aba.conversa.ativa').scrollWidth > document.querySelector('.aba.conversa.ativa').clientWidth + 1
      || [...document.querySelectorAll('#mensagens *, #compositor *')].some((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > mb.right + 1 || b.left < mb.left - 1); }),
  };
})()`);

const colunas = (app, a, d) => app.avaliar(`window.orqColunas.definir('agentes', ${a}); window.orqColunas.definir('demandas', ${d})`);
const largou = (app, a, d) => app.esperar(`(() => { const l = document.querySelector('.lateral').getBoundingClientRect().width, r = document.querySelector('.inspetor').getBoundingClientRect().width; return ${a ? 'l > 150' : 'l < 2'} && ${d ? 'r > 200' : 'r < 2'}; })()`, 4000);
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${Math.round(a)} (esperado ${Math.round(b)} ±${tol})`);

// 1920×1080: uma tela de 2400 px físicos com escala de 125%, vista pelo app.
const JANELAS = [[2400, 1350], [1480, 900], [1000, 760], [1920, 1080]];
const ESTADOS = [['abertas', true, true], ['agentes recolhida', false, true], ['demandas recolhida', true, false], ['as duas recolhidas', false, false]];

test('conversa larga (v3): a coluna usa ~88% do centro até 1200 px; o assistente à esquerda e o usuário à direita, cada um deixando margem do outro', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral && !!window.__orqTeste');
  await app.avaliar(`window.__estadoFalso = ${JSON.stringify(CALMO)}; window.__orqLateral.atualizar()`);
  await encherConversa(app);
  // A faixa "Pensando… Parar" à vista: ela também acompanha a coluna.
  await app.avaliar("window.__orqTeste.desenharInfo({ modelo: 'claude-opus-5-5', esforco: 'high', pasta: '/home/ana/projetos/api-pedidos', uso5h: 23, uso7d: 41, contexto: 92000, janela: 200000, ocupado: true })");
  await app.esperar("!document.getElementById('trabalhando').hidden");

  for (const [larg, alt] of JANELAS) {
    for (const [nome, a, d] of ESTADOS) {
      await t.test(`${larg} px, ${nome}`, async () => {
        await app.tamanho(larg, alt);
        await colunas(app, a, d); await largou(app, a, d);
        await app.espera(150);
        const m = await medir(app);
        const quer = esperada(m.centro);
        const onde = `${larg} px, ${nome} (centro ${Math.round(m.centro)})`;
        // A coluna: ~88% do centro, teto 1200, nunca menor que 860 (quando cabe).
        perto(m.caixa.w, quer, 2, `caixa de texto em ${onde}`);
        perto(m.col.w, quer, 2, `coluna das mensagens em ${onde}`);
        // Mensagens e caixa na mesma coluna: mesma borda esquerda e direita.
        perto(m.col.l, m.caixa.l, 2, `borda esquerda da coluna × caixa em ${onde}`);
        perto(m.col.r, m.caixa.r, 2, `borda direita da coluna × caixa em ${onde}`);
        perto(m.trabalhando.w, m.caixa.w, 2, `faixa "Pensando…" × caixa em ${onde}`);
        // O lado do assistente: ferramenta, cartão e código à esquerda, até ~84% da coluna.
        const claude = ladoClaude(m.col.w), voce = ladoVoce(m.col.w);
        for (const k of ['ferramenta', 'cartao', 'codigo']) {
          perto(m[k].w, claude, 2, `${k} em ${onde}`);
          perto(m[k].l, m.col.l, 2, `${k} à esquerda em ${onde}`);
        }
        // Texto corrido do assistente: à esquerda, no limite de leitura (e dentro do lado dele).
        const limiteTexto = Math.min(LIMITE_TEXTO, claude);
        for (const p of m.textos) {
          perto(p.l, m.col.l, 2, `texto do assistente à esquerda em ${onde}`);
          assert.ok(p.w <= limiteTexto + 1, `texto do assistente com ${Math.round(p.w)} px em ${onde} (limite ${Math.round(limiteTexto)})`);
        }
        perto(Math.max(...m.textos.map((p) => p.w)), limiteTexto, 2, `o parágrafo longo vai até o limite em ${onde}`);
        // Balões do usuário: encostados à direita da coluna, até ~64% dela; o curto é curto.
        for (const b of m.baloes) {
          perto(b.r, m.col.r, 2, `balão do usuário à direita em ${onde}`);
          assert.ok(b.w <= voce + 1, `balão com ${Math.round(b.w)} px de ${Math.round(m.col.w)} em ${onde}`);
        }
        assert.ok(m.baloes[0].w < 360, `balão curto com ${Math.round(m.baloes[0].w)} px em ${onde}`);
        perto(m.baloes[1].w, voce, 2, `balão longo vai até o limite do lado dele em ${onde}`);
        // A margem entre os dois lados (o pedido): em coluna larga, a resposta
        // não chega perto da direita e a mensagem do usuário não chega perto da esquerda.
        if (m.col.w >= 1000) {
          const direitaDoClaude = Math.max(...['ferramenta', 'cartao', 'codigo'].map((k) => m[k].r), ...m.textos.map((p) => p.r));
          assert.ok(m.col.r - direitaDoClaude >= 0.15 * m.col.w, `a resposta chega a ${Math.round(m.col.r - direitaDoClaude)} px da direita em ${onde} (quer pelo menos ${Math.round(0.15 * m.col.w)})`);
          const esquerdaDoUsuario = Math.min(...m.baloes.map((b) => b.l));
          assert.ok(esquerdaDoUsuario - m.col.l >= 0.35 * m.col.w, `a mensagem do usuário chega a ${Math.round(esquerdaDoUsuario - m.col.l)} px da esquerda em ${onde} (quer pelo menos ${Math.round(0.35 * m.col.w)})`);
        }
        assert.strictEqual(m.rolaX, false, `rolagem horizontal em ${onde}`);
      });
    }
  }

  await t.test('os números de hoje em 2400, 1920 e 1480 px (para o relatório)', async () => {
    const linhas = [];
    for (const [larg, alt] of [JANELAS[0], JANELAS[3], JANELAS[1]]) {
      await app.tamanho(larg, alt);
      for (const [nome, a, d] of [ESTADOS[0], ESTADOS[1], ESTADOS[3]]) {
        await colunas(app, a, d); await largou(app, a, d); await app.espera(150);
        const m = await medir(app);
        linhas.push(`${larg} ${nome}: centro ${Math.round(m.centro)} · coluna ${Math.round(m.col.w)} · texto ${Math.round(Math.max(...m.textos.map((p) => p.w)))} · balão longo ${Math.round(m.baloes[1].w)}`);
      }
    }
    t.diagnostic(linhas.join('\n'));
    // Abertas em 2400 px a conversa já não fica nos 860 de antes.
    await app.tamanho(2400, 1350); await colunas(app, true, true); await largou(app, true, true); await app.espera(150);
    assert.ok((await medir(app)).caixa.w > 1150);
  });

  await t.test('nada some: ✎ do balão, Copiar do código, link e o balão de comando continuam ao alcance', async () => {
    await app.tamanho(1480, 900);
    await colunas(app, false, false); await largou(app, false, false);
    await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'user', antigo: true, message: { content: '<command-name>/model</command-name>' } })");
    for (const s of ['#mensagens .msg-voce[data-texto] .editar-msg', '#mensagens .acoes-codigo [data-codigo="copiar"]', '#mensagens .md a[href]', '#mensagens .balao.comando']) {
      await app.avaliar(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({ block: 'center' })`);
      await app.espera(100);
      assert.strictEqual(await app.visivel(s), 'ok', s);
    }
    // O ✎ fica junto do balão, do lado de dentro da coluna.
    const g = await app.avaliar(`(() => {
      const v = document.querySelector('#mensagens .msg-voce[data-texto]');
      const e = v.querySelector('.editar-msg').getBoundingClientRect(), b = v.querySelector('.balao').getBoundingClientRect();
      return { e: e.right, b: b.left, dentro: e.left >= v.getBoundingClientRect().left };
    })()`);
    assert.ok(g.e <= g.b + 1 && g.e > g.b - 40 && g.dentro, JSON.stringify(g));
    // O balão de comando também fica à direita.
    const cmd = await app.avaliar("(() => { const b = [...document.querySelectorAll('#mensagens .balao.comando')].pop().getBoundingClientRect(), v = document.querySelector('.caixa-entrada').getBoundingClientRect(); return Math.abs(b.right - v.right); })()");
    assert.ok(cmd <= 3, `balão de comando a ${cmd} px da direita`);
  });

  await t.test('a lista do "/" e a do "@" ficam alinhadas com a caixa (abertas e recolhidas, 2400 e 1480 px)', async () => {
    for (const [larg, alt] of JANELAS.slice(0, 2)) {
      await app.tamanho(larg, alt);
      for (const [nome, a, d] of [ESTADOS[0], ESTADOS[3]]) {
        await colunas(app, a, d); await largou(app, a, d);
        for (const gatilho of ['/', '@']) {
          await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(gatilho)}; e.dispatchEvent(new Event('input')); })()`);
          await app.esperar("!document.getElementById('sugestoes').hidden");
          const r = await app.avaliar("(() => { const s = document.getElementById('sugestoes').getBoundingClientRect(), c = document.querySelector('.caixa-entrada').getBoundingClientRect(); return { l: s.left - c.left, r: s.right - c.right }; })()");
          assert.ok(Math.abs(r.l) <= 2 && Math.abs(r.r) <= 2, `lista do "${gatilho}" desalinhada em ${larg} px, ${nome}: ${JSON.stringify(r)}`);
          await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
        }
      }
    }
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('conversa larga (v3): com o bichinho e a faixa "Pensando… Parar", o Parar fica à vista nas larguras novas', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqTeste && !!window.orqPetAtual');
  await app.avaliar("window.__orqTeste.desenharInfo({ modelo: 'claude-opus-5-5', esforco: 'high', pasta: '/home/ana/projetos/api-pedidos', uso5h: 23, uso7d: 41, contexto: 92000, janela: 200000, ocupado: true })");
  await app.esperar("!document.getElementById('trabalhando').hidden");
  for (const [larg, alt] of JANELAS.slice(0, 2)) {
    for (const [nome, a, d] of [ESTADOS[0], ESTADOS[3]]) {
      await t.test(`${larg} px, ${nome}`, async () => {
        await app.tamanho(larg, alt);
        await colunas(app, a, d); await largou(app, a, d);
        await app.espera(900);
        assert.strictEqual(await app.avaliar('window.orqPetAtual.salaNome'), 'centro');
        // O pior lugar: o canto direito da sala, onde fica o Parar.
        await app.avaliar('(() => { const p = window.orqPetAtual; p.x = p.sala().x1; p.encaixar(); })()');
        await app.espera(300);
        assert.strictEqual(await app.visivel('#parar'), 'ok');
        // De pé: os pés nunca abaixo do topo da faixa.
        const pes = await app.avaliar("(() => { const p = window.orqPetAtual.el.getBoundingClientRect(), f = document.getElementById('trabalhando').getBoundingClientRect(); return f.top - p.bottom; })()");
        assert.ok(pes >= -2, `o bichinho afundou ${-pes} px na faixa`);
      });
    }
  }
  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
