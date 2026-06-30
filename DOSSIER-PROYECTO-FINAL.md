# comfyweb — Dossier del Proyecto Final

> Diplomatura UNA · Módulo 4 (Z-Image) · proyecto **comfyweb**
> Una interfaz web de autor sobre ComfyUI, con cómputo en la nube y una capa educativa.
> Todas las rutas y números de línea citados salen del código real bajo
> `C:/Users/leoleo/Documents/Cosmos/herramientas/ComfyUI/KNOW_HOW/Preprocesadores/comfyweb/`.

---

## 0. Resumen ejecutivo

**Qué es comfyweb.** Una interfaz web propia que se monta arriba de ComfyUI para generar y editar imágenes con IA, escondiendo el "tablero de electricista" de nodos y cables detrás de botones y un casillero de texto. El usuario escribe un prompt, elige qué quiere lograr y aprieta *Generar*; comfyweb traduce eso a un grafo de nodos de ComfyUI, lo manda a procesar y devuelve la imagen. Es la misma máquina, con tablero de auto en vez de tablero de electricista.

**En qué estado está.** Funciona y está en uso real. El backend (`server.js`, Node + Express, puerto 8085) corre local en la máquina de Leo; el cómputo pesado vive en **Google Colab** (GPU T4 o L4), atravesado por un **túnel Cloudflare fijo** (`comfy.leoblumfeld.com`). Expone siete herramientas creativas (txt2img, img2img, ControlNet con 7 preprocesadores, LoRA, upscale 2×, describir imagen y editar por instrucción). El backend ya está **blindado contra el modo de falla más común** (Colab caído → respuesta no-JSON ya no tumba el server) y la generación viaja por HTTP polling, que es el camino confiable. La UI tiene un wizard de *progressive disclosure* que ya resuelve lo más difícil (el usuario nuevo ve solo prompt + tamaño + generar) y tiene el mejor pedazo de UX en sus tooltips, `.section-desc` y la guía de preprocesadores.

**Qué propone este dossier.** Cerrar las dos brechas que quedan abiertas — **recuperación** (que el sistema se reconecte solo) y **comunicación** (que le explique al usuario qué pasa sin mirar la consola) — y elevar el proyecto a entregable de diplomatura por tres vías:

1. **Robustez:** tapar la última grieta de crash y convertir las fallas tardías de 12 minutos en avisos instantáneos.
2. **Extensibilidad:** pasar de "una herramienta = editar 4 archivos coordinados" a "una herramienta = un manifiesto declarativo".
3. **UX educativa + rediseño:** un "Modo Aprender" que enriquece la UI *in situ* (no una pantalla aparte), microcopy en criollo por herramienta y por parámetro, y un re-skin con design tokens y dark/light que descansa el ojo.

La tesis del proyecto, dicha sin esconderla: **es una herramienta de autor construida sobre infraestructura prestada, y sabe exactamente dónde están sus bordes.**

---

## 1. Arquitectura actual

### 1.1 El diagrama

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ NAVEGADOR (public/)                                                            │
│  index.html + js/{script,wizard,qwen,qwen-edit,preproc,models,config,...}.js   │
│   • WS al server local:  ws(s)://<host>/  → mensajes 'generarImagen'           │
│   • REST al server local: fetch(apiUrl('/api/...'))  (apiUrl = BASE_PATH+path) │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ HTTP + WebSocket (mismo origen, puerto 8085)
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ comfyweb / server.js  — Node + Express, puerto 8085 (LOCAL, máquina de Leo)    │
│   • Sirve public/ (express.static), API REST, WS propio (ws.Server) + socket.io│
│   • Arma los workflows en JSON-API y los encola a ComfyUI                       │
│   • Descarga las imágenes a public/imagenes/ y avisa al browser                │
│   • config.json → comfyUrl = https://comfy.leoblumfeld.com                     │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ HTTPS (/prompt, /history, /view, /upload/image, /object_info,
                │        /system_stats, /leo/add_lora)  +  intento de WSS /ws
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cloudflare named tunnel  "comfy-leo"  → https://comfy.leoblumfeld.com           │
│   (DNS ruteado fijo; cloudflared corre dentro del Colab apuntando a :8188)     │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ http://127.0.0.1:8188 (dentro del runtime Colab)
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ComfyUI en Google Colab (GPU NVIDIA T4 o L4)                                    │
│   • main.py --dont-print-server, modelos en Drive vía extra_model_paths.yaml    │
│   • custom_nodes: controlnet_aux, TTP, Easy-Use, rgthree, Memory_Cleanup,       │
│     ComfyUI-GGUF, Simple_Qwen3-VL-gguf, leo_lora_fetch (mini-endpoint propio)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Decisiones de arquitectura que importan

- **Asimetría HTTP vs WS (el corazón de la robustez).** El server *intenta* un WebSocket a ComfyUI (`connectToComfyUI()`, `server.js:59-110`, `wss://comfy.leoblumfeld.com:443/ws`), pero los túneles cortan WS seguido. Por eso el camino confiable es **HTTP polling de `/history`**. El frontend lo sabe: cuando el WS a ComfyUI cae, **NO** pinta el indicador en rojo (`script.js:136-146`); el estado vivo/caído lo decide el ping HTTP (`/api/ping` → `/system_stats`, `config.js:112`).
- **Túnel *named* fijo.** La credencial `CF_TUNNEL_CRED` da una URL estable (`comfy.leoblumfeld.com`). Es un salto grande de robustez vs. URL random: si el runtime sobrevive, el front no necesita re-pegar URL. Si falta el secreto, cae a `pycloudflared` (URL random) — degradación razonable.
- **Doble base de URL de imágenes (trampa de config).** `IMAGE_BASE_URL` (env, default `https://vps-4455523-x.dattaweb.com/comfyweb`, `server.js:232`) es la base con que el server le manda las URLs de imagen al cliente. **Para uso local hay que exportar `IMAGE_BASE_URL="http://localhost:8085"`** o las imágenes apuntan al dominio equivocado.
- **`BASE_PATH`** (env, default `''`): permite servir bajo `/comfyweb` en el VPS. El front lo deduce solo del pathname (`base-path.js:4`).
- **Proveedor alternativo fal.ai.** Si `PROVIDER=fal` o `config.provider="fal"`, NO usa Colab ni ComfyUI: llama al API serverless de fal.ai (`fal.run/fal-ai/z-image/turbo`, `server.js:1162-1247`). Requiere `FAL_KEY`. Es una salida de emergencia si el Colab no está.

### 1.3 Endpoints y rutas de generación

La generación principal va por **WebSocket propio** (`wss.on('connection')`, `server.js:255`), con mensajes `{type:'generarImagen', prompt, workflow, params}`. Según `workflow` rutea a una constructora de grafo:

| `workflow` | función | outputNode | polled (HTTP) |
|---|---|---|---|
| `diplo` | `generarImagenDiplo` | "30" | no (WS) |
| `diplocolab` | `generarImagenDiploColab` | "86" | **sí** |
| `diplocolabcn` | `generarImagenDiploColabCN` | "86" | **sí** |
| `local` | `generarImagenLocal` | "9" | no |
| `zimage` | `generarImagenZImage` | "9" | no |
| `simple`/otro | `generarImagen` | "9" | no |

REST relevante (todos con prefijo `BASE_PATH`): `GET /api/config` (352) y `POST /api/config` (840, reconecta el WS); `GET /api/ping` (359, la verdad sobre "Colab vivo", timeout 12s); `POST /api/upload-image` (382); `POST /api/add-lora` (402, reenvía a `/leo/add_lora`, timeout 600s); `POST /api/describe-image` (489, Qwen-VL); `POST /api/edit-image` (578, Qwen-Image-Edit, con pre-chequeo de nodos); `POST /api/preprocess-preview` (640); `GET /api/preprocessors` (659); `GET /api/models` (672); `GET /api/object-info` (758, llena los dropdowns DIPLO); `GET /api/images` (799); `GET /api/download-all` (809, zip sin deps); `GET /api/workflows` (831).

### 1.4 Grafos y nodos

Hay grafos **en disco** (`workflow_zimage.json`, `workflow_diplo_colab.json`, `workflow_diplo_colab_cn.json`, `workflow_diplo.json`, `workflow_preprocess.json`) y grafos **armados 100% en código** (describe, `server.js:493-523`; edit, `server.js:607-629`). Cadena típica de `diplocolab` (Z-Image + upscale 2×):

`UNETLoader(z-image-turbo-fp8) → CLIPLoader(qwen_3_4b, lumina2) → CLIPTextEncode(pos/neg)` y `EmptySD3LatentImage → KSampler → VAEDecode(ae.safetensors) → SaveImage(base)`; rama upscale `UpscaleModelLoader(2x-AnimeSharpV4_RCAN) → ImageUpscaleWithModel → SaveImage(86)` = **salida final**. La inyección de LoRA (`LoraLoader(90)`) y de img2img (`LoadImage+VAEEncode`) se hace **opcional y a mano** rerruteando el KSampler (`server.js:1473-1508`).

### 1.5 GPU: el límite que atraviesa todo

