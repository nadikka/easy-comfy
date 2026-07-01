# comfyweb — *easy comfy*

Una UI web simple para generar imágenes con **ComfyUI**, sin tener que armar el grafo de nodos
a mano. Vos escribís lo que querés, elegís un modo, y comfyweb le habla por detrás a una
instancia de ComfyUI (local o en la nube) y te devuelve la imagen.

La gracia: **el cómputo (la GPU) no corre en tu PC** — corre en un **Google Colab gratuito**.
comfyweb es solo la interfaz liviana que corre en tu máquina y le manda los pedidos al Colab.

```
   Tu navegador  ─►  comfyweb (Node, tu PC)  ─►  ComfyUI + GPU (Google Colab)
   localhost:8085                                 (túnel público de Cloudflare)
```

---

## Cómo se ve · What it looks like

Interfaz bilingüe (Español / English) — al abrir elegís idioma, y podés cambiarlo cuando quieras
con el botón 🌐. *Bilingual UI — pick your language on start, switch anytime with the 🌐 button.*

**Español**

![easy comfy — portada](docs/screenshots/shot-es-1.png)
![easy comfy — modos e imagen de partida](docs/screenshots/shot-es-2.png)
![easy comfy — controles y galería](docs/screenshots/shot-es-3.png)

**English**

![easy comfy — home](docs/screenshots/shot-en-1.png)
![easy comfy — modes and starting image](docs/screenshots/shot-en-2.png)
![easy comfy — controls and gallery](docs/screenshots/shot-en-3.png)

> La imagen del zorro es un ejemplo generado con este mismo pipeline (Z-Image Turbo).
> *The fox image is a sample generated with this same pipeline (Z-Image Turbo).*

---

## Son dos partes (y las dos son tuyas)

1. **comfyweb** (este repo) — la UI, corre en tu PC.
2. **El Colab** — la GPU. Vive en un repo aparte:
   **https://github.com/nadikka/comfy-colab-leo** (notebook `ComfyUI_Web.ipynb`).

El Colab lo abrís y corrés **en tu propia cuenta de Google** — usás *tu* GPU gratis, no la de
nadie más. El notebook baja los modelos a *tu* Google Drive y te da una URL pública para
conectar tu comfyweb. Todo bajo tu cuenta, sin depender de que otra persona esté online.

> Podés abrir el notebook directo en Colab acá:
> https://colab.research.google.com/github/nadikka/comfy-colab-leo/blob/master/ComfyUI_Web.ipynb

---

## Qué necesitás (una sola vez)

1. **Node.js** instalado (v18 o mayor) → https://nodejs.org (botón "LTS").
2. Una **cuenta de Google** (para el Colab). No hace falta pagar nada.

No necesitás instalar ComfyUI, ni modelos, ni Python en tu PC. Todo eso vive en el Colab.

---

## Cómo se usa (cada vez, ~3 minutos)

### Paso 1 — Prender la GPU en Colab

1. Abrí el notebook: **https://colab.research.google.com/github/nadikka/comfy-colab-leo/blob/master/ComfyUI_Web.ipynb**
2. Arriba a la derecha, elegí una GPU: **Entorno de ejecución → Cambiar tipo de entorno → T4** (gratis).
3. **Entorno de ejecución → Ejecutar todo.** La primera vez baja los modelos a *tu* Google Drive
   (~14 GB, tarda un rato); las siguientes veces arranca en 2-3 min.
4. Cuando termine, abajo del todo imprime una **URL pública**, tipo:
   ```
   URL PÚBLICA (random, pegala en comfyweb):
   https://algo-algo-algo.trycloudflare.com
   ```
   **Copiá esa URL.** (Cambia cada vez que reiniciás el Colab — es normal.)

### Paso 2 — Prender comfyweb en tu PC

En una terminal, parado en esta carpeta:

```bash
npm install     # solo la primera vez
npm start
```

- **Windows:** también podés hacer doble clic en `run-colab.bat`.
- **Mac / Linux:** también podés correr `./start.sh`.

Se abre en **http://localhost:8085**.

### Paso 3 — Conectar y generar

1. En comfyweb, clic en **"Colab (Cloudflare)"**.
2. Pegá la URL `...trycloudflare.com` del Paso 1 y **"Guardar y Conectar"**.
3. Escribí tu prompt, elegí un modo y generá. Listo.

---

## Notas

- La URL del Colab **cambia** cada vez que reiniciás el notebook. Si perdés conexión,
  reejecutá la última celda del Colab, copiá la URL nueva y pegala de nuevo en el botón "Colab".
- comfyweb guarda tu URL en `config.json` (queda solo en tu PC, no se sube al repo).
- Si querés generar contra un ComfyUI **local** en vez de Colab, pegá `http://localhost:8188`.

---

## Créditos

comfyweb está construido sobre [**comfyweb** de jpupper](https://github.com/jpupper/comfyweb)
(el puente base ComfyUI↔web). La capa *easy comfy* (UI de intención, modos, integración con el
notebook de Colab de Z-Image) es trabajo propio sobre esa base.
