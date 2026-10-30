// O orquestrador em pessoa: o bichinho do Claude que mora no cantinho da
// conversa do orquestrador. Ele mostra o que o orquestrador está fazendo
// (pensando, trabalhando, mandando nos agentes, chamando o usuário) e, parado,
// passeia, olha, pisca e acena. Dá para pegar com o mouse e arremessar: ele cai
// com gravidade, quica nas paredes e volta a andar. Cada painel da janela
// (lateral, conversa, inspetor) é uma "sala" com chão e paredes: segurando,
// ele atravessa as paredes; solto, fica preso na sala onde caiu.
(() => {
  const LARG = 96, ALT = 75;       // tamanho do bichinho na tela (com espaço para chapéu e mão)
  const GRAVIDADE = 2400;          // px/s²
  const QUIQUE = 0.42;             // quanto da velocidade sobra ao bater
  const CHAVE = 'pet-sala';        // sala onde ele mora (guardada entre aberturas)
  // As salas: o painel de cada uma, em coordenadas da janela.
  const SALAS = { esquerda: '.lateral', centro: '#aba-orquestrador', direita: '.inspetor' };
  // O que tem "chão" dentro de cada sala: ele pisa em cima destas coisas
  // (a caixa de escrever, as miniaturas de anexo, os cartões de agente…).
  const PLATAFORMAS = {
    centro: ['.caixa-entrada', '#anexos:not([hidden]) .anexo', '#sugestoes:not([hidden])'],
    esquerda: ['.cartao-agente', '.item-conversa', '.busca'],
    direita: [],
  };
  const PE0 = 26, PE1 = 70; // onde ficam as pernas dentro da caixa do bichinho (px)
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const sorteia = (l) => l[Math.floor(Math.random() * l.length)];
  const parado = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Próximo quadro da animação: o quadro da tela ou um relógio de 50 ms, o que
  // vier primeiro. Com a janela escondida ou minimizada o navegador para de
  // desenhar quadros (mesmo dizendo que a página está visível), e a física
  // ficaria congelada no ar.
  const quadroSeguinte = (fn) => {
    let feito = false;
    const rodar = (t) => { if (feito) return; feito = true; cancelAnimationFrame(q); clearTimeout(r); fn(t); };
    const q = requestAnimationFrame(rodar);
    const r = setTimeout(() => rodar(performance.now()), 50);
  };

  // Modos que vêm do orquestrador; "livre" é quando ele não está fazendo nada.
  const FALAS = {
    pensando: ['Hmm…', 'Deixa eu ver…', 'Pensando…'],
    trabalhando: ['Mão na massa!', 'Trabalhando…', 'Já vai!'],
    pronto: ['Pronto!', 'Feito!', 'Prontinho!'],
    chamando: ['Ei! Preciso de você', 'Sua vez!', 'Uma pergunta!'],
    erro: ['Ops…', 'Deu ruim…'],
    clique: ['Oi!', 'Hehe', 'Tô aqui!', 'Me chama com dois cliques!', 'Pronto para ajudar!', 'Opa!'],
    carinho: ['Que bom te ver!', '♥', 'Hehe, cócegas!', ':)'],
    acordar: ['Hã? Tô acordado!', 'Ahh… cochilei.', 'Bom dia!'],
  };
  const SONO_MS = 3 * 60 * 1000; // sem mexer no mouse/teclado esse tempo, ele cochila

  class Pet {
    constructor(palco) {
      this.palco = palco;
      this.el = document.createElement('div');
      this.el.className = 'pet';
      this.el.title = 'O orquestrador. Dois cliques para falar com ele; botão direito para o guarda-roupa. Arraste para mover.';
      this.el.innerHTML = `<div class="pet-balao" hidden></div><div class="pet-nuvem" hidden><i></i><i></i><i></i></div><div class="pet-zzz" hidden><i>z</i><i>z</i><i>Z</i></div><div class="pet-coracao" hidden>♥</div><div class="pet-vira"></div>`;
      palco.append(this.el);
      this.vira = this.el.querySelector('.pet-vira');
      this.vestir(null);
      this.ultimoMovimento = Date.now();
      this.aoChamar = () => {};
      this.aoMenu = () => {};
      this.balao = this.el.querySelector('.pet-balao');
      this.x = null; this.y = 0; this.vx = 0; this.vy = 0;
      this.noAr = false; this.arrastando = false;
      this.modo = 'livre';
      this.passo = 0; // muda a cada gesto: um gesto antigo para quando vê que perdeu a vez
      try { this.salaNome = localStorage.getItem(CHAVE) || 'centro'; } catch { this.salaNome = 'centro'; }
      if (!SALAS[this.salaNome]) this.salaNome = 'centro';
      this.ligarMouse();
      this.ligarReacoes();
      new ResizeObserver(() => this.encaixar()).observe(document.body);
      // Trocar de aba esconde/mostra a sala do centro: confere de tempos em tempos.
      setInterval(() => { if (!this.arrastando && !this.noAr) this.encaixar(); }, 700);
      this.loopLivre();
    }

    // --- salas: chão e paredes ----------------------------------------------
    medir(nome) {
      const el = document.querySelector(SALAS[nome]);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < LARG + 20 || r.height < ALT + 20) return null; // sala escondida
      const barra = nome === 'centro' ? 14 : 0; // não ficar em cima da barra de rolagem
      return { x0: r.left + 6, x1: r.right - LARG - 6 - barra, teto: r.top, chao: r.bottom - ALT - 4 };
    }
    sala() { return this.medir(this.salaNome); }
    chao() { return this.chaoEm(this.x, this.y + ALT); }
    // Chão debaixo das pernas: o fundo da sala ou o topo da primeira coisa
    // embaixo dele. pes: altura dos pés agora (só vale o que não está acima deles).
    chaoEm(x, pes) {
      const s = this.sala();
      if (!s) return this.y;
      let ch = s.chao;
      for (const sel of PLATAFORMAS[this.salaNome] || []) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || r.right < x + PE0 || r.left > x + PE1) continue;
          if (r.bottom <= pes - ALT + 4) continue; // inteira acima da cabeça: não é chão
          const topo = r.top - ALT;
          if (topo < ch && topo >= s.teto) ch = topo;
        }
      }
      return ch;
    }
    direita() { const s = this.sala(); return s ? s.x1 : this.x; }
    // Onde ele pode passear: na conversa com tela larga, só na margem à
    // direita da coluna (para não ficar em cima do texto); nas outras salas,
    // o painel inteiro.
    faixa() {
      const s = this.sala();
      if (!s) return [this.x, this.x];
      if (this.salaNome === 'centro') {
        const caixa = document.querySelector('.caixa-entrada');
        if (caixa) {
          const inicio = caixa.getBoundingClientRect().right + 12;
          if (s.x1 - inicio >= 0) return [inicio, s.x1];
        }
        return [Math.max(s.x0, s.x1 - 140), s.x1];
      }
      return [s.x0, s.x1];
    }
    encaixar() {
      if (this.arrastando || this.noAr) return;
      const s = this.sala();
      this.el.style.visibility = s ? '' : 'hidden'; // a sala dele não está na tela
      if (!s) return;
      if (this.x == null) { this.x = s.x1; this.y = s.chao; }
      this.x = Math.min(Math.max(this.x, s.x0), s.x1);
      const ch = this.chaoEm(this.x, this.y + ALT);
      if (this.jeito() === 'voa') { // voando: fica onde está, só não atravessa o chão nem o teto
        this.y = Math.min(Math.max(this.y, s.teto), ch);
        this.desenhar();
        return;
      }
      if (ch > this.y + 2 && this.y < s.chao) { this.voar(); return; } // a coisa embaixo sumiu: cai
      this.x = Math.min(Math.max(this.x, s.x0), s.x1);
      this.y = ch;
      this.desenhar();
    }
    desenhar() {
      this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
      const s = this.sala();
      this.el.classList.toggle('balao-embaixo', this.y - (s ? s.teto : 0) < 44); // perto do teto, fala para baixo
      // Perto da borda da janela, o balão encosta para dentro em vez de ser cortado.
      this.el.classList.toggle('balao-esq', this.x < 110);
      this.el.classList.toggle('balao-dir', this.x > innerWidth - LARG - 110);
    }
    // Ao soltar: a sala é a do painel sob o centro dele (ou a mais perto).
    escolherSala() {
      const cx = this.x + LARG / 2;
      let melhor = this.salaNome, dist = Infinity;
      for (const nome of Object.keys(SALAS)) {
        const s = this.medir(nome);
        if (!s) continue;
        const d = cx < s.x0 ? s.x0 - cx : cx > s.x1 + LARG ? cx - s.x1 - LARG : 0;
        if (d < dist) { dist = d; melhor = nome; }
      }
      if (melhor !== this.salaNome) {
        this.salaNome = melhor;
        try { localStorage.setItem(CHAVE, melhor); } catch { /* sem armazenamento */ }
        if (this.modo === 'livre') setTimeout(() => this.falar(sorteia(['Casa nova!', 'Gostei daqui.', 'Vou ficar aqui.']), 1500), 700);
      }
      const s = this.sala();
      if (s) { this.x = Math.min(Math.max(this.x, s.x0), s.x1); this.y = Math.min(Math.max(this.y, s.teto), s.chao); }
    }

    // --- partes do corpo ----------------------------------------------------
    classe(c, ligado = true) { this.el.classList.toggle(c, ligado); }
    // Virado, o desenho é espelhado: "esquerda" na tela é "direita" no desenho.
    olhar(lado) {
      this.ladoOlhar = lado || '';
      const virado = this.vira.classList.contains('virado');
      const l = virado && lado === 'esq' ? 'dir' : virado && lado === 'dir' ? 'esq' : (lado || '');
      this.el.dataset.olhar = l;
    }
    virar(lado) { this.vira.classList.toggle('virado', lado === 'esq'); this.olhar(this.ladoOlhar); }
    falar(texto, ms = 1800) {
      clearTimeout(this.tBalao);
      this.balao.textContent = texto;
      this.balao.hidden = false;
      if (ms) this.tBalao = setTimeout(() => { this.balao.hidden = true; }, ms);
    }
    calar() { clearTimeout(this.tBalao); this.balao.hidden = true; }

    // --- o que o orquestrador está fazendo ---------------------------------
    // modo: livre | pensando | trabalhando | mandando | chamando | pronto | erro
    definir(modo, texto) {
      if (modo === this.modo && !texto) return;
      const antes = this.modo;
      this.modo = modo;
      this.passo++;
      for (const m of ['pensando', 'trabalhando', 'mandando', 'chamando', 'triste']) this.classe(m, false);
      this.el.querySelector('.pet-nuvem').hidden = modo !== 'pensando';
      this.olhar('');
      if (modo === 'pensando') {
        this.classe('pensando');
        if (antes !== 'pensando') this.falar(sorteia(FALAS.pensando), 1600);
      } else if (modo === 'trabalhando') {
        this.classe('trabalhando');
        this.falar(texto || sorteia(FALAS.trabalhando), 1800);
      } else if (modo === 'mandando') {
        this.classe('mandando');
        this.virar('esq');
        this.falar(texto || 'Agentes, ao trabalho!', 2600);
      } else if (modo === 'chamando') {
        this.classe('chamando');
        this.falar(texto || sorteia(FALAS.chamando), 0);
      } else if (modo === 'pronto') {
        this.calar();
        this.pular(-650);
        this.falar(sorteia(FALAS.pronto), 1600);
        setTimeout(() => { if (this.modo === 'pronto') this.definir('livre'); }, 1800);
      } else if (modo === 'erro') {
        this.classe('triste');
        this.falar(sorteia(FALAS.erro), 2200);
        setTimeout(() => { if (this.modo === 'erro') this.definir('livre'); }, 2400);
      } else {
        this.calar();
      }
    }

    // --- passeio quando está livre ------------------------------------------
    async loopLivre() {
      await espera(600);
      if (this.modo === 'livre') { this.classe('acenando'); this.falar('Oi! Eu sou o orquestrador.', 2200); await espera(2200); this.classe('acenando', false); }
      for (;;) {
        await espera(900 + Math.random() * 1600);
        if (!this.el.isConnected) return;
        if (this.modo !== 'livre' || this.noAr || this.arrastando || parado()) continue;
        const passo = this.passo;
        if (Date.now() - this.ultimoMovimento > SONO_MS) { await this.dormir(); continue; }
        const gesto = sorteia(['olhar', 'piscar', 'piscar', 'andar', 'andar', 'andar', 'acenar', 'pular', 'dancar', 'sentar', 'espreguicar', 'nada', 'nada']);
        await this[`g_${gesto}`](passo);
      }
    }
    vale(passo) { return passo === this.passo && this.modo === 'livre' && !this.arrastando && !this.noAr; }
    async g_olhar(passo) {
      for (const lado of sorteia([['esq', 'dir'], ['dir', 'esq'], ['esq'], ['dir']])) {
        if (!this.vale(passo)) break;
        this.olhar(lado); await espera(900);
      }
      this.olhar('');
    }
    async g_piscar() {
      this.classe('piscando'); await espera(170); this.classe('piscando', false);
      await espera(220);
      this.classe('piscando'); await espera(170); this.classe('piscando', false);
    }
    async g_acenar(passo) {
      this.classe('acenando'); this.falar(sorteia(['Oi!', 'Tô aqui!', 'E aí?', 'Tchau!']), 1500);
      await espera(1500);
      if (passo === this.passo) this.classe('acenando', false);
    }
    async g_pular() { this.pular(-600); }
    async g_nada() {}
    async g_dancar(passo) {
      this.classe('dancando');
      if (Math.random() < 0.4) this.falar(sorteia(['♪ ♫', 'Tum tss tum tss', '♪ la la la']), 1600);
      await espera(2200);
      if (passo === this.passo) this.classe('dancando', false);
    }
    async g_sentar(passo) {
      this.classe('sentado');
      await espera(2500 + Math.random() * 2500);
      if (passo === this.passo) this.classe('sentado', false);
    }
    async g_espreguicar(passo) {
      this.classe('espreguicando');
      await espera(1300);
      if (passo === this.passo) this.classe('espreguicando', false);
    }
    // Cochilo: acorda quando o mouse ou o teclado mexem.
    async dormir() {
      const passo = this.passo;
      this.dormindo = true;
      this.classe('dormindo');
      this.el.querySelector('.pet-zzz').hidden = false;
      while (this.dormindo && passo === this.passo && this.modo === 'livre') await espera(400);
      this.el.querySelector('.pet-zzz').hidden = true;
      this.classe('dormindo', false);
      if (this.dormindo === false && this.modo === 'livre') {
        this.classe('espreguicando'); this.falar(sorteia(FALAS.acordar), 1500);
        await espera(1200); this.classe('espreguicando', false);
      }
      this.dormindo = false;
    }
    acordar() { if (this.dormindo) this.dormindo = false; }

    // --- reações ao mouse e ao teclado ----------------------------------------
    ligarReacoes() {
      let ultimoOlhar = 0;
      const mexeu = () => { this.ultimoMovimento = Date.now(); this.acordar(); };
      document.addEventListener('keydown', mexeu, { passive: true });
      document.addEventListener('pointermove', (ev) => {
        mexeu();
        // Os olhos seguem o mouse (no máximo 10 vezes por segundo).
        const agora = performance.now();
        if (agora - ultimoOlhar < 100 || this.modo !== 'livre' || this.arrastando || this.el.classList.contains('andando')) return;
        ultimoOlhar = agora;
        const r = this.el.getBoundingClientRect();
        const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
        const lado = Math.abs(dx) < 60 && dy < -40 ? 'cima' : Math.abs(dx) < 40 ? '' : dx < 0 ? 'esq' : 'dir';
        if (this.ladoOlhar !== lado) this.olhar(lado);
      }, { passive: true });
      // Mouse em cima um tempinho: fica feliz.
      let tCarinho = null;
      this.el.addEventListener('pointerenter', () => {
        clearTimeout(tCarinho);
        tCarinho = setTimeout(() => {
          if (this.modo !== 'livre' || this.arrastando) return;
          this.classe('feliz');
          const c = this.el.querySelector('.pet-coracao');
          c.hidden = false; c.classList.remove('sobe'); void c.offsetWidth; c.classList.add('sobe');
          if (Math.random() < 0.5) this.falar(sorteia(FALAS.carinho), 1200);
        }, 600);
      });
      this.el.addEventListener('pointerleave', () => { clearTimeout(tCarinho); this.classe('feliz', false); setTimeout(() => { this.el.querySelector('.pet-coracao').hidden = true; }, 900); });
      this.el.addEventListener('dblclick', (ev) => { ev.preventDefault(); this.calar(); this.aoChamar(); });
      this.el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.aoMenu(ev); });
    }

    // Troca a roupa/cor (petVisual): mantém as classes de animação.
    vestir(visual) {
      this.visual = window.petVisual ? window.petVisual.limpar(visual) : null;
      this.vira.innerHTML = window.petVisual ? window.petVisual.svg(this.visual) : '';
    }
    esconder(sim) { this.escondido = !!sim; this.el.hidden = !!sim; }
    // Jeito de se mexer da espécie: anda (clássico), voa (fantasma, nuvem) ou pula (gosma).
    jeito() { const e = window.petVisual && window.petVisual.ESPECIES[this.visual && this.visual.especie]; return (e && e.jeito) || 'anda'; }
    async g_andar(passo) {
      if (this.jeito() === 'voa') return this.voarAte(passo);
      if (this.jeito() === 'pula') return this.pularAte(passo);
      const [min, max] = this.faixa();
      // Fora da faixa (caiu ali depois de um arremesso): volta para ela.
      const destino = this.x < min || this.x > max
        ? min + Math.random() * (max - min)
        : Math.max(min, Math.min(max, this.x + sorteia([-1, 1]) * (40 + Math.random() * 120)));
      const lado = destino < this.x ? 'esq' : 'dir';
      this.virar(lado); this.olhar(lado);
      this.classe('andando');
      const vel = 70; // px/s
      let ultimo = performance.now();
      await new Promise((fim) => {
        const quadro = (t) => {
          const dt = (t - ultimo) / 1000; ultimo = t;
          if (!this.vale(passo)) return fim();
          const dx = destino - this.x;
          if (Math.abs(dx) < 1) return fim();
          const antes = this.x;
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), vel * dt);
          // Saiu da beirada: cai. Coisa mais alta na frente: é parede, para.
          const ch = this.chaoEm(this.x, this.y + ALT);
          if (ch > this.y + 2) { this.desenhar(); this.classe('andando', false); this.voar(); return fim(); }
          if (ch < this.y - 2) { this.x = antes; this.desenhar(); return fim(); }
          this.desenhar();
          quadroSeguinte(quadro);
        };
        quadroSeguinte(quadro);
      });
      this.classe('andando', false);
      this.olhar('');
    }

    // Fantasma e nuvem: voam para um ponto qualquer da sala, balançando.
    async voarAte(passo) {
      const s = this.sala();
      if (!s) return;
      const [min, max] = this.faixa();
      const alvo = { x: min + Math.random() * (max - min), y: s.teto + 20 + Math.random() * Math.max(10, this.chaoEm(this.x, this.y + ALT) - s.teto - 20) };
      this.virar(alvo.x < this.x ? 'esq' : 'dir');
      this.classe('andando');
      const vel = 60;
      let ultimo = performance.now();
      await new Promise((fim) => {
        const quadro = (t) => {
          const dt = (t - ultimo) / 1000; ultimo = t;
          if (!this.vale(passo)) return fim();
          const dx = alvo.x - this.x, dy = alvo.y - this.y, d = Math.hypot(dx, dy);
          if (d < 1.5) return fim();
          const k = Math.min(1, (vel * dt) / d);
          this.x += dx * k; this.y += dy * k;
          this.desenhar();
          quadroSeguinte(quadro);
        };
        quadroSeguinte(quadro);
      });
      this.classe('andando', false);
    }
    // Gosma: vai pulando até o destino (2 a 4 pulinhos).
    async pularAte(passo) {
      const [min, max] = this.faixa();
      const destino = min + Math.random() * (max - min);
      const lado = destino < this.x ? -1 : 1;
      this.virar(lado < 0 ? 'esq' : 'dir');
      for (let i = 0; i < 4 && this.vale(passo) && Math.abs(destino - this.x) > 20; i++) {
        this.vx = lado * Math.min(170, Math.abs(destino - this.x) * 1.6);
        this.vy = -760;
        this.voar();
        for (let k = 0; k < 60 && this.noAr; k++) await espera(40);
        await espera(120);
      }
    }

    // --- física: pulo, queda, arremesso -----------------------------------
    pular(vy) {
      if (this.noAr || this.arrastando) return;
      if (this.jeito() === 'pula') vy *= 1.45; // a gosma pula mais alto
      this.vy = vy; this.vx = 0;
      this.voar();
    }
    voar() {
      this.noAr = true;
      this.classe('voando');
      let ultimo = performance.now();
      const quadro = (t) => {
        if (this.arrastando) return;
        const dt = Math.min((t - ultimo) / 1000, 0.04); ultimo = t;
        const voa = this.jeito() === 'voa';
        // Quem voa não tem gravidade: o empurrão vai perdendo força no ar.
        if (voa) { this.vx *= Math.pow(0.12, dt); this.vy *= Math.pow(0.12, dt); } else this.vy += GRAVIDADE * dt;
        const pesAntes = this.y + ALT;
        this.x += this.vx * dt; this.y += this.vy * dt;
        // Paredes, teto e chão da sala dele (o painel onde foi solto).
        const s = this.sala() || { x0: 0, x1: innerWidth - LARG, teto: 0, chao: innerHeight - ALT };
        if (this.x < s.x0) { this.x = s.x0; this.vx = -this.vx * QUIQUE; }
        if (this.x > s.x1) { this.x = s.x1; this.vx = -this.vx * QUIQUE; }
        if (this.y < s.teto) { this.y = s.teto; this.vy = -this.vy * QUIQUE; }
        const chao = this.vy >= 0 ? this.chaoEm(this.x, pesAntes) : s.chao;
        if (voa) {
          if (this.y > chao) { this.y = chao; this.vy = -this.vy * QUIQUE; }
          if (Math.hypot(this.vx, this.vy) < 25) { this.vx = 0; this.vy = 0; this.noAr = false; this.classe('voando', false); this.desenhar(); return; }
          this.desenhar();
          quadroSeguinte(quadro);
          return;
        }
        if (this.y >= chao) {
          this.y = chao;
          const forte = this.vy > 900;
          if (this.vy > 260) {
            this.vy = -this.vy * QUIQUE; this.vx *= 0.7;
            this.classe('amassado'); setTimeout(() => this.classe('amassado', false), 120);
            if (forte && this.modo === 'livre') this.falar(sorteia(['Ai!', 'Uou!', 'Opa!']), 1100);
          } else {
            this.vy = 0; this.vx = 0; this.noAr = false;
            this.classe('voando', false);
            this.desenhar();
            return;
          }
        }
        if (Math.abs(this.vx) > 30) this.virar(this.vx < 0 ? 'esq' : 'dir');
        this.desenhar();
        quadroSeguinte(quadro);
      };
      quadroSeguinte(quadro);
    }

    ligarMouse() {
      let rastro = [];
      let pegou = { dx: 0, dy: 0 };
      let clique = { x: 0, y: 0, t: 0, falou: false }; // onde apertou: para saber se foi só um clique
      this.el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.el.setPointerCapture(ev.pointerId);
        this.arrastando = true; this.noAr = false;
        this.classe('arrastado'); this.classe('voando', false);
        const r = this.palco.getBoundingClientRect();
        pegou = { dx: ev.clientX - r.left - this.x, dy: ev.clientY - r.top - this.y };
        rastro = [{ x: ev.clientX, y: ev.clientY, t: performance.now() }];
        clique = { x: ev.clientX, y: ev.clientY, t: performance.now(), falou: false };
      });
      this.el.addEventListener('pointermove', (ev) => {
        if (!this.arrastando) return;
        const r = this.palco.getBoundingClientRect();
        // Segurando, ele atravessa as paredes: vai a qualquer painel da janela.
        this.x = Math.min(Math.max(ev.clientX - r.left - pegou.dx, 0), this.palco.clientWidth - LARG);
        this.y = Math.min(Math.max(ev.clientY - r.top - pegou.dy, 0), this.palco.clientHeight - ALT);
        rastro.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
        rastro = rastro.filter((p) => performance.now() - p.t < 90);
        if (!clique.falou && Math.hypot(ev.clientX - clique.x, ev.clientY - clique.y) > 12 && this.modo === 'livre') { clique.falou = true; this.falar(sorteia(['Ei!', 'Me solta!', 'Uiii!', 'Para onde vamos?']), 1200); }
        if (rastro.length > 1) this.virar(rastro[rastro.length - 1].x < rastro[0].x ? 'esq' : 'dir');
        this.desenhar();
      });
      const soltar = () => {
        if (!this.arrastando) return;
        this.arrastando = false;
        this.classe('arrastado', false);
        const a = rastro[0], b = rastro[rastro.length - 1];
        // Só um clique (sem arrastar): pula e fala, em vez de cair.
        if (Math.hypot(b.x - clique.x, b.y - clique.y) < 5 && performance.now() - clique.t < 400) {
          this.escolherSala(); this.y = this.chao(); this.desenhar();
          if (this.modo === 'livre') { this.pular(-520); this.falar(sorteia(FALAS.clique), 1400); }
          return;
        }
        const dt = Math.max((b.t - a.t) / 1000, 0.016);
        this.vx = Math.max(-2500, Math.min(2500, (b.x - a.x) / dt));
        this.vy = Math.max(-2500, Math.min(2500, (b.y - a.y) / dt));
        if (performance.now() - b.t > 120) { this.vx = 0; this.vy = 0; } // parou antes de soltar
        // Fica preso no painel onde foi solto e cai até o chão dele.
        this.escolherSala();
        this.voar();
      };
      this.el.addEventListener('pointerup', soltar);
      this.el.addEventListener('pointercancel', soltar);
    }
  }

  window.criarPet = (palco) => { const p = new Pet(palco); window.orqPetAtual = p; return p; };
})();