- **T4 (15.6 GB):** alcanza para Z-Image (zimage/diplocolab/cn), LoRA, ControlNet, upscale y describir. **NO** alcanza para Qwen-Image-Edit (GGUF Q4 ~12 GB + text-encoder 7B + VAE → OOM).
- **L4 (23.7 GB):** necesaria para `/api/edit-image`. 1ª corrida ~10 min (carga el modelo de 12 GB desde Drive; después queda en VRAM). Por eso `queuePollDownload(...,240)` (~12 min de timeout).

No se elige la GPU: toca lo que Colab dé. Esto condiciona qué herramientas funcionan en cada sesión.

---

## 2. Robustez

El sistema tiene **un punto único de fragilidad estructural**: toda la generación depende de un Colab gratuito detrás de un túnel Cloudflare. El runtime se recicla solo, el túnel corta WS, y la GPU cambia qué entra en VRAM. La buena noticia: **hoy no crashea** ante el modo de falla común. Lo que falta es *recuperación* (reconectar solo) y *comunicación* (avisar al usuario).

### 2.1 Modos de falla reales

| # | Falla | Causa | Cómo se detecta |
|---|-------|-------|-----------------|
| F1 | Colab caído / runtime reciclado | Sesión expirada, kernel muerto → Cloudflare 502/530 | `/api/ping` falla → indicador rojo en ≤15s; en generación, "¿Colab caído? Cloudflare 502/530" |
| F2 | Túnel vivo pero ComfyUI no levantó | `cloudflared` arrancó antes que `main.py` | Mismo camino que F1 (`/api/ping`, timeout 12s) |
| F3 | WebSocket a ComfyUI muerto | Los túneles cortan WS largos | **No se detecta a propósito**: el front lo ignora, la generación sigue por HTTP polling |
| F4 | OOM en T4 con Qwen-Image-Edit | 12 GB + 7B + VAE no entran en 15.6 GB | `status_str === 'error'` en `/history` → "❌ ComfyUI reportó un error" |
| F5 | Timeout de generación | Cold-start más lento que el límite de reintentos | `pollHistoryAndEmit` 150×5s ≈ 12.5 min → "⌛ Timeout" |
| F6 | Modelos lentos desde Drive | 1ª lectura desde Drive montado | No hay detección dedicada; los `maxTries` están inflados (240 en edit) |
| F7 | Imagen corrupta en LoadImage | Upload truncado / formato no soportado | Solo aparece como `status_str:'error'` genérico. **No hay validación previa** |
| F8 | Mensaje WS no-JSON de ComfyUI | Frame que no es JSON válido | **No se maneja** — `setupComfyWebSocketHandlers` parsea sin try/catch (`server.js:131`) |
| F9 | LoRA recién bajado no aparece | Caché de `get_filename_list` no se invalida | Fix en el notebook (`leo_lora_fetch`); falta confirmar notebook al día |

### 2.2 Mitigaciones que YA existen (no rehacer)

1. **Blindaje no-JSON (el fix más importante, anti-crash).** `queuePrompt` (1004-1010), `getHistory` (1030-1036) y `uploadImage` (971-975) envuelven el `JSON.parse` en try/catch y rechazan con mensaje claro en vez de tumbar el proceso Node. Antes esto era un crash real.
2. **HTTP polling como red de seguridad ante WS muerto.** `pollHistoryAndEmit` (1047-1090) poleá `/history` cada 5s y emite el **mismo** `image_generated` que escucha el front, funcione o no el WS. Los flujos `diplocolab`/`diplocolabcn` van `polled:true` por esto.
3. **Anti-doble-emisión y anti-flicker.** El handler `executed` (162-186) ignora prompts `polled` y filtra por `outputNode`; tolera errores de `getHistory` con `continue`.
4. **Pre-chequeo de nodos antes de encolar.** `/api/edit-image` verifica con `fetchObjectInfo()` que existan los ~12 nodos; si falta alguno corta con "Reiniciá el Colab con el notebook actualizado" (594-602). Mismo patrón en `/api/add-lora` ante 404/405.
5. **Indicador de conexión honesto.** El front decide vivo/caído por `/api/ping` (HTTP real a `/system_stats`), no por el WS. No miente cuando el WS cae pero el Colab vive.
6. **Timeouts dimensionados al cold-start.** add-lora 600s, edit 240 tries (~12 min), describe 180s. Inflados a propósito por F6.
7. **Limpieza de caché de LoRA.** `leo_lora_fetch` re-calienta `get_filename_list("loras")` tras bajar el archivo (mitiga F9).

### 2.3 Lo que falta — priorizado

**PRIORIDAD ALTA**

- **A1 — try/catch en el handler WS (F8).** `server.js:131` hace `JSON.parse(messageString)` crudo dentro de `on('message')`. Un frame no-JSON tira una excepción **no capturada** → puede tumbar el proceso, justo lo que el resto del código ya evita. **Es la grieta más clara y la más barata: 3 líneas. Hacelo ya.**
- **A2 — Reconexión automática del WS con backoff (F3).** `connectToComfyUI()` solo se llama al boot y al guardar config; en `on('close')`/`on('error')` solo avisa, no reintenta. Reprogramar con backoff exponencial con techo (2s→4s→…→30s) y un flag anti-acumulación de timers. No es crítico para que la imagen salga (eso ya va por HTTP), pero recupera el feed de progreso en vivo.
- **A3 — Feedback explícito de Colab caído (F1/F2).** Hoy el punto se pone rojo y, si generás, cae un `alert` técnico. Cuando `/api/ping` da caído: deshabilitar el botón "🚀 Generar" y mostrar un banner accionable ("El Colab no responde. Reiniciá el notebook y pegá la URL"). Evita disparar generaciones que van a fallar.
- **A6 — Healthcheck con GPU activa.** `/api/ping` ya trae `{alive, url, info}`. Falta exponer **T4 vs L4**, que es justo lo que decide si Edit hace OOM (F4). Leer la GPU de `/system_stats` y, si es T4, advertir/deshabilitar la sección Qwen-Image-Edit. **Convierte un OOM tardío de 12 min en un aviso instantáneo.**

**PRIORIDAD MEDIA**

- **A4 — Validar la imagen subida (F7).** `/api/upload-image` guarda el base64 sin chequear que sea decodificable. Validar magic bytes / MIME y rechazar con mensaje claro antes de gastar una generación.
- **A5 — Distinguir "lento" de "colgado" (F5/F6).** Contar fallos consecutivos de `getHistory` dentro del poll; tras N seguidos (ej. 5), emitir `generation_status:warning` ("El Colab no responde hace rato") sin abortar. Señal temprana sin romper la tolerancia.

**PRIORIDAD BAJA**

- **A7 — Botón "Reintentar".** Guardar el último `params` y ofrecer reintento manual (no auto, para no gastar VRAM). Cola persistente real sería sobre-ingeniería para este uso.

### 2.4 Robustez del Colab en sí (el techo)

Es infraestructura ajena y gratuita: ahí hay menos control. Lo que ya ayuda: túnel named fijo, `wait_8188` (espera a que el puerto abra antes de levantar el túnel, evita F2 al arranque), fallback de llama-cpp (si el wheel de Qwen3-VL falla, ComfyUI igual arranca), modelos en Drive (no se re-descargan). Lo que falta blindar:

1. **Arranque idempotente de un toque.** Asumir que se cae y que re-correr la última celda deje todo levantado sin pasos manuales. Un keep-alive agresivo va contra los TOS de Colab — no recomendado.
2. **Verificar `/system_stats` *dentro* del Colab tras `wait_8188`,** e imprimir un OK/FAIL grande. Hoy `wait_8188` confirma que el puerto abrió, no que ComfyUI responde sano (F2).
3. **Imprimir la GPU al arranque (`nvidia-smi`)** y avisar explícito si es T4 ("Edit no va a entrar, usá Z-Image"). Combinado con A6, el usuario lo sabe antes de intentar.
4. **Envolver la limpieza de caché de `leo_lora_fetch` en try/except,** porque depende de internals de ComfyUI (`cache_helper`, `filename_list_cache`) que pueden cambiar de nombre y romper el fix de F9 en silencio.

> **Síntesis de robustez:** el sistema hoy **no crashea** (gran logro ya hecho) pero **no se recupera solo** ni **le explica al usuario** qué pasa. Esas dos brechas son el trabajo que queda. Orden: A1 ya → A3+A6 (fallas tardías → avisos instantáneos) → A2 → A5/A4 → arranque idempotente del Colab.

---

## 3. Versatilidad, alcances y límites — modo creativo

comfyweb expone **siete herramientas creativas** sobre ComfyUI en Colab. Existe además un **DIPLO completo** (`workflow_diplo.json`, 30+ nodos con tile-refine `SamplerCustomAdvanced` + ensamblado TTP) que es el camino local AMD y **hoy está oculto en la UI** (botón comentado, `index.html:209-229`), porque el cómputo vive en Colab.

### 3.1 Herramienta por herramienta: qué te deja hacer y dónde está el muro

