#!/usr/bin/env python3
"""Gera fotocal-artifact.html: o FotoCal em uma única página para publicar
no claude.ai, onde a análise de fotos usa o Claude da própria conta (sem chave).

Uso: python3 build-artifact.py [saida.html]
"""
import pathlib
import re
import sys

here = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "fotocal-artifact.html"

css = (here / "styles.css").read_text()
ai = (here / "ai-claude-app.js").read_text()
app = (here / "app.js").read_text()

# ai-claude-app.js vira um objeto AI no mesmo script
ai = re.sub(r"^export ", "", ai, flags=re.M)
ai += "\nconst AI = { ScanError, needsKey, useServiceWorker, analyzeFoodPhoto };\n"
app = app.replace('import * as AI from "./ai.js";', "")

# No claude.ai o :root já é recuado pela área segura do topo.
extra_css = """
:root { --safe-t: 0px; }
.ob-top { top: env(safe-area-inset-top, 0px); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg-top); }
"""

html = f"""<title>FotoCal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
{css}
{extra_css}
</style>
<div id="app" aria-live="polite"></div>
<div id="toast" role="status"></div>
<script type="module">
{ai}
{app}
</script>
"""
out.write_text(html)
print(f"ok: {out} ({len(html) // 1024} KB)")
