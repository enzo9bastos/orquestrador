// O orquestrador em pessoa: o bichinho do Claude que mora no cantinho da
// conversa do orquestrador. Ele mostra o que o orquestrador está fazendo
// (pensando, trabalhando, mandando nos agentes, chamando o usuário) e, parado,
// passeia, olha, pisca e acena. Dá para pegar com o mouse e arremessar: ele cai
// com gravidade, quica nas paredes e volta a andar. Solto devagar, ele fica
// "estacionado" onde foi deixado (até meio para fora da parede), sem andar,
// para não atrapalhar a leitura; jogando de novo, ele volta a passear.
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
  const SOLTAR_DEVAGAR = 350;      // px/s: abaixo disso, soltar é estacionar
  const CHAVE = 'pet-estacionado'; // posição guardada (frações do palco)
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const sorteia = (l) => l[Math.floor(Math.random() * l.length)];
  const parado = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      try { this.estacionado = JSON.parse(localStorage.getItem(CHAVE)); } catch { this.estacionado = null; }
      this.ligarMouse();
      new ResizeObserver(() => this.encaixar()).observe(palco);
      this.loopLivre();
    }

    // --- chão e paredes ---------------------------------------------------
    chao() { return this.palco.clientHeight - ALT; }
    direita() { return this.palco.clientWidth - LARG - 8; }
    // Onde ele pode passear sem ficar em cima do texto: com tela larga, só na
    // margem à direita da coluna da conversa; com tela estreita, onde der.
    faixa() {
      const caixa = document.querySelector('.caixa-entrada');
      const dir = this.direita();
      if (caixa) {
        const inicio = caixa.getBoundingClientRect().right - this.palco.getBoundingClientRect().left + 12;
        if (dir - inicio >= 0) return [inicio, dir];
      }
      return [Math.max(8, dir - 140), dir];
    }
    encaixar() {
      if (this.estacionado && !this.arrastando && !this.noAr) {
        this.x = this.estacionado.fx * this.palco.clientWidth;
        this.y = this.estacionado.fy * this.palco.clientHeight;
        this.desenhar();
        return;
      }
      if (this.x == null) { this.x = this.direita(); this.y = this.chao(); }
      this.x = Math.min(Math.max(this.x, 8), this.direita());
      if (!this.noAr && !this.arrastando) this.y = this.chao();
      this.desenhar();
    }
    desenhar() {
      this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
      this.el.classList.toggle('balao-embaixo', this.y < 44); // perto do teto, fala para baixo
    }
    estacionar() {
      this.estacionado = { fx: this.x / this.palco.clientWidth, fy: this.y / this.palco.clientHeight };
      try { localStorage.setItem(CHAVE, JSON.stringify(this.estacionado)); } catch { /* sem armazenamento */ }
      this.vx = 0; this.vy = 0; this.noAr = false;
      this.classe('voando', false);
      if (this.modo === 'livre') this.falar(sorteia(['Fico aqui quietinho.', 'Daqui eu vejo tudo.', 'Tô de olho!']), 1600);
    }
    desestacionar() {
      this.estacionado = null;
      try { localStorage.removeItem(CHAVE); } catch { /* sem armazenamento */ }
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
        // Estacionado: só gestos no lugar (nada de andar nem pular).
        const gesto = this.estacionado
          ? sorteia(['olhar', 'olhar', 'piscar', 'piscar', 'acenar', 'nada', 'nada'])
          : sorteia(['olhar', 'olhar', 'piscar', 'piscar', 'andar', 'andar', 'andar', 'acenar', 'pular', 'nada']);
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
          requestAnimationFrame(quadro);
        };
        requestAnimationFrame(quadro);
      });
      this.classe('andando', false);
      this.olhar('');
    }

    // --- física: pulo, queda, arremesso -----------------------------------
    pular(vy) {
      if (this.noAr || this.arrastando) return;
      if (this.estacionado) { this.classe('pulinho'); setTimeout(() => this.classe('pulinho', false), 500); return; }
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
        const dir = this.direita();
        if (this.x < 8) { this.x = 8; this.vx = -this.vx * QUIQUE; }
        if (this.x > dir) { this.x = dir; this.vx = -this.vx * QUIQUE; }
        if (this.y < 0) { this.y = 0; this.vy = -this.vy * QUIQUE; }
        const chao = this.chao();
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
        requestAnimationFrame(quadro);
      };
      requestAnimationFrame(quadro);
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
        // Segurando, ele atravessa as paredes: pode ficar até quase metade para fora.
        this.x = Math.min(Math.max(ev.clientX - r.left - pegou.dx, -LARG * 0.45), this.palco.clientWidth - LARG * 0.55);
        this.y = Math.min(Math.max(ev.clientY - r.top - pegou.dy, -ALT * 0.45), this.palco.clientHeight - ALT * 0.55);
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
        // Parado na mão ou movendo devagar: fica onde foi deixado.
        const parouHaPouco = performance.now() - b.t > 120;
        if (parouHaPouco || Math.hypot(this.vx, this.vy) < SOLTAR_DEVAGAR) { this.estacionar(); return; }
        this.desestacionar();
        this.voar();
      };
      this.el.addEventListener('pointerup', soltar);
      this.el.addEventListener('pointercancel', soltar);
    }
  }

  window.criarPet = (palco) => new Pet(palco);
})();