**1. Generar (txt2img — Z-Image Turbo).** Escribís un prompt y sale una imagen; es la base de todo. Dos sabores: `zimage` (panel reducido, para bocetar rápido) y `diplocolab` (default, panel rico + upscale 2× automático, el caballito de batalla). Afinado para **pocos pasos** (8 steps, CFG 1.0). *Muros:* CFG bajo casi obligatorio (7+ distorsiona); resolución base modesta (1024×640, a 2048 la T4 sufre); un solo UNET cargado (no SDXL/Flux/Pony); el `realvisxl.safetensors` del dropdown es placeholder, no garantía.

**2. img2img.** Subís una imagen y la usás como punto de partida; el **denoise** manda cuánto se aleja (0.3 mantiene identidad, 0.6 varía fuerte). *Muros:* solo en `diplocolab`; vive **dentro de la sección ControlNet** (es un checkbox `#useImg2img`, conceptualmente confuso); compite con ControlNet por la misma imagen subida (una u otra, no las dos).

**3. ControlNet + 7 preprocesadores.** La herramienta más potente para **control de composición**: un preprocesador extrae el "esqueleto" de una referencia y la generación lo respeta. Los 7 dedicados con params propios:

| Preprocesador | Extrae | Caso creativo |
|---|---|---|
| `CannyEdgePreprocessor` | Bordes duros (low/high threshold) | Copiar el contorno de un objeto/edificio |
| `LineartStandardPreprocessor` | Líneas tipo dibujo | Pasar un sketch a render manteniendo el trazo |
| `DepthAnythingV2Preprocessor` | Profundidad (vits/b/l/g) | Mantener la disposición espacial 3D |
| `MiDaS-NormalMapPreprocessor` | Normales de superficie | Conservar volumen/relieve |
| `DWPreprocessor` | Pose humana (body/hand/face) | Replicar la pose de una persona |
| `HEDPreprocessor` | Bordes suaves | Guía más laxa que Canny |
| `TTPlanet_TileGF_Preprocessor` | Tile/detalle | Guía de textura para refinado |

Los ~40 restantes caen al `AIO_Preprocessor` genérico (sin perillas). **Plus real:** vista previa viva (debounce 350ms) — ves qué "ve" el ControlNet antes de gastar la generación. *Muros:* marcado `[experimental]` (el rótulo asusta sin explicar); `strength` NO afecta la preview, solo el final; `scaleBy=0.19` es número mágico heredado; un solo ControlNet a la vez. Corre en **T4**.

**4. LoRA (estilos/personajes entrenados).** La pata que conecta con el juego: los LoRAs de Elena entran acá. Elegís uno cargado (fuerza model 0.80 / clip 1.00) o agregás por URL (`/api/add-lora` baja a `models/loras` y `leo_lora_fetch` refresca sin reiniciar). *Muros:* **un solo LoRA por generación** (no stacking estilo+personaje); bug de caché conocido (puede que todavía haya que reiniciar); fuerzas 0.7-0.9 (más de 1.2 quema). **Liviano**, T4 OK.

**5. Upscale 2×.** Dobla resolución reconstruyendo detalle (`2x-AnimeSharpV4_RCAN`), automático al final de `diplocolab`. *Muros:* 2× fijo (no configurable; los campos width/height son `data-modes="diplo"`, oculto); un solo modelo (afinado para ilustración, no foto); no hay tiled-upscale en la nube (vive solo en el `workflow_diplo.json` oculto). **Pesado.**

**6. Describir imagen → prompt (Qwen-VL).** Subís una imagen y sale un prompt en texto (`Qwen3VL-8B`). El puente "referencia visual → palabras". *Muros:* NO genera imagen; 1ª corrida ~1½ min; **redundancia confusa** (dos botones que describen, uno en `sec-cn`, otro en `sec-qwen`). T4 OK.

**7. Editar imagen por instrucción (Qwen-Image-Edit).** La más "mágica": subís imagen + instrucción en criollo ("ponele pelo azul") y edita manteniendo el resto. Pensada para los **estados de Elena**. Modo rápido (default, LoRA Lightning, 4 pasos) o lento (20 pasos, más calidad). *Muro más duro de todo comfyweb:* **requiere L4, OOM en T4**; 1ª corrida ~10 min.

### 3.2 Combinaciones potentes — los flujos que valen

- **A. LoRA + ControlNet — "Elena en la pose de esta foto".** LoRA (Elena) + referencia con `DWPreprocessor` (pose). **El flujo estrella para el juego.** Corre en T4.
- **B. Describir → Generar — "quiero algo con este estilo".** Referencia → Qwen-VL describe → editás el prompt → generás con tu LoRA. Todo en T4.
- **C. img2img + LoRA — "reinterpretá mi foto en estilo X".** Foto del archivo documental + denoise medio + LoRA de estilo. Diplo + foto-documental en un paso.
- **D. Generar → Upscale.** Ya viene encadenado en `diplocolab`.
- **E. Generar → Editar (el ciclo de estados).** Elena base → variantes por instrucción ("contenta", "de noche", "con capa") sin re-generar. **Requiere L4.**

**Lo que NO se combina hoy:** multi-LoRA (estilo+personaje), multi-ControlNet (pose+depth), ControlNet+img2img sobre la misma imagen (comparten `#refImage`).

### 3.3 Tabla "quiero hacer X → usá Y"

| Quiero... | Herramienta | GPU |
|---|---|---|
| Una imagen desde texto | txt2img (`zimage` boceto / `diplocolab` final) | T4 OK |
| Lo mismo grande/nítido | `diplocolab` (upscale 2× auto) | T4 OK |
| Que aparezca mi personaje (Elena) | LoRA (fuerza 0.7-0.9) | T4 OK |
| Bajar un LoRA de Civitai y usarlo ya | Add-LoRA por URL | si no aparece, reiniciá Colab |
| Mi personaje en una pose concreta | LoRA + ControlNet (DWPose) | T4 OK (flujo estrella) |
| Copiar la estructura de un edificio | ControlNet (Canny) | T4 OK |
| Mantener la disposición de una escena | ControlNet (Depth) | T4 OK |
| Reinterpretar una foto mía en otro estilo | img2img + LoRA (denoise medio) | T4 OK |
| Saber cómo describir una imagen | Describir (Qwen-VL) | T4 OK |
| Cambiar algo puntual ("pelo azul") | Editar (Qwen-Image-Edit) | **L4** |
| Sacar varios estados de Elena | Editar, iterando | **L4** |
| Editar SOLO una zona | — | no existe (inpainting) |
| Extender una imagen | — | no existe (outpainting) |
| Animar a Elena (video) | — | no existe aún (LTX, parkeado) |
| Estilo de una imagen sin entrenar LoRA | — | no existe (IPAdapter) |

### 3.4 Qué más podría hacer ComfyUI que comfyweb hoy no expone

| Capacidad | Qué habilitaría | Esfuerzo |
|---|---|---|
| **Inpainting** (máscara) | Editar una región puntual con control quirúrgico — la mejor relación valor/esfuerzo que falta | Medio (la UI de pincel es lo caro) |
| **Outpainting** | Extender el lienzo: retrato → panorámica, completar fondo (ATLAS, foto documental) | Medio |
| **Video LTX** | Animar una imagen de Elena. **Rumbo declarado** en el CLAUDE.md del proyecto | Alto (ya en el horizonte) |
| **IPAdapter** | "ESTE estilo/ESTA cara" subiendo una imagen, sin entrenar LoRA | Medio |
| **Multi-LoRA stacking** | Estilo + personaje a la vez. Solo código, casi gratis | Bajo |
| **Multi-ControlNet** | Pose + profundidad juntos | Bajo-medio |
| **Tiled upscale en la nube** | Resolución alta de verdad (4×+) sin OOM. El código existe (oculto) | Medio |

> **El límite que atraviesa todo:** todo corre en Colab y la GPU define qué podés hacer. En T4 tenés casi todo; para editar por instrucción necesitás L4 sí o sí. Para un entregable de diplomatura, eso **es parte de la tesis, no un defecto a esconder.**

---

## 4. Customización: tabla de variables y su explicación simple

> Defaults, rangos y opciones tomados literal del código. Las explicaciones son "qué pasa si lo movés".

### 4.1 Prompt (común a todos los workflows)

| Variable (id) | Default | Rango | Qué hace · qué pasa si lo movés |
|---|---|---|---|
| Prompt (`#prompt`) | vacío (obligatorio) | texto libre | Describe la imagen. Vacío → la app te frena con un alert. Más detalle = más control, pero si te pasás de largo el modelo diluye lo importante. |
| Negative prompt (`#negPrompt`) | `blurry, ugly, low quality, deformed hands, extra limbs, text, watermark` | texto libre | Lo que NO querés que aparezca. Sumá términos para vetar (texto, marcas, manos raras). Vaciarlo = menos red de seguridad. |
| Semilla (`#seed`) | `-1` | min −1 | El "número de la suerte" del ruido inicial. `-1` = aleatoria (explorás). Fijar un número = mismo prompt + misma seed = misma imagen (reproducible). |

### 4.2 Panel SIMPLE (workflow `zimage`)

