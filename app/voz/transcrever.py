"""Transcreve um áudio no próprio computador com o faster-whisper (motor do app: transcricao.js).

Uso: python transcrever.py <arquivo> --modelo large-v3-turbo [--idioma pt] [--baixar]

Saída: uma linha de JSON por evento, para o app mostrar o andamento:
  {"t": "inicio", "modelo": ..., "aparelho": "cpu"|"cuda", "duracao": segundos}
  {"t": "trecho", "ini": s, "fim": s, "texto": "..."}
  {"t": "progresso", "pct": 0..100}
  {"t": "fim", "trechos": n}
  {"t": "erro", "erro": "..."}

Só lê modelo que já está no computador; baixar só com --baixar (o app passa quando a pessoa
clica para baixar). Roda com prioridade baixa, para não pesar no resto do computador.
"""
import glob
import json
import os
import sys


def dizer(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        dizer({"t": "erro", "erro": "faltou o arquivo"})
        return 2
    arquivo = args[0]
    opcoes = {}
    i = 1
    while i < len(args):
        if args[i] == "--baixar":
            opcoes["baixar"] = True
            i += 1
        elif args[i] in ("--modelo", "--idioma") and i + 1 < len(args):
            opcoes[args[i][2:]] = args[i + 1]
            i += 2
        else:
            i += 1
    modelo = opcoes.get("modelo", "large-v3-turbo")
    idioma = opcoes.get("idioma", "pt")
    try:
        os.nice(10)
    except OSError:
        pass
    # As bibliotecas da NVIDIA instaladas pelo pip precisam estar no caminho antes de o processo carregar.
    libs = glob.glob(os.path.join(os.path.dirname(os.path.dirname(sys.executable)), "lib", "python3.*", "site-packages", "nvidia", "*", "lib"))
    atual = os.environ.get("LD_LIBRARY_PATH", "")
    if libs and libs[0] not in atual and not os.environ.get("ORQ_VOZ_REEXEC"):
        os.environ["LD_LIBRARY_PATH"] = ":".join(libs + ([atual] if atual else []))
        os.environ["ORQ_VOZ_REEXEC"] = "1"
        os.execve(sys.executable, [sys.executable] + sys.argv, os.environ)
    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001
        dizer({"t": "erro", "erro": f"faster-whisper não está instalado neste Python: {e}"})
        return 3
    so_local = not opcoes.get("baixar")
    nucleos = max(1, (os.cpu_count() or 2) - 2)
    try:
        m = WhisperModel(modelo, device="cuda", compute_type="float16", local_files_only=so_local)
        aparelho = "cuda"
    except Exception:  # noqa: BLE001
        try:
            m = WhisperModel(modelo, device="cpu", compute_type="int8", cpu_threads=nucleos, local_files_only=so_local)
            aparelho = "cpu"
        except Exception as e:  # noqa: BLE001
            texto = str(e)
            if so_local and ("local" in texto.lower() or "snapshot" in texto.lower() or "cache" in texto.lower()):
                texto = f"o modelo {modelo} ainda não está neste computador"
            dizer({"t": "erro", "erro": texto})
            return 4
    try:
        trechos, info = m.transcribe(arquivo, language=idioma or None, vad_filter=True, beam_size=5)
        dizer({"t": "inicio", "modelo": modelo, "aparelho": aparelho, "duracao": round(info.duration or 0, 2)})
        n = 0
        ultimo = -1
        for s in trechos:
            texto = (s.text or "").strip()
            if texto:
                n += 1
                dizer({"t": "trecho", "ini": round(s.start, 2), "fim": round(s.end, 2), "texto": texto})
            if info.duration:
                pct = min(99, int(s.end * 100 / info.duration))
                if pct != ultimo:
                    ultimo = pct
                    dizer({"t": "progresso", "pct": pct})
        dizer({"t": "progresso", "pct": 100})
        dizer({"t": "fim", "trechos": n})
        return 0
    except Exception as e:  # noqa: BLE001
        dizer({"t": "erro", "erro": str(e)})
        return 5


if __name__ == "__main__":
    sys.exit(main())
