#!/usr/bin/env python3
# orq-meet-host — o lado do computador da extensão "Orquestrador: quem fala no Meet".
# (arquivo do App de Orquestração; o navegador o abre pela extensão, por native messaging)
#
# Recebe da extensão, pela entrada padrão, mensagens no formato do navegador (4 bytes com o
# tamanho, em little-endian, e o JSON) e responde do mesmo jeito. Só guarda alguma coisa enquanto
# o app está gravando uma reunião (~/.local/share/orq-app/meet/estado.json diz "gravando"); fora
# disso, responde e joga fora. Guarda em ~/.local/share/orq-app/meet/eventos.jsonl, sempre
# acrescentando ao fim: nomes de quem participa e quem fala a cada momento. Nada de áudio nem de
# texto falado; nada sai do computador. Em contato.json, a hora da última conversa com a extensão.
import json
import os
import struct
import sys
import time

PASTA = os.path.join(os.path.expanduser("~"), ".local", "share", "orq-app", "meet")
MAX_MENSAGEM = 64 * 1024


def ler():
    cab = sys.stdin.buffer.read(4)
    if len(cab) < 4:
        return None
    n = struct.unpack("<I", cab)[0]
    if n > MAX_MENSAGEM:
        sys.stdin.buffer.read(n)  # grande demais: descarta e segue
        return {"t": "grande"}
    dados = sys.stdin.buffer.read(n)
    try:
        return json.loads(dados.decode("utf-8"))
    except Exception:
        return {}


def responder(o):
    b = json.dumps(o, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(b)) + b)
    sys.stdout.buffer.flush()


def gravando():
    try:
        with open(os.path.join(PASTA, "estado.json"), encoding="utf-8") as f:
            return bool(json.load(f).get("gravando"))
    except Exception:
        return False


def nome(x):
    return x.strip()[:120] if isinstance(x, str) and x.strip() else None


def limpar(m):
    ts = int(time.time() * 1000)
    t = m.get("t")
    if t == "falando":
        q = nome(m.get("quem"))
        return {"t": "falando", "ts": ts, "quem": q} if q else None
    if t == "participantes" and isinstance(m.get("nomes"), list):
        nomes = [n for n in (nome(x) for x in m["nomes"][:200]) if n]
        return {"t": "participantes", "ts": ts, "nomes": nomes, "eu": nome(m.get("eu"))}
    return None


def guardar(e):
    os.makedirs(PASTA, mode=0o700, exist_ok=True)
    fd = os.open(os.path.join(PASTA, "eventos.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(e, ensure_ascii=False) + "\n").encode("utf-8"))
    finally:
        os.close(fd)


def contato(ultimo):
    # Para as Configurações do app dizerem quando a extensão falou com ele pela última vez.
    agora = time.time()
    if agora - ultimo < 60:
        return ultimo
    try:
        os.makedirs(PASTA, mode=0o700, exist_ok=True)
        tmp = os.path.join(PASTA, f".contato-{os.getpid()}.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ts": int(agora * 1000)}) + "\n")
        os.replace(tmp, os.path.join(PASTA, "contato.json"))
    except Exception:
        pass
    return agora


def main():
    ultimo = 0
    while True:
        m = ler()
        if m is None:
            return
        if not isinstance(m, dict):
            continue
        if m.get("t") == "grande":
            responder({"t": "erro", "motivo": "mensagem grande demais"})
            continue
        g = gravando()
        if m.get("t") == "estado":
            ultimo = contato(ultimo)
            responder({"t": "estado", "gravando": g})
            continue
        e = limpar(m)
        if e and g:
            guardar(e)
        responder({"t": "ok", "guardado": bool(e and g)})


if __name__ == "__main__":
    main()