| Variable (id) | Default | Rango | Qué hace |
|---|---|---|---|
| Modelo (`#modelSelect`) | `realvisxl.safetensors` | del backend | Checkpoint base. Se llena solo al conectar. |
| Steps (`#steps`) | `8` | 1–150 | Iteraciones. Turbo va fino con 8. Subir = más lento sin mucho aporte; bajar mucho = imagen sin terminar. |
| Ancho (`#width`) | `1024` | 64–2048, paso 8 | ⚠️ **Sin tooltip en la UI** (gap a cerrar). |
| Alto (`#height`) | `640` | 64–2048, paso 8 | Más grande = más lento y más VRAM. |

### 4.3 Dimensiones (panel DIPLO)

| Variable (id) | Default | Rango | Qué hace |
|---|---|---|---|
| Ancho base (`#diploWidth`) | `1024` | 256–2048, paso 8 | Ancho de la generación inicial (`EmptySD3LatentImage`). |
| Alto base (`#diploHeight`) | `640` | 256–2048, paso 8 | Default 1024×640 es panorámico (~16:10). |
| Cantidad (`#diploBatch`) | `1` | 1–8 | `batch_size`. Se guardan todas; el visor muestra la última. Sube VRAM/tiempo lineal. |
| Prompt tile refine (`#tilePrompt`) | vacío | solo `diplo` | Prompt aparte para el refinado por mosaicos. Vacío = usa el principal. |

### 4.4 KSampler — el motor

| Variable (id) | Default | Rango/opciones | Qué hace |
|---|---|---|---|
| Steps (`#diploSteps`) | `8` | 1–150 | Turbo: 4–12. Subir = más fino hasta cierto punto; bajar mucho = ruidoso. |
| CFG (`#diploCfg`) | `1.0` | 1–30, paso 0.5 | Cuánto obedece el prompt. **Z-Image Turbo necesita 1.** Subir (7+) en Turbo = **quema/distorsiona**. |
| Denoise (`#diploDenoise`) | `1.0` | 0.05–1 | `1.0` = de cero (txt2img). Más bajo solo en img2img: 0.3 mantiene, 0.6 cambia. |
| Sampler (`#diploSampler`) | `euler` | 14 opciones | `euler` rápido/limpio (seguro); `dpmpp_2m` más detalle; `_ancestral`/`_sde` agregan azar. |
| Scheduler (`#diploScheduler`) | `simple` | simple/normal/karras/exponential/sgm_uniform/ddim_uniform | `simple` lineal (seguro con Turbo); `ddim_uniform` más variación. |

### 4.5 LoRA

| Variable (id) | Default | Rango | Qué hace |
|---|---|---|---|
| Usar LoRA (`#useLora`) | off | checkbox | Si está off, los demás campos no se mandan. |
| LoRA name (`#loraName`) | vacío (backend) | lista | Archivo de estilo/personaje (ej. una LoRA de Elena). |
| Model strength (`#loraStrengthModel`) | `0.80` | 0.1–1.5 | 0 = no se nota, 1 = plena. >1.2 fríe el estilo. Rec. 0.7–0.9. |
| CLIP strength (`#loraStrengthClip`) | `1.00` | 0.1–1.5 | Cuánto toca la interpretación del prompt. 1.0 estándar; tocalo poco. |
| LoRA URL (`#loraUrl`) | vacío | texto | Link directo `.safetensors` (Civitai con token). Baja vía `/api/add-lora` y auto-tilda "Usar LoRA". |
| LoRA filename (`#loraFilename`) | vacío | opcional | Nombre con el que se guarda. |

### 4.6 ControlNet + referencia (`[experimental]`)

| Variable (id) | Default | Rango/opciones | Qué hace |
|---|---|---|---|
| Subir referencia (`#refImageFile`) | — | archivo | Subirla activa ControlNet **solo**. |
| Usar como img2img (`#useImg2img`) | off | solo `diplocolab` | La imagen es el punto de partida; el cambio lo controla el Denoise (0.3 mantiene, 0.6 varía). |
| Preprocessor (`#preprocessor`) | `CannyEdgePreprocessor` | 7 dedicados + ~40 genéricos | Qué se EXTRAE: bordes/profundidad/pose/relieve/tile. Cambia radicalmente cómo "lee" la imagen. |
| Resolution (`#preprocessorRes`) | `512` | 64–2048, paso 64 | 512 = balance. Subir = más fino pero más lento. |
| ControlNet strength (`#controlnetStrength`) | `0.90` | 0.1–1.5 | 0 ignora, 1 sigue al pie. Rec. 0.7–0.9. ⚠️ **NO cambia la vista previa**, solo el final. |
| Scale ref (`#scaleBy`) | `0.19` | 0.05–2 | Escala la referencia antes del pipeline. ⚠️ **Número mágico** heredado; documentar o revisar. |

**Params dinámicos del preprocesador** (`#ppParams`, la UI los manda como `pp_<param>`): Canny `low`/`high` (100/200, 0–255); Lineart `guassian_sigma` (6.0) / `intensity_threshold` (8); Depth `ckpt_name` (vitl, opciones vits/b/l/g); MiDaS `a` (6.28) / `bg_threshold` (0.1); DWPose `body`/`hand`/`face` (toggles); HED `safe` (toggle); TTPlanet `scale_factor`/`blur_strength`/`radius`/`eps`.

> ⚠️ **No existe "ControlNet start/end" (start_percent/end_percent)** en esta UI ni en el backend. El `QwenImageDiffsynthControlnet` se controla solo con `strength` y `scaleBy`. No inventado.

### 4.7 Tile Refine (`diplo` solamente, hoy oculto)

`tileSteps` (10), `tileDenoise` (0.2), `tileCols` (3), `tileRows` (3), `tileOverlap` (0.05), `tileSampler` (euler), `tileScheduler` (simple). Refinan por mosaicos para más detalle; delicado de calibrar. En `diplocolab` el upscale directo 2× es más robusto.

### 4.8 Output & Upscale

| Variable (id) | Default | Opciones | Nota |
|---|---|---|---|
| Output ancho (`#upscaleWidth`) | `1128` | 256–4096 | Solo `diplo`. En DIPLO Colab el upscale es fijo 2×. |
| Output alto (`#upscaleHeight`) | `672` | 256–4096 | Idem. |
| Resize mode (`#upscaleResizeMode`) | `crop` | crop/stretch/pad | Solo `diplo`. |
| Resize method (`#upscaleResizeMethod`) | `nearest-exact` | nearest-exact/lanczos/bilinear/bicubic | `nearest-exact` conserva pixel/lowpoly; `lanczos` mejor foto. Solo `diplo`. |

**Modelos avanzados** (colapsable dentro de Upscale): `#unetName`, `#weightDtype` (fp8_e4m3fn +otros — fp8 rápido/liviano, fp16/bf16 preciso/pesado), `#vaeName`, `#clipName`, `#upscaleModel`, `#modelPatchName`. Todos del backend (`/api/object-info`). ⚠️ **Mal categorizado:** para cambiar el VAE hay que tildar "¿más resolución?" — el VAE no tiene que ver con upscale.

### 4.9 Qwen-Image-Edit

| Variable (id) | Default | Qué hace |
|---|---|---|
| `#editInstruction` | vacío | Instrucción en lenguaje natural. |
| `#editFast` | ON | Modo rápido: LoRA Lightning → 4 pasos, cfg 1. Destildado = 20 pasos, cfg 2.5, más calidad/lento. ⚠️ Pide L4, 1ª corrida ~10 min. |

Qwen-VL (describir) no tiene params expuestos; sus settings (max_tokens 512, ctx 8192, gpu_layers −1, temp 0.7) están hardcodeados en `server.js`.

### 4.10 Variables de configuración / sistema (se tocan al instalar/mover, no en el uso diario)

| Variable | Dónde | Default | Qué es |
|---|---|---|---|
| `comfyUrl` | `config.json` | `https://comfy.leoblumfeld.com` | URL del ComfyUI (túnel). Se cambia desde "Guardar y Conectar". |
| `isRemote` | `config.json` | `true` | Remoto (Colab) o local. |
| `IMAGE_BASE_URL` | env (`server.js:232`) | `https://vps-4455523-x.dattaweb.com/comfyweb` | ⚠️ **Trampa local:** apunta al VPS; en local exportar `http://localhost:8085`. |
| `BASE_PATH` | env (`server.js:228`) | `''` | Prefijo de ruta (VPS `/comfyweb`). En local vacío. |
| `PROVIDER` | env / `config.provider` | `comfyui` | `fal` → usa fal.ai en vez de Colab. |
| `FAL_KEY` | env | `''` | Solo si `PROVIDER=fal`. |
| Puerto | `server.js` | `8085` | Puerto local del Node. |

### 4.11 Presets sugeridos (no existen hoy, siguiente paso natural de UX)

1. **"Rápido / borrador"** → `zimage`, steps 6, sin upscale.
2. **"Calidad / entrega"** → `diplocolab`, steps 8–10, upscale ON.
3. **"Personaje (Elena)"** → LoRA ON (0.8/1.0) + img2img denoise 0.4.
4. **"Desde referencia (ControlNet)"** → Canny strength 0.85, res 512.
5. **"Editar estado"** → directo a Qwen-Image-Edit modo rápido.

Aprovechan el progressive disclosure del wizard: un preset = "tildar este combo + setear estos defaults". El usuario elige un **objetivo**, no un nodo.

