// O orquestrador em pessoa: o bichinho do Claude que mora no cantinho da
// conversa do orquestrador. Ele mostra o que o orquestrador está fazendo
// (pensando, trabalhando, mandando nos agentes, chamando o usuário) e, parado,
// passeia, olha, pisca e acena. Dá para pegar com o mouse e arremessar: ele cai
// com gravidade, quica nas paredes e volta a andar. Cada painel da janela
// (lateral, conversa, inspetor) é uma "sala" com chão e paredes: segurando,
// ele atravessa as paredes; solto, fica preso na sala onde caiu.
(() => {
  const SVG = `
    <svg class="pet-svg" viewBox="0 -2 12 9" shape-rendering="crispEdges" aria-hidden="true">
      <g class="pet-corpo">
        <rect class="braco braco-e" x="0" y="2" width="2" height="2"/>
        <rect class="braco braco-d" x="10" y="2" width="2" height="2"/>
        <rect x="2" y="0" width="8" height="5"/>
        <g class="olhos"><rect class="olho" x="3" y="1" width="1" height="2"/><rect class="olho" x="8" y="1" width="1" height="2"/></g>
      </g>
      <rect class="perna p1" x="2" y="5" width="1" height="2"/>
      <rect class="perna p2" x="4" y="5" width="1" height="2"/>
      <rect class="perna p3" x="7" y="5" width="1" height="2"/>
      <rect class="perna p4" x="9" y="5" width="1" height="2"/>
    </svg>`;
  const LARG = 64, ALT = 48;       // tamanho do bichinho na tela
  const GRAVIDADE = 2400;          // px/s²
  const QUIQUE = 0.42;             // quanto da velocidade sobra ao bater
  const CHAVE = 'pet-sala';        // sala onde ele mora (guardada entre aberturas)
  // As salas: o painel de cada uma, em coordenadas da janela.
  const SALAS = { esquerda: '.lateral', centro: '.mensagens-area', direita: '.inspetor' };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const sorteia = (l) => l[Math.floor(Math.random() * l.length)];
  const parado = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Próximo quadro da animação. Com a janela escondida ou minimizada o
  // navegador pausa o requestAnimationFrame; aí a física segue por relógio.
  const quadroSeguinte = (fn) => (document.hidden ? setTimeout(() => fn(performance.now()), 16) : requestAnimationFrame(fn));

  // Modos que vêm do orquestrador; "livre" é quando ele não está fazendo nada.
  const FALAS = {
    pensando: ['Hmm…', 'Deixa eu ver…', 'Pensando…'],
    trabalhando: ['Mão na massa!', 'Trabalhando…', 'Já vai!'],
    pronto: ['Pronto!', 'Feito!', 'Prontinho!'],
    chamando: ['Ei! Preciso de você', 'Sua vez!', 'Uma pergunta!'],
    erro: ['Ops…', 'Deu ruim…'],
  };

  class Pet {
    constructor(palco) {
      this.palco = palco;
      this.el = document.createElement('div');
      this.el.className = 'pet';
      this.el.title = 'O orquestrador. Arraste para mover, solte com força para jogar.';
      this.el.innerHTML = `<div class="pet-balao" hidden></div><div class="pet-nuvem" hidden><i></i><i></i><i></i></div><div class="pet-vira">${SVG}</div>`;
      palco.append(this.el);
      this.vira = this.el.querySelector('.pet-vira');
      this.balao = this.el.querySelector('.pet-balao');
      this.x = null; this.y = 0; this.vx = 0; this.vy = 0;
      this.noAr = false; this.arrastando = false;
      this.modo = 'livre';
      this.passo = 0; // muda a cada gesto: um gesto antigo para quando vê que perdeu a vez
      try { this.salaNome = localStorage.getItem(CHAVE) || 'centro'; } catch { this.salaNome = 'centro'; }
      if (!SALAS[this.salaNome]) this.salaNome = 'centro';
      this.ligarMouse();
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
    chao() { const s = this.sala(); return s ? s.chao : this.y; }
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
      this.y = s.chao;
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
    olhar(lado) { this.el.dataset.olhar = lado || ''; }
    virar(lado) { this.vira.classList.toggle('virado', lado === 'esq'); }
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
        const gesto = sorteia(['olhar', 'olhar', 'piscar', 'piscar', 'andar', 'andar', 'andar', 'acenar', 'pular', 'nada']);
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
    async g_andar(passo) {
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
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), vel * dt);
          this.desenhar();
          quadroSeguinte(quadro);
        };
        quadroSeguinte(quadro);
      });
      this.classe('andando', false);
      this.olhar('');
    }

    // --- física: pulo, queda, arremesso -----------------------------------
    pular(vy) {
      if (this.noAr || this.arrastando) return;
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
        this.vy += GRAVIDADE * dt;
        this.x += this.vx * dt; this.y += this.vy * dt;
        // Paredes, teto e chão da sala dele (o painel onde foi solto).
        const s = this.sala() || { x0: 0, x1: innerWidth - LARG, teto: 0, chao: innerHeight - ALT };
        if (this.x < s.x0) { this.x = s.x0; this.vx = -this.vx * QUIQUE; }
        if (this.x > s.x1) { this.x = s.x1; this.vx = -this.vx * QUIQUE; }
        if (this.y < s.teto) { this.y = s.teto; this.vy = -this.vy * QUIQUE; }
        const chao = s.chao;
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
      this.el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.el.setPointerCapture(ev.pointerId);
        this.arrastando = true; this.noAr = false;
        this.classe('arrastado'); this.classe('voando', false);
        const r = this.palco.getBoundingClientRect();
        pegou = { dx: ev.clientX - r.left - this.x, dy: ev.clientY - r.top - this.y };
        rastro = [{ x: ev.clientX, y: ev.clientY, t: performance.now() }];
        if (this.modo === 'livre') this.falar(sorteia(['Ei!', 'Me solta!', 'Uiii!', 'Para onde vamos?']), 1200);
      });
      this.el.addEventListener('pointermove', (ev) => {
        if (!this.arrastando) return;
        const r = this.palco.getBoundingClientRect();
        // Segurando, ele atravessa as paredes: vai a qualquer painel da janela.
        this.x = Math.min(Math.max(ev.clientX - r.left - pegou.dx, 0), this.palco.clientWidth - LARG);
        this.y = Math.min(Math.max(ev.clientY - r.top - pegou.dy, 0), this.palco.clientHeight - ALT);
        rastro.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
        rastro = rastro.filter((p) => performance.now() - p.t < 90);
        if (rastro.length > 1) this.virar(rastro[rastro.length - 1].x < rastro[0].x ? 'esq' : 'dir');
        this.desenhar();
      });
      const soltar = () => {
        if (!this.arrastando) return;
        this.arrastando = false;
        this.classe('arrastado', false);
        const a = rastro[0], b = rastro[rastro.length - 1];
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

  window.criarPet = (palco) => new Pet(palco);
})();
