#!/usr/bin/env bash
# comfyweb — arranque para Mac / Linux (equivalente a run-colab.bat de Windows)
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  comfyweb  ->  http://localhost:8085"
echo "  Pega la URL de tu Colab en el boton 'Colab (Cloudflare)'."
echo "============================================================"

# Primera vez: instala dependencias
if [ ! -d node_modules ]; then
  echo "Primera vez: instalando dependencias..."
  npm install
fi

node server.js