---

## 5. Extensibilidad: estructura para montar herramientas nuevas rápido

### 5.1 El problema hoy: una herramienta vive fragmentada en 4 dialectos

Montar una herramienta nueva obliga a tocar **cuatro lugares desacoplados a mano**, sin contrato que los una:

| Capa | Qué hay que escribir | Evidencia |
|------|---------------------|-----------|
| Backend — endpoint | Ruta REST nueva con su parseo, validación, timeout, polling | describe (489), edit (578), preprocess (640); switch WS (268-334) |
| Backend — grafo | El grafo JSON-API construido **a mano en JS**, con IDs string literales | describe 493-523, edit 607-629, o JSON + parcheo imperativo (1473-1489) |
| Frontend — HTML | Una `param-section` con inputs, `data-modes`, `data-wiz`, tooltips | `#sec-qwen`, `#sec-qwen-edit`, `#sec-cn` (244-667) |
| Frontend — JS | Módulo que junta inputs, llama al endpoint, pinta resultado | `qwen.js`, `qwen-edit.js`, `preproc.js` |
| Frontend — wizard | Checkbox + entrada en el medidor de peso + limpieza al apagar | `wizard.js` + HTML 246-298 |

**Puntos de dolor concretos:** (1) IDs de nodo mágicos repartidos en 3 lugares ("15" en el JSON, la constructora y el poller); (2) **parámetros declarados dos veces sin sincronía** — el espejo `RICH_PREPROCS`(`server.js:450`)/`PP_RICH`(`preproc.js`), la señal más clara de que no escala; (3) mapeo input→nodo imperativo y disperso; (4) validación ad-hoc (solo edit la tiene); (5) visibilidad triple-acoplada (`data-modes` × `data-wiz`).

### 5.2 El diseño: una herramienta = un manifiesto declarativo

Idea central: un archivo JSON describe qué nodos arma la herramienta, qué le pide al usuario y cómo se conectan. **Un** endpoint genérico ejecuta cualquier manifiesto; el frontend **genera** la UI desde el mismo archivo.

```
comfyweb/
  tools/                      ← NUEVO: un archivo por herramienta
    qwen-edit.tool.json
    describe.tool.json
    controlnet.tool.json
  graph/blocks/               ← NUEVO: bloques de grafo reutilizables
  server.js                   ← solo carga tools/ y expone /api/tool/:id
```

**Contrato del manifiesto** (esquema, ejemplo Qwen-Image-Edit):

```jsonc
{
  "id": "qwen-edit",
  "label": "Editar imagen → instrucción",
  "summary": "Cambiá algo de una imagen con una orden en texto.",   // criollo, NO jerga
  "wizard": {
    "question": "¿Editar una imagen con una instrucción?",
    "badge": "pesado", "cost": 3,
    "requires": { "gpu": "L4" }            // declara hardware → el front avisa OOM en T4
  },
  "inputs": [                              // ÚNICA fuente de verdad de UI + validación
    { "id": "image",       "type": "image", "required": true, "label": "Imagen a editar" },
    { "id": "instruction", "type": "text",  "required": true, "label": "Instrucción",
      "placeholder": "ponele pelo azul", "tooltip": "Describí el cambio en una frase." },
    { "id": "fast", "type": "bool", "default": true, "label": "Modo rápido (4 pasos)",
      "tooltip": "LoRA Lightning. Destildá para más calidad, más lento." }
  ],
  "graph": {
    "blocks": [
      { "use": "load-image",       "as": "img",   "bind": { "image": "$image" } },
      { "use": "scale-megapixels", "as": "scaled","bind": { "src": "@img", "megapixels": 1.0 } },
      { "use": "qwen-edit-core",   "as": "core",  "bind": { "image": "@scaled", "prompt": "$instruction" } },
      { "use": "lightning-lora",   "as": "fast",  "when": "$fast", "bind": { "target": "@core.model" } },
      { "use": "save-image",       "as": "out",   "bind": { "image": "@core.image", "prefix": "qwen-edit" } }
    ],
    "output": "@out",
    "params": {
      "when:$fast":  { "core.steps": 4,  "core.cfg": 1.0 },
      "when:!$fast": { "core.steps": 20, "core.cfg": 2.5 }
    }
  },
  "run": { "mode": "poll-download", "timeoutMs": 720000, "result": "image" }
}
```

Tres ideas clave: **`inputs[]` es la única fuente de verdad** (mata el espejo `RICH_PREPROCS`/`PP_RICH`); **`bind` con referencias (`$input`, `@bloque`)** reemplaza el seteo imperativo `wf["13"].inputs.x = ...` (los IDs de nodo dejan de ser strings mágicos); **`run.mode`** abstrae los tres caminos hardcodeados (WS, `pollHistoryForText`, `queuePollDownload`).

**El endpoint genérico** reemplaza a `/api/describe-image`, `/api/edit-image`, `/api/preprocess-preview` y el switch del WS:

```
POST /api/tool/:id
  1. tool   = registry.get(id)                       // carga tools/:id.tool.json
  2. validateInputs(tool.inputs, body)               // tipos, required, rangos → 400 claro
  3. graph  = GraphEngine.compose(tool.graph, body)  // bloques → JSON-API
  4. preflight(graph, fetchObjectInfo())             // ¿están los class_type? (generaliza edit:594)
  5. promptId = queuePrompt(graph)
  6. según tool.run.mode: poll-download | poll-text | ws
  7. return result según tool.run.result
```

> **La robustez actual no se tira: se centraliza.** Los helpers que ya funcionan (`queuePrompt`, `getHistory`, `queuePollDownload`, el blindaje anti-502) se reusan tal cual detrás de `run.mode`.

### 5.3 Frontend autogenerado + motor de grafos

**Frontend:** `GET /api/tools` devuelve los manifiestos; un módulo `toolRenderer.js` (reemplaza el patrón disperso de `qwen.js`/`qwen-edit.js`/`preproc.js`) crea la `.param-section`, mapea `type`→widget (`text`→textarea, `number`→range+`.range-value`, `bool`→checkbox, `image`→file que sube a `/api/upload-image`, `select`→dropdown que se llena de `/api/object-info` si tiene `optionsFrom`), y deriva la validación de la misma tabla de tipos (cliente + server, una regla, dos puntos). El wizard deja de tener 6 checkboxes hardcodeados: se **genera** del bloque `wizard` de cada manifiesto, y la limpieza al apagar (`onOff`) se **deriva** (apagar = limpiar *sus* `inputs[]`). El álgebra `data-modes × data-wiz` se conserva; el renderer solo setea esos atributos.

**Motor de composición de grafos (`GraphEngine.compose`):** un grafo ComfyUI es nodos `{class_type, inputs}` con aristas `[nodeId, slot]`. Un **bloque** es un sub-grafo parametrizable con puertos nombrados. El motor instancia nodos con **IDs auto-generados** (nadie escribe "13" ni "86"), resuelve referencias internas (`@nodo`) y externas (`$input`, `@otroBloque.port`), aplica params condicionales y resuelve el `output` por nombre de bloque. Bloques candidatos (de descomponer los grafos actuales): `load-image`, `scale-megapixels`, `scale-by`, `empty-latent`, `zimage-loaders`, `ksampler`, `lora-patch`, `controlnet-patch`, `aio-preprocessor`, `upscale-2x`, `tile-refine`, `vae-decode`, `save-image`, `qwen-vl-describe`, `qwen-edit-core`. El parcheo de LoRA/img2img/ControlNet (hoy imperativo) se vuelve un bloque `when:$useLora` que toma `@core.model` y devuelve un model parchado.

**Compatibilidad:** produce exactamente el mismo JSON-API que ComfyUI ya consume. No cambia nada río abajo. Es refactor de *cómo se arma* el grafo.

### 5.4 Ejemplo: agregar un upscaler nuevo (ESRGAN 4×) — minutos

Reusa el bloque `upscale` existente. Es solo un manifiesto:

```jsonc
{
  "id": "upscale-4x",
  "label": "Agrandar 4× (UltraSharp)",
  "summary": "Subí una imagen y la agrando al cuádruple.",
  "wizard": { "question": "¿Agrandar una imagen ya hecha?", "badge": "pesado", "cost": 3 },
  "inputs": [
    { "id": "image", "type": "image", "required": true, "label": "Imagen" },
    { "id": "model", "type": "select", "default": "4x-UltraSharp.safetensors",
      "optionsFrom": "object-info:upscale_model_name", "label": "Modelo de upscale" }
  ],
  "graph": {
    "blocks": [
      { "use": "load-image", "as": "img", "bind": { "image": "$image" } },
      { "use": "upscale",    "as": "up",  "bind": { "image": "@img", "model_name": "$model" } },
      { "use": "save-image", "as": "out", "bind": { "image": "@up.image", "prefix": "upscale" } }
    ],
    "output": "@out"
  },
  "run": { "mode": "poll-download", "timeoutMs": 300000, "result": "image" }
}
```

Cero líneas de `server.js`, cero HTML, cero JS. El dropdown se llena solo; si el modelo no está en el Colab, el `preflight` devuelve el "reiniciá el Colab" que ya existe.

### 5.5 Alcance honesto y migración

Los grafos únicos y enormes (`workflow_diplo.json`, 30+ nodos con tile refine) no se bloquean limpio: el motor admite un **escape hatch** (`{"use":"raw","file":"workflow_diplo.json"}` con solo unos puertos expuestos). No forzar atomicidad donde no hay reúso. **La migración es incremental:** el endpoint genérico y los manifiestos conviven con los endpoints viejos mientras se portan de a uno. No es big-bang. El primer espejo a matar es `RICH_PREPROCS`/`PP_RICH`.

---

## 6. UX educativa (el corazón)

### 6.1 "¿Qué es esto?" — el texto para quien no sabe nada

Bloque de bienvenida, colapsable (abierto la primera vez, después un botón "¿Qué es esto? 🤔"). Texto para pegar tal cual:

> **¿Qué es ComfyUI y qué hago acá?**
>
> **Primero, lo básico: generar imágenes con IA.** Hay modelos que aprendieron mirando millones de imágenes con su descripción al lado. Ahora, si vos les escribís una descripción ("un zorro lowpoly al atardecer"), te dibujan una imagen nueva que nunca existió. No la copian: la *imaginan* a partir de tus palabras. A esa descripción la llamamos **prompt**.
>
> **Segundo: qué es un "workflow" y un "nodo".** Generar una imagen no es un solo paso. Es una cadena: cargar el modelo → leer tu prompt → dibujar → mejorar la resolución → guardar. ComfyUI muestra cada paso como una cajita (un **nodo**) y vos las conectás con cables, a mano, en un tablero gigante. Es potentísimo y es un quilombo: parece el tablero de un electricista. Para una imagen simple podés terminar con 30 cajitas conectadas.
>
> **Tercero: qué hace comfyweb (esta página) por vos.** Yo ya armé esos tableros por adentro. Vos no ves cables ni cajitas: ves botones y un casillero para escribir. Elegís qué querés lograr, apretás **Generar**, y yo traduzco eso al tablero de nodos, lo mando a procesar y te traigo la imagen. **Es la misma máquina, pero con tablero de auto en vez de tablero de electricista.**
>
> **Una cosa más, importante:** el cómputo no pasa en tu compu. Pasa en una placa de video prestada en la nube (Google Colab). Por eso a veces tarda, y por eso si se corta hay que reintentar. El semáforo de arriba (🟢/🔴) te dice si la máquina está despierta.

La analogía "tablero de electricista vs. tablero de auto" es la columna vertebral; conviene repetirla.

### 6.2 Módulo operativo vs. explicativo: "Modo Aprender" como overlay

Tres formas posibles de separar operativo y explicativo; se elige una:

| Opción | Problema |
|---|---|
| Tabs (Hacer / Aprender) | Rompe el contexto: aprendés sobre LoRA en una pantalla, lo usás en otra |
| Página de docs aparte | Nadie la lee, y duplica los tooltips |
| **✅ "Modo Aprender" como overlay** | Mantiene cada explicación pegada a su control. Recomendado |

**Cómo funciona:** un switch `🎓 Modo Aprender [OFF]` al lado del semáforo. **Apagado (default):** UI operativa limpia, con los `info-tip` de siempre. **Prendido:** cada `.param-section` muestra **abierta** su `.section-desc`, y aparece junto a cada control un link "¿Qué es esto?" que abre un drawer derecho con la explicación larga, un ejemplo antes/después y un botón **"Probá esto"** que setea valores de demostración. Reusa lo que ya existe (`.section-desc` + `info-tip`, "lo mejor del proyecto"): el Modo Aprender **sube el volumen** de lo que ya está, no inventa una pantalla.

**El enlace operativo → explicativo** se direcciona por id (`#sec-lora` → `#explica-lora`). **El wizard es el puente natural:** cada pregunta lleva un link "¿qué es?" que abre la explicación sin tildar nada — *primero entender, después decidir*. Un **glosario flotante** (subrayado punteado → tooltip de 1 frase) cubre los términos sueltos (steps, CFG, denoise, latente, seed, checkpoint), con una sola definición por término.

### 6.3 Microcopy por herramienta (pegable en la UI)

Formato: *para qué sirve · cuándo · qué lográs · límite en una línea.*

**🎨 Generar imagen (txt2img).** Convertís una idea escrita en una imagen; la base de todo. Cuándo: arrancás de cero. Lográs: ilustraciones, escenas, fondos. *Límite:* Z-Image Turbo trabaja con CFG bajo y pocos pasos; no es para control extremo por prompt negativo.

**✨ LoRA.** Que aparezca un estilo o personaje específico entrenado aparte (Elena, "Bradhamel"). Cuándo: querés que tus imágenes tengan SIEMPRE la misma cara/trazo/paleta. Lográs: personaje recurrente, look de autor consistente; podés bajar uno nuevo de Civitai con el link. *Límite:* **un LoRA por vez** (`server.js:1473`); no combinás estilo + personaje todavía.

**🎯 ControlNet + preprocesadores.** Que la imagen nueva respete la **estructura** de una foto tuya: bordes, pose, profundidad. Cuándo: ya tenés una composición en la cabeza. Lográs: tu personaje en la pose exacta (DWPose), copiar el contorno de un edificio (Canny), mantener la disposición 3D (Depth); con vista previa viva de lo que "ve" la IA. *Límite:* un solo tipo de guía por vez; el `[experimental]` asusta pero anda; el `strength` no afecta la preview.

**🖼️ img2img.** Usás una imagen como **punto de partida** en vez de la nada. Cuándo: tenés un boceto/foto/generación previa para reinterpretar. Lográs: pasar una foto del archivo a lowpoly, terminar un dibujo, variar luz/clima. *Límite:* vive **dentro de ControlNet** (checkbox `#useImg2img`) y compite con él por la misma imagen; solo `diplocolab`.

**🔍 Upscale 2×.** Duplica el tamaño reconstruyendo detalle. Cuándo: la composición ya te gusta y la querés grande para entregar. Lográs: 1024×640 → ~2048×1280; en `diplocolab` es automático. *Límite:* 2× fijo, un solo modelo afinado para ilustración, no foto.

**🗣️ Describir imagen → prompt (Qwen-VL).** Subís una imagen y te devuelve un prompt en texto. Cuándo: viste algo lindo y no sabés cómo pedírselo a la IA. Lográs: el puente "referencia → palabras"; botón "Usar como prompt". *Límite:* NO genera imagen; 1ª vez ~1½ min.

**✏️ Editar imagen por instrucción (Qwen-Image-Edit).** Subís una imagen y escribís qué cambiar ("ponele pelo azul"); cambia eso y mantiene el resto. Cuándo: querés variantes sin rehacer — los **estados de Elena**. Lográs: una serie coherente del mismo personaje sin perder identidad. *Límite — el muro más duro:* necesita **L4** (OOM en T4), 1ª corrida ~10 min.

### 6.4 Explicación por parámetro (una frase + qué pasa si lo movés)

**Steps (8):** cuántas pasadas dibuja la IA. Subir = un poco más de detalle, más lento (arriba de ~12 casi no cambia). Bajar mucho = imagen a medio terminar.
**CFG (1.0):** cuánto le hace caso al prompt. ⚠️ Con Z-Image Turbo, pasar de 1 **quema y distorsiona**. Este modelo quiere CFG 1.
**Denoise (1.0):** cuánto borra de la imagen de partida. En txt2img dejalo en 1. Solo importa en img2img: 0.3 mantiene casi todo, 0.6 cambia bastante.
**Sampler (euler):** el "estilo de pincelada". euler = rápido y limpio. dpmpp_2m = más detalle. Los `_ancestral`/`_sde` agregan azar.
**Scheduler (simple):** cómo reparte el esfuerzo entre pasos. simple es lo seguro con Turbo.
**Seed (-1):** el número de la suerte del ruido. -1 = aleatorio. Fijar = reproducible. Si sacaste una que te encantó y no fijaste seed, no la repetís más.
**LoRA strength model (0.80):** fuerza del estilo/personaje. >1.2 = "frituras". 0 = no se nota. Zona 0.7–0.9.
**LoRA strength CLIP (1.00):** cuánto cambia la interpretación de tus palabras. 1.0 estándar; tocalo poco.
**ControlNet strength (0.90):** cuánto manda tu referencia. 0 ignora, 1 al pie. Rec. 0.7–0.9. ⚠️ No cambia la vista previa.
**Scale ref (0.19):** escala la referencia antes de procesarla. ⚠️ Número heredado del workflow; si no sabés qué hace, no lo toques.
**Resolution del preprocesador (512):** a qué tamaño se analiza la referencia. 512 = balance. Subir = más fino, más lento.
**Cantidad / batch (1):** cuántas imágenes por tanda. Se guardan todas; el visor muestra la última. Sube VRAM/tiempo lineal.
**Modo rápido (edit, ON):** atajo (LoRA Lightning, 4 pasos). Destildá = 20 pasos, más calidad, más lento.

### 6.5 Cómo hacerlo más interactivo (por valor/esfuerzo)

1. **Tooltips con "Probá esto" (esfuerzo bajo, valor alto).** Botón que aplica el valor de demostración. Ej. CFG: *"Con este modelo, más de 1 lo rompe. [Ver qué pasa: poné CFG en 8 →]"* — el usuario *ve* la imagen quemada y entiende para siempre.
2. **Ejemplos antes/después embebidos (esfuerzo medio).** Para ControlNet, img2img y Editar: miniaturas pre-hechas en `public/imagenes/_ejemplos/`. La guía de preprocesadores (modal `#preprocGuide`) es el lugar natural.
3. **Reescribir los badges del wizard en beneficios, no jerga (esfuerzo bajísimo):**

| Hoy (jerga) | Propuesto (beneficio primero) |
|---|---|
| `¿Personaje o estilo entrenado?` · `LoRA · liviano` | `Que aparezca siempre el mismo personaje/estilo` · `LoRA` |
| `¿Guiar con una imagen de referencia?` · `ControlNet · img2img` | `Que copie la pose/forma de una foto mía` · `ControlNet` |
| `¿Describir una imagen → prompt?` · `Qwen-VL · liviano` | `No sé cómo describir lo que quiero → ayudame` · `Qwen-VL` |
| `¿Editar una imagen con una instrucción?` · `Qwen-Image-Edit · pesado` | `Cambiarle algo a una imagen que ya tengo` · `Qwen-Edit · pesado` |

El nombre técnico no se borra (sirve para aprender el vocabulario), pero deja de ser lo primero que leen.
4. **Mini-glosario flotante (esfuerzo bajo):** ~12 términos, una frase cada uno, una sola fuente de verdad.
5. **Honestidad sobre el medidor de "peso" (corregir, no agregar).** La barra de `updateWeight` suma costos fijos inventados; no mide VRAM real. Aclarar: *"guía aproximada, no es una medición exacta"*. Coherente con la regla de no inventar datos.
6. **No romper el progressive disclosure ya resuelto.** El Modo Aprender NO debe prender todas las secciones de golpe: enriquece lo que el usuario ya decidió mostrar.

### 6.6 Dos arreglos de coherencia que la capa educativa hace evidentes

- **Idioma:** el `<title>` y el header están en inglés ("ComfyUI - AI Image Generation", "Disconnected") mientras todo lo demás es español. Una herramienta educativa en castellano no puede abrir en inglés. Una línea en `index.html`.
- **Redundancia:** dos botones "Describir imagen → prompt" (`describeImage` en `#sec-cn`, `describeQwen` en `#sec-qwen`) hacen lo mismo. Para un principiante son dos cosas que parecen distintas y son la misma. Unificar a uno.

---

## 7. Rediseño de interfaz

> Base: todo el CSS real vive inline en `public/index.html` (7-171); `public/css/style.css`, `index_legacy.html` e `index_new.html` son residuos muertos. Tema claro fijo, header en inglés, densidad salvada a medias por el wizard. El rediseño **reorganiza, re-tematiza y limpia** lo que ya existe — no inventa features.

### 7.1 Principios

1. **Una sola acción primaria por pantalla.** Hoy compiten `.config-section`, `.generation-section` y `.log-section` con el mismo peso. El usuario abre la app para *generar*; lo demás (config del Colab, consola Node) es soporte y debe **retroceder visualmente**.
2. **Progressive disclosure que ya existe — extenderlo.** `data-modes` + `data-wiz` (`script.js:10-20`, CSS 105-107) ya hace que arranques con prompt + Dimensiones + Generar. El error: el wizard mismo es denso (jerga). El disclosure tiene que esconder *complejidad técnica*, no *funciones detrás de jerga*.
3. **Reducir decisiones simultáneas.** El medidor de "peso" es buen instinto mal ejecutado (suma costos inventados). Reemplazar por **agrupación por intención** ("solo generar" vs "guiar con imagen" vs "editar").
4. **Descansar el ojo.** Hoy hay violeta + verde + rojo + naranja + azul saturados compitiendo. Para una herramienta que se mira mucho rato, cansa. Una superficie neutra de base, **un único acento**, color saturado SOLO para estado (ok/error/procesando).
5. **Mismo esqueleto para operar y aprender.** La guía, los tooltips y las `.section-desc` usan los mismos tokens, radios y tipografía. Lo educativo es una *capa*, no otra piel.

### 7.2 Layout propuesto (modo operativo): dos columnas

```
┌──────────────────────────────────────────────────────────────────────────┐
│  comfyweb            [● conectado · ComfyUI 0.26]        [☼/☾ tema]  [⚙]   │  ← topbar 48px
├───────────────────────────────────┬────────────────────────────────────────┤
│  COLUMNA CONTROLES (≈420px)        │  LIENZO (resto, sticky)                 │
│                                    │                                         │
│  ┌─ ¿Qué querés hacer? ─────────┐  │   ┌─────────────────────────────────┐  │
│  │ (•)Generar ( )Guiar ( )Editar │  │   │     [ imagen grande ]            │  │
│  └──────────────────────────────┘  │   └─────────────────────────────────┘  │
│  ┌─ PROMPT ─────────────────────┐  │   ┌── galería ──────────────────────┐  │
│  │ [ textarea grande ]          │  │   │ [▣][▣][▣][▣]   ⬇ zip   🗑        │  │
│  │ ▸ prompt negativo (colaps.)  │  │   └─────────────────────────────────┘  │
│  └──────────────────────────────┘  │                                         │
│  ┌─ Tamaño [1024]×[640]  🎲 ────┐  │   (el lienzo queda sticky mientras      │
│  └──────────────────────────────┘  │    scrolleás los controles)             │
│  ▸ Ajustes avanzados (sampler…)    │                                         │
│  ▸ Estilo / LoRA                   │   ← acordeón, cerrado por default        │
│  ▸ Más resolución / detalle        │                                         │
│  [ ▓▓▓▓▓░░░░░ generando… 45% ]     │                                         │
│  ┌─ 🚀 Generar imagen ──────────┐  │                                         │
│  └──────────────────────────────┘  │   ← acción primaria, sticky abajo       │
└───────────────────────────────────┴────────────────────────────────────────┘
   ▸ Consola Node.js (colapsada al pie, abrís solo si debuggeás)
```

Decisiones clave:
- **El selector "¿Qué querés hacer?" reemplaza al wizard de 6 checkboxes Y al `.workflow-selector`.** Tres intenciones: **Generar** (`diplocolab`/`zimage`), **Guiar con imagen** (abre `sec-cn`), **Editar** (abre `sec-qwen-edit`). Los toggles finos (LoRA, upscale, avanzados, describir) pasan a **acordeones secundarios siempre disponibles**, no preguntas previas.
- **El lienzo va a la derecha y queda sticky:** el resultado siempre a la vista mientras tocás parámetros (hoy hay que scrollear).
- **Config del Colab sale del flujo** al ícono `⚙` de la topbar; el estado vivo (verde/rojo + versión) queda **siempre visible** en la topbar.
- **Consola Node.js colapsada al pie**, con badge si hay errores.

**Módulo explicativo integrado en 3 niveles** (misma piel): Nivel 1 inline (`.section-desc` + `info-tip`, lo que ya hay); Nivel 2 bajo demanda (la guía de preprocesadores generalizada a pestañas: Preprocesadores · Parámetros · LoRA · Qué es ControlNet); Nivel 3 toggle "modo guiado" (expande las `.section-desc`, muestra rangos recomendados sobre los sliders, sin cambiar el layout).

### 7.3 Design tokens (dark + light)

Pensados para **no cansar**: en light el fondo no es blanco puro; en dark no es negro puro. Contraste ~AA, nunca máximo. Un solo acento (el violeta de marca se reserva para *un* elemento).

| Token | Rol | Light | Dark |
|---|---|---|---|
| `--bg` | fondo de la app | `#f4f5f7` | `#15171c` |
| `--surface` | cards, paneles | `#ffffff` | `#1d2027` |
| `--surface-2` | sub-paneles (hoy `#fafafa`) | `#f7f8fa` | `#242832` |
| `--surface-sunken` | inputs, consola | `#eef0f3` | `#0f1116` |
| `--border` | bordes finos | `#e2e5ea` | `#2c313b` |
| `--border-strong` | foco/hover | `#cfd4dc` | `#3a4150` |
| `--text` | texto principal | `#1c2026` | `#e6e8ec` |
| `--text-muted` | descripciones, hints | `#5b626d` | `#9aa1ad` |
| `--text-faint` | placeholders | `#8b919c` | `#6b7280` |
| `--accent` | acento de marca (1 solo lugar) | `#6d5ae0` | `#8b7cf0` |
| `--accent-hover` | hover del primario | `#5b49cc` | `#9d8ff5` |
| `--accent-soft` | fondo de acento sutil | `#ece9fb` | `#2a2640` |
| `--ok` | conectado / éxito | `#2e9e5b` | `#3fb873` |
| `--warn` | atención / peso medio | `#d98a00` | `#e8a32a` |
| `--error` | error / desconectado | `#d64545` | `#e86a6a` |
| `--info` | tooltips, presets | `#2f7dd1` | `#5aa0e8` |

El acento pasa de degradé doble (`#667eea → #764ba2`) a **un violeta sólido**; el degradé sobrevive como detalle en *un* elemento (barra de progreso), no como fondo de header. Los estados (`--ok/--warn/--error`) son los únicos saturados y solo significan estado.

**Tipografía:** mantener el system stack (`'Segoe UI'...`, cero costo, nativo en Windows). Escala 1.25: `--fs-xs:12` (hints/valores), `--fs-sm:13` (descripciones/labels), `--fs-base:15` (cuerpo/inputs), `--fs-lg:18` (títulos de sección), `--fs-xl:22` (título de app). Pesos 400/500/600. **Quitar MAYÚSCULAS** de los títulos de sección (hoy `uppercase` + barra degradé = ruido): peso 500 + `--text` + un punto de acento chico. Bajar el H1 de 28/700 a 22/600.

**Espaciado y radios:** base 4px (`--sp-1..8`). Radios `--radius-sm:6` (inputs/badges), `--radius:10` (cards), `--radius-lg:14` (contenedor/modal). `--gap:16`, `--pad-card:16`. Sombras suaves en light; en dark **casi sin sombra** (la jerarquía la da `--surface` vs `--bg` + `--border`).

### 7.4 Toggle dark/light — enfoque

1. Tokens como CSS custom properties en `:root` (light) y override en `:root[data-theme="dark"]`.
2. **Todo el CSS consume `var(--token)`, nunca hex literal.** El trabajo grueso es reemplazar cada hex inline por su variable. Una vez hecho, el tema cambia con un atributo.
3. El toggle setea `document.documentElement.dataset.theme` y persiste en `localStorage` (`comfyweb-theme`). Un `public/js/theme.js` chico (~20 líneas), cargado *antes* del render para evitar FOUC.
4. Default = `prefers-color-scheme` si no hay nada en localStorage.
5. Botón en la topbar (☼/☾), `aria-pressed`.

**Pre-requisito:** mover el `<style>` inline (`index.html:7-171`) a un `public/css/app.css` real y linkearlo, y borrar `css/style.css`, `index_legacy.html`, `index_new.html`. Cero cambios en `script.js`/`wizard.js`/`server.js`.

### 7.5 Componentes rediseñados (antes/después)

- **`param-section` → acordeón plano.** Hoy: card `#fafafa`, título MAYÚSCULAS con barra degradé, `.section-desc` en caja con borde violeta. Después: header clickeable (título peso 500 + punto `--accent` + chevron), cerrado por default; al abrir fondo `--surface-2`, `.section-desc` como texto `--text-muted`. La jerarquía la da abrir/cerrar, no el color.
- **Control con tooltip educativo.** Ícono `ⓘ` en `--text-faint`, se aclara a `--info` en hover. **Todos** los params con tooltip (cerrar gaps: `#width`/`#height` del panel simple, y un texto honesto para `scaleBy` 0.19). En modo guiado, el rango recomendado aparece inline bajo el slider.
- **Wizard → segmented control de 3 intenciones.** Reemplaza los 6 checkboxes + el medidor falso. El peso se reemplaza por un **chip honesto** solo donde aplica de verdad: en "Editar" y "más resolución", un chip `--warn` "pesado · necesita L4" (verificado en `PENDIENTES.md`). No un número 0-11, sino la verdad operativa que informa una decisión real (qué GPU pedir). **Por debajo no cambia nada:** el segmented control prende los mismos `data-wiz`/`data-modes`.
- **Galería.** Misma lógica, reubicada a la columna derecha bajo el lienzo, re-tematizada (la activa con anillo `--accent`, el ⬇ en hover, acciones como botones-ícono).

### 7.6 Priorización (quick wins → estructural)

**Quick wins (alto impacto, bajo riesgo — empezar acá):**
1. Borrar el ruido muerto (`css/style.css`, `index_legacy.html`, `index_new.html`). Cero riesgo.
2. Arreglar el idioma (`<title>` + header en inglés → español). 3 strings.
3. Tooltips faltantes (`#width`/`#height`, texto honesto a `scaleBy`).
4. Bajar el grito visual (quitar `uppercase`, H1 28→22, suavizar sombras). Solo CSS.
5. Eliminar el botón "Describir imagen" duplicado.

**Cambios medianos (1-2 sesiones):**
6. Externalizar el CSS a `public/css/app.css` (pre-requisito de todo).
7. Tokenizar (reemplazar cada hex por `var(--token)`).
8. Implementar dark/light (`[data-theme]` + `theme.js` + toggle + persistencia).
9. Acordeones planos para `param-section`.

**Cambios grandes (discutir alcance con Leo antes):**
10. Layout de dos columnas (config a popover, lienzo sticky, consola al pie).
11. Wizard → selector de intención + chip honesto T4/L4.
12. Módulo educativo en 3 niveles (guía con pestañas + "modo guiado").

> Orden recomendado: 1-5 (una sesión) → 6-8 (la base tematizable + dark mode, el pedido central) → 9 → 10-11 → 12. Los quick wins + dark mode entregan el 70% de la sensación "minimalista, descansa el ojo, dos temas" sin tocar arquitectura. Layout y módulo educativo son donde conviene parar y validar, porque mueven estructura y es entregable de diplomatura. No hay tests ni linter (consistente con Cosmos): se valida a ojo en el navegador.

---

## 8. Roadmap priorizado

> Cruza las tres patas (robustez, extensibilidad, UX/rediseño). Empezar por quick wins; los cambios estructurales se validan con Leo.

### Fase 0 — Quick wins (una sesión, casi cero riesgo)
- **A1** robustez: try/catch en el handler WS (`server.js:131`). 3 líneas, tapa la última grieta de crash. **Lo primero.**
- Limpiar ruido muerto (`css/style.css`, `index_legacy.html`, `index_new.html`).
- Arreglar idioma (`<title>` + header).
- Tooltips faltantes (`#width`/`#height`, `scaleBy`).
- Bajar el grito visual (uppercase, H1, sombras).
- Unificar el botón "Describir imagen" duplicado.
- Reescribir los badges del wizard en beneficios (no jerga).

### Fase 1 — Comunicación y recuperación (robustez visible)
- **A3 + A6:** banner accionable de Colab caído + healthcheck con GPU activa (avisar/deshabilitar Edit en T4). Convierten fallas tardías de 12 min en avisos instantáneos.
- **A2:** reconexión WS con backoff. Recupera el feed de progreso.
- Colab: imprimir GPU al arranque, verificar `/system_stats` post-`wait_8188`, try/except en `leo_lora_fetch`.

### Fase 2 — Base tematizable + dark/light (el pedido central de UX)
- Externalizar CSS → `app.css`; tokenizar; implementar `[data-theme]` + `theme.js` + toggle + persistencia.
- Acordeones planos para `param-section`.

### Fase 3 — Estructura (validar alcance con Leo)
- Layout de dos columnas; wizard → selector de intención + chip honesto T4/L4.
- Módulo educativo en 3 niveles ("Modo Aprender" overlay + guía con pestañas).
- Presets ("Rápido", "Calidad", "Personaje Elena", "Desde referencia", "Editar estado").

### Fase 4 — Extensibilidad (refactor incremental, no big-bang)
- Manifiesto + endpoint genérico `/api/tool/:id` + `GraphEngine.compose`.
- Matar el primer espejo `RICH_PREPROCS`/`PP_RICH`.
- Portar herramientas de a una; las viejas conviven mientras tanto.
- Sobre esta base, sumar lo creativo barato: **multi-LoRA** (casi gratis), **inpainting** (mejor valor/esfuerzo que falta), y a futuro **video LTX** (rumbo declarado).

### Qué NO hacer ahora
- **Cola persistente / auto-reintento agresivo de generación:** sobre-ingeniería para este uso. Un botón "Reintentar" manual alcanza (A7).
- **Keep-alive del Colab:** va contra los TOS. La respuesta correcta es arranque idempotente, no mantener vivo a la fuerza.
- **Atomizar el `workflow_diplo.json` completo en bloques:** usar el escape hatch `raw`. No forzar atomicidad donde no hay reúso.
- **Reescribir la lógica de visibilidad `data-modes`/`data-wiz`:** funciona; el rediseño la reusa, no la toca.
- **Big-bang de extensibilidad:** migrar de a una herramienta.

---

### Archivos de referencia (rutas absolutas, todas bajo `comfyweb/`)
- Backend, endpoints y grafos: `server.js`
- UI + todo el CSS real: `public/index.html`
- Lógica/galería/generación: `public/js/script.js` · Wizard: `public/js/wizard.js` · Preprocesadores: `public/js/preproc.js` · Modelos: `public/js/models.js` · Config/ping: `public/js/config.js` · Qwen: `public/js/qwen.js`, `public/js/qwen-edit.js`
- Grafos en disco: `workflow_zimage.json`, `workflow_diplo_colab.json`, `workflow_diplo_colab_cn.json`, `workflow_diplo.json`, `workflow_preprocess.json`
- Colab (modelos, túnel, custom nodes): `comfy-colab-leo/ComfyUI_Leo.ipynb`
- Límites T4/L4 verificados en vivo, pendientes: `PENDIENTES.md`
- A borrar (ruido muerto): `public/css/style.css`, `public/index_legacy.html`, `public/index_new.html`
