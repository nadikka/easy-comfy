/* ============================================================
   i18n de easy comfy — traducción ES ⇄ EN en runtime.
   - Diccionario ES→EN (texto de nodos + atributos data-tip/placeholder/title/alt).
   - Recorre nodos de texto (TreeWalker) → funciona con <b>/<i> intercalados
     porque cada fragmento es su propio nodo de texto.
   - MutationObserver: traduce también lo que el JS inyecta luego (banner, galería).
   - Popup de idioma al primer arranque + toggle en la topbar. Persiste en localStorage.
   ============================================================ */
(function () {
  'use strict';

  // ---- Diccionario ES → EN (clave = texto en español, normalizado por espacios) ----
  const ES_EN = {
    // Topbar / estado
    "Conectando…": "Connecting…",
    "Conectando...": "Connecting...",
    "Conectado": "Connected",
    "Desconectado": "Disconnected",
    "Sin respuesta": "No response",
    "Colab vivo": "Colab alive",
    "No se pudo verificar la conexión": "Couldn't verify the connection",
    "📖 Guía": "📖 Guide",
    "Guía: cómo funciona, parámetros, LoRA, ControlNet": "Guide: how it works, parameters, LoRA, ControlNet",
    "Cambiar entre modo claro y oscuro": "Toggle light / dark mode",
    "Configuración del Colab": "Colab settings",

    // Config panel
    "⚙️ Configuración de ComfyUI (Colab)": "⚙️ ComfyUI settings (Colab)",
    "Colab (Cloudflare)": "Colab (Cloudflare)",
    "URL de ComfyUI (ej: https://comfy.leoblumfeld.com)": "ComfyUI URL (e.g. https://your-tunnel.trycloudflare.com)",
    "Guardar y Conectar": "Save & Connect",
    "Pegá la URL *.trycloudflare.com del Colab": "Paste the Colab's *.trycloudflare.com URL",
    "Por favor ingrese una URL válida": "Please enter a valid URL",
    "URL inválida. Debe incluir el protocolo (http:// o https://": "Invalid URL. It must include the protocol (http:// or https://",
    "Error al guardar configuración: ": "Error saving configuration: ",
    "Error al guardar configuración": "Error saving configuration",

    // Banner (config.js)
    "El Colab no responde.": "Colab isn't responding.",
    "reconectá / Ejecutá todas": "reconnect / Run all",
    "Andá al notebook de Colab,": "Go to the Colab notebook,",
    "las celdas, esperá el banner de la URL, y si cambió la URL pegala arriba y Guardá. Mientras tanto Generar está deshabilitado.":
      "the cells, wait for the URL banner, and if the URL changed paste it above and Save. Meanwhile Generate is disabled.",

    // Welcome "¿Qué es esto?"
    "¿Qué es esto?": "What is this?",
    "Generar imágenes con IA.": "Generate images with AI.",
    "Un modelo aprendió mirando millones de imágenes con su descripción. Le escribís una descripción (un":
      "A model learned by looking at millions of images and their captions. You write a description (a",
    "prompt": "prompt",
    ") y te dibuja una imagen nueva que nunca existió: no la copia, la":
      ") and it draws a brand-new image that never existed: it doesn't copy it, it",
    "imagina": "imagines",
    "Qué es un \"nodo\".": "What's a \"node\".",
    "Hacer una imagen es una cadena de pasos: cargar modelo → leer prompt → dibujar → mejorar → guardar. ComfyUI los muestra como cajitas conectadas con cables, a mano — potente y un quilombo (el tablero de un electricista).":
      "Making an image is a chain of steps: load model → read prompt → draw → enhance → save. ComfyUI shows them as boxes wired together by hand — powerful and a mess (an electrician's board).",
    "Qué hace easy comfy.": "What easy comfy does.",
    "Yo ya armé esos tableros por adentro. Vos ves botones, no cables. Es la misma máquina, pero con":
      "I already wired those boards on the inside. You see buttons, not cables. Same machine, but with a",
    "tablero de auto": "car dashboard",
    "en vez de tablero de electricista.": "instead of an electrician's board.",
    "El cómputo pasa en una placa prestada en la nube (Colab). El semáforo de arriba 🟢/🔴 te dice si está despierta.":
      "The computing runs on a borrowed GPU in the cloud (Colab). The 🟢/🔴 light up top tells you if it's awake.",

    // Selector de intención
    "¿Qué querés hacer?": "What do you want to do?",
    "Crear": "Create",
    "Editar": "Edit",
    "Restaurar": "Restore",
    "Creás una imagen desde una descripción (y, si querés, partiendo de una imagen).":
      "Create an image from a description (and, if you want, starting from an image).",
    "Subís una imagen y le cambiás algo puntual con una instrucción. Necesita L4.":
      "Upload an image and change something specific with an instruction. Needs L4.",
    "Subís una foto y la agrandás reconstruyendo detalle real (img2img + upscale).":
      "Upload a photo and enlarge it reconstructing real detail (img2img + upscale).",
    "Mejor escribilo en INGLÉS: estos modelos se entrenaron con descripciones en inglés y rinden bastante mejor. ¿No sabés cómo? Usá 'Describir imagen → prompt' y te lo arma.":
      "Better write it in ENGLISH: these models were trained on English captions and perform noticeably better. Not sure how? Use 'Describe image → prompt' and it builds it for you.",

    // Prompt block
    "📝 Prompt — describí la imagen": "📝 Prompt — describe the image",
    "Describe la imagen que querés generar... (ej: lowpoly fox in a misty forest, geometric, soft light)":
      "Describe the image you want to generate... (e.g. lowpoly fox in a misty forest, geometric, soft light)",
    "Escribí el prompt en inglés.": "Write the prompt in English.",
    "Estos modelos se entrenaron con descripciones en inglés y rinden bastante mejor así. (¿No sabés cómo? Usá \"Describir imagen → prompt\", te lo arma.)":
      "These models were trained on English captions and perform much better that way. (Not sure how? Use \"Describe image → prompt\", it builds it for you.)",
    "🚫 Negative prompt — lo que NO querés": "🚫 Negative prompt — what you DON'T want",
    "Lo que querés evitar en la imagen: blur, deformaciones, marcas de agua, texto. Recomendado: blurry, low quality, deformed, text, watermark.":
      "What to avoid in the image: blur, deformations, watermarks, text. Recommended: blurry, low quality, deformed, text, watermark.",

    // Prompt builder
    "Constructor de prompt (estilo + cámara)": "Prompt builder (style + camera)",
    "Estilo": "Style",
    "Cámara / óptica": "Camera / optics",
    "Detalles": "Details",
    "Iluminación cinematográfica": "Cinematic lighting",
    "Profundidad de campo (bokeh)": "Depth of field (bokeh)",
    "Alta calidad / detalle": "High quality / detail",
    "Color grading": "Color grading",
    "Composición equilibrada": "Balanced composition",
    "Motion blur": "Motion blur",
    "Grano de película": "Film grain",
    "Sin marca de agua ni texto": "No watermark or text",
    "Se agrega al prompt (en inglés):": "Added to the prompt (in English):",
    "(elegí estilo, cámara o detalles)": "(pick a style, camera or details)",
    "➕ Agregar al prompt": "➕ Add to prompt",
    "Transfiere un estilo visual al prompt (Ghibli, óleo, cyberpunk, poster soviético...). Se agrega en inglés.":
      "Transfers a visual style to the prompt (Ghibli, oil, cyberpunk, Soviet poster...). Added in English.",
    "Simula una cámara o look fotográfico (Leica, Hasselblad, golden hour, compresión cinemática...).":
      "Simulates a camera or photographic look (Leica, Hasselblad, golden hour, cinematic compression...).",

    // Tamaño
    "Tamaño": "Size",
    "Ancho": "Width",
    "Alto": "Height",
    "Ancho base": "Base width",
    "Alto base": "Base height",
    "Cantidad": "Count",
    "Modelo:": "Model:",
    "Steps:": "Steps:",

    // Editar (Qwen edit)
    "Editar imagen → instrucción": "Edit image → instruction",
    "📎 Imagen a editar": "📎 Image to edit",
    "Subí una imagen para editar.": "Upload an image to edit.",
    "✏️ Instrucción de edición": "✏️ Edit instruction",
    "ponele pelo azul / cambiá el fondo a un bosque / agregale lentes...":
      "make the hair blue / change the background to a forest / add glasses...",
    "Modo rápido": "Fast mode",
    "(LoRA Lightning, 4 pasos — destildá para más calidad y más lento)":
      "(Lightning LoRA, 4 steps — untick for more quality and slower)",
    "✏️ Editar imagen": "✏️ Edit image",

    // Restaurar
    "Restaurar / más detalle": "Restore / more detail",
    "📎 Imagen a restaurar": "📎 Image to restore",
    "Subí una imagen para restaurar.": "Upload an image to restore.",
    "Fidelidad (Denoise)": "Fidelity (Denoise)",
    "Modelo de upscale": "Upscale model",
    "Guía opcional (prompt)": "Optional guidance (prompt)",
    "high quality, sharp detail, restored (opcional, en inglés)":
      "high quality, sharp detail, restored (optional, in English)",
    "🔧 Restaurar imagen": "🔧 Restore image",

    // Imagen de partida / ControlNet
    "¿Partís de una imagen?": "Starting from an image?",
    "(opcional)": "(optional)",
    "📎 Imagen de partida": "📎 Starting image",
    "Sin imagen: generás desde cero (txt2img puro).": "No image: generate from scratch (pure txt2img).",
    "🖼️ Usarla de base": "🖼️ Use as base",
    "🎯 Copiar su estructura": "🎯 Copy its structure",
    "🔍 Ver preprocesado": "🔍 Preview preprocess",
    "📖 Guía de preprocesadores": "📖 Preprocessors guide",
    "Preprocessor": "Preprocessor",
    "Resolution": "Resolution",
    "ControlNet strength": "ControlNet strength",
    "Scale ref": "Scale ref",
    "Quitar imagen": "Remove image",

    // LoRA
    "Estilo / Personaje (LoRA)": "Style / Character (LoRA)",
    "Usar LoRA en la generación": "Use LoRA in generation",
    "LoRA name": "LoRA name",
    "Model strength": "Model strength",
    "CLIP strength": "CLIP strength",
    "➕ Agregar un LoRA por link": "➕ Add a LoRA by link",
    "nombre.safetensors (opcional)": "name.safetensors (optional)",
    "⬇️ Agregar LoRA": "⬇️ Add LoRA",
    "El archivo se descarga en el Colab (a Drive) y queda disponible.":
      "The file downloads to Colab (to Drive) and becomes available.",

    // Qwen describir
    "Describir imagen → prompt (Qwen-VL)": "Describe image → prompt (Qwen-VL)",
    "📎 Imagen a describir": "📎 Image to describe",
    "Subí una imagen para describir.": "Upload an image to describe.",
    "🎭 Rol del que describe": "🎭 Describer role",
    "🔎 Describir → prompt": "🔎 Describe → prompt",
    "Descripción generada (editá si querés)": "Generated description (edit if you want)",
    "⬇️ Usar como prompt": "⬇️ Use as prompt",

    // KSampler
    "Ajustes avanzados (KSampler)": "Advanced settings (KSampler)",
    "Denoise": "Denoise",
    "Sampler": "Sampler",
    "Scheduler": "Scheduler",

    // Upscale / output
    "Más resolución (Output & Upscale)": "More resolution (Output & Upscale)",
    "🔧 Modelos avanzados ▸": "🔧 Advanced models ▸",
    "UNET model": "UNET model",
    "Weight dtype": "Weight dtype",
    "VAE model": "VAE model",
    "CLIP model": "CLIP model",
    "Upscale model": "Upscale model",

    // Seed + generar
    "Semilla": "Seed",
    "🎲 Aleatorio": "🎲 Random",
    "🚀 Generar Imagen": "🚀 Generate Image",
    "Generando...": "Generating...",

    // Galería / consola
    "🖼️ Galería": "🖼️ Gallery",
    "Descargar todas (.zip)": "Download all (.zip)",
    "Limpiar vista": "Clear view",
    "📋 Consola Node.js": "📋 Node.js console",
    "(clic para ocultar/mostrar)": "(click to hide/show)",
    "Sistema iniciado...": "System started...",

    // ── Tooltips (data-tip) ──
    "Checkpoint a usar. Se cargan automáticamente desde ComfyUI al conectar":
      "Checkpoint to use. They load automatically from ComfyUI on connect",
    "Pasos de muestreo. Z-Image Turbo va bien con 8. Más = más lento.":
      "Sampling steps. Z-Image Turbo works well with 8. More = slower.",
    "Ancho en píxeles de la imagen. Más grande = más detalle pero más lento y más VRAM. 1024 anda bien; arriba de ~1536 la T4 sufre.":
      "Image width in pixels. Bigger = more detail but slower and more VRAM. 1024 works well; above ~1536 the T4 struggles.",
    "Alto en píxeles de la imagen. Mismo criterio que el ancho. La relación ancho×alto define el formato (1024×640 = panorámico).":
      "Image height in pixels. Same idea as width. The width×height ratio sets the format (1024×640 = panoramic).",
    "Ancho en píxeles de la generación inicial con KSampler (EmptySD3LatentImage)":
      "Width in pixels of the initial KSampler generation (EmptySD3LatentImage)",
    "Alto en píxeles de la generación inicial con KSampler (EmptySD3LatentImage)":
      "Height in pixels of the initial KSampler generation (EmptySD3LatentImage)",
    "Cuántas imágenes generar en una pasada (batch_size). 1 = una. Más = más VRAM/tiempo. Se guardan todas; el panel muestra la última.":
      "How many images to generate per run (batch_size). 1 = one. More = more VRAM/time. All are saved; the panel shows the last one.",
    "Prompt separado para el paso de refinado con tiles. Si se deja vacío, usa el prompt principal":
      "Separate prompt for the tile refine step. If left empty, it uses the main prompt",
    "Se sube al ComfyUI del Colab. Qwen-Image-Edit la toma como base y aplica tu instrucción.":
      "Uploaded to the Colab's ComfyUI. Qwen-Image-Edit takes it as a base and applies your instruction.",
    "Qué querés cambiar, en lenguaje natural. Mejor en inglés. Ej: 'make the hair blue', 'change the background to a forest', 'add glasses'.":
      "What you want to change, in natural language. Better in English. E.g. 'make the hair blue', 'change the background to a forest', 'add glasses'.",
    "Se sube al ComfyUI del Colab y se usa como base (img2img). El resultado entra a la galería.":
      "Uploaded to the Colab's ComfyUI and used as a base (img2img). The result goes to the gallery.",
    "Cuánto se aleja del original. 0.2 = casi idéntico (restaurar/limpiar una foto), 0.4 = mejora con cambios, alto = reinventa. Para fotos reales: 0.15–0.3.":
      "How far it strays from the original. 0.2 = nearly identical (restore/clean a photo), 0.4 = improve with changes, high = reinvents. For real photos: 0.15–0.3.",
    "El modelo que agranda. AnimeSharp = ilustración/limpio, 4x foto = realista, DJPG = saca artefactos de JPG. Se llena del backend al conectar.":
      "The model that enlarges. AnimeSharp = illustration/clean, 4x photo = realistic, DJPG = removes JPG artifacts. Filled from the backend on connect.",
    "Texto que orienta el detalle agregado, en inglés. Vacío = solo limpia/agranda. Ej: 'sharp detail, restored photo, fine grain'.":
      "Text that guides the added detail, in English. Empty = only cleans/enlarges. E.g. 'sharp detail, restored photo, fine grain'.",
    "Se sube al ComfyUI del Colab. La misma imagen sirve para describirla, usarla de base (img2img) o copiar su estructura (ControlNet).":
      "Uploaded to the Colab's ComfyUI. The same image works to describe it, use it as a base (img2img) or copy its structure (ControlNet).",
    "La imagen NO aparece en el resultado: se le extrae la ESTRUCTURA (bordes, pose o profundidad, con el preprocesador de abajo) y la imagen nueva la respeta. Tu prompt define el contenido; la foto define la forma. Ej: tu personaje en la pose exacta de la foto, o el contorno de un edificio. Fuerza con 'ControlNet strength'.":
      "The image does NOT appear in the result: its STRUCTURE is extracted (edges, pose or depth, with the preprocessor below) and the new image respects it. Your prompt defines the content; the photo defines the shape. E.g. your character in the exact pose of the photo, or a building's outline. Strength via 'ControlNet strength'.",
    "La imagen ES el punto de partida y el modelo la REPINTA según el Denoise: bajo (~0.3) mantiene casi todo (variar expresiones del mismo personaje, mejorar/restaurar), alto (~0.6) cambia bastante. El resultado conserva la composición de tu foto. Acá NO se usa el preprocesador. Recomendado: denoise 0.3–0.5.":
      "The image IS the starting point and the model REPAINTS it based on Denoise: low (~0.3) keeps almost everything (vary expressions of the same character, enhance/restore), high (~0.6) changes a lot. The result keeps your photo's composition. The preprocessor is NOT used here. Recommended: denoise 0.3–0.5.",
    "Nombre del archivo en ComfyUI/input/ (modo DIPLO completo)":
      "File name in ComfyUI/input/ (full DIPLO mode)",
    "Qué se extrae de la referencia. Canny = bordes, Depth = profundidad, OpenPose = pose, HED = bordes suaves. Recomendado: Canny para formas definidas (mirá la 📖 Guía).":
      "What gets extracted from the reference. Canny = edges, Depth = depth, OpenPose = pose, HED = soft edges. Recommended: Canny for defined shapes (see the 📖 Guide).",
    "Resolución a la que se procesa la imagen de referencia. 512 es buen balance calidad/velocidad":
      "Resolution at which the reference image is processed. 512 is a good quality/speed balance",
    "Qué tanto influye ControlNet en la generación. 0 = ignora la referencia, 1 = sigue fielmente. Recomendado: 0.7–0.9.":
      "How much ControlNet influences the generation. 0 = ignores the reference, 1 = follows it faithfully. Recommended: 0.7–0.9.",
    "Factor de escala de la imagen de referencia antes de entrar al pipeline. <1 = reduce, >1 = amplía":
      "Scale factor of the reference image before entering the pipeline. <1 = shrink, >1 = enlarge",
    "Archivo del LoRA a cargar. Define el estilo visual. Se llena solo desde ComfyUI al conectar. Recomendado: el que quieras + fuerza 0.7–0.9.":
      "The LoRA file to load. Defines the visual style. Auto-filled from ComfyUI on connect. Recommended: whichever you want + strength 0.7–0.9.",
    "Intensidad del LoRA sobre el modelo. 0 = no se aplica, 1 = fuerza completa. >1.2 'fríe' el personaje. Recomendado: 0.7–0.9.":
      "LoRA intensity on the model. 0 = not applied, 1 = full strength. >1.2 'fries' the character. Recommended: 0.7–0.9.",
    "Intensidad del LoRA sobre el CLIP (el text encoder). 1.0 es lo estándar. 0 = el LoRA no toca el prompt, solo el modelo.":
      "LoRA intensity on the CLIP (the text encoder). 1.0 is standard. 0 = the LoRA doesn't touch the prompt, only the model.",
    "Pegá el link de descarga directa (.safetensors). De Civitai: botón derecho en 'Download' → Copiar enlace (incluye tu token). Se baja al Colab y aparece en el desplegable.":
      "Paste the direct download link (.safetensors). From Civitai: right-click 'Download' → Copy link (includes your token). It downloads to Colab and appears in the dropdown.",
    "Se sube al ComfyUI del Colab y la mira el Qwen3-VL. No se usa para generar: solo para sacar el prompt.":
      "Uploaded to the Colab's ComfyUI and read by Qwen3-VL. Not used to generate: only to derive the prompt.",
    "El 'system prompt': le da una personalidad/enfoque al modelo de visión. Un fotógrafo documental describe distinto que un artista de collage. Elegí un preset o escribí el tuyo (en inglés).":
      "The 'system prompt': gives the vision model a personality/focus. A documentary photographer describes differently than a collage artist. Pick a preset or write your own (in English).",
    "Cantidad de pasos de muestreo. Más = más calidad pero más lento. Recomendado: 8 (Z-Image-Turbo va bien con 4–12).":
      "Number of sampling steps. More = more quality but slower. Recommended: 8 (Z-Image-Turbo works well with 4–12).",
    "Classifier-Free Guidance: qué tanto sigue el prompt. 1 = sigue el prompt exacto, 7+ = más creativo pero puede distorsionar. Recomendado: 1 (Z-Image-Turbo).":
      "Classifier-Free Guidance: how closely it follows the prompt. 1 = follows the prompt exactly, 7+ = more creative but can distort. Recommended: 1 (Z-Image-Turbo).",
    "Fuerza de eliminación de ruido. 1.0 = generación desde cero, 0.5 = mantiene 50% de la imagen original. Para txt2img puro: 1.0":
      "Denoise strength. 1.0 = generate from scratch, 0.5 = keeps 50% of the original image. For pure txt2img: 1.0",
    "Algoritmo de muestreo. euler = rápido y limpio, dpmpp_2m = más detalle, ipndm = suave. Recomendado: euler.":
      "Sampling algorithm. euler = fast and clean, dpmpp_2m = more detail, ipndm = smooth. Recommended: euler.",
    "Estrategia de scheduling de ruido. simple = lineal, normal = estándar SD, ddim_uniform = más variación. Recomendado: simple.":
      "Noise scheduling strategy. simple = linear, normal = SD standard, ddim_uniform = more variation. Recommended: simple.",
    "Pasos de muestreo para el refinado de cada tile. Menos que los steps base, típicamente 5-15":
      "Sampling steps for refining each tile. Fewer than the base steps, typically 5-15",
    "Cuánto ruido agregar en el tile refine. 0.1-0.3 mantiene la estructura, 0.5+ cambia más":
      "How much noise to add in tile refine. 0.1-0.3 keeps the structure, 0.5+ changes more",
    "Cantidad de columnas en la grilla de tiles. 2-4 es lo normal":
      "Number of columns in the tile grid. 2-4 is normal",
    "Cantidad de filas en la grilla de tiles. 2-4 es lo normal":
      "Number of rows in the tile grid. 2-4 is normal",
    "Solapamiento entre tiles como fracción (0.05 = 5%). Reduce líneas de unión visibles":
      "Overlap between tiles as a fraction (0.05 = 5%). Reduces visible seams",
    "Sampler para el tile refine. Generalmente mismo que el base":
      "Sampler for tile refine. Usually the same as the base",
    "Scheduler para tile refine. simple = comportamiento más predecible":
      "Scheduler for tile refine. simple = most predictable behavior",
    "Ancho final en píxeles después del upscale + resize. Determina el tamaño de la imagen de salida":
      "Final width in pixels after upscale + resize. Sets the output image size",
    "Alto final en píxeles después del upscale + resize":
      "Final height in pixels after upscale + resize",
    "Cómo ajustar la imagen a las dimensiones finales: crop = recorta, stretch = estira, pad = agrega bordes":
      "How to fit the image to the final dimensions: crop = crops, stretch = stretches, pad = adds borders",
    "Algoritmo de redimensionado. lanczos = mejor calidad, nearest-exact = pixel art / lowpoly, bilinear = rápido":
      "Resize algorithm. lanczos = best quality, nearest-exact = pixel art / lowpoly, bilinear = fast",
    "Modelo de difusión principal. Z-Image-Turbo es rápido y funciona bien con pocos steps. Se llena solo desde ComfyUI":
      "Main diffusion model. Z-Image-Turbo is fast and works well with few steps. Auto-filled from ComfyUI",
    "Precisión de los pesos: fp8_e4m3fn = rápido y eficiente VRAM, fp16 = más preciso pero más pesado":
      "Weight precision: fp8_e4m3fn = fast and VRAM-efficient, fp16 = more precise but heavier",
    "Variational Autoencoder. UltraFlux está optimizado para modelos Flux/Z-Image. Se llena solo desde ComfyUI":
      "Variational Autoencoder. UltraFlux is optimized for Flux/Z-Image models. Auto-filled from ComfyUI",
    "Text encoder. Qwen 4B es el CLIP que usa Z-Image-Turbo. Se llena solo desde ComfyUI":
      "Text encoder. Qwen 4B is the CLIP that Z-Image-Turbo uses. Auto-filled from ComfyUI",
    "Modelo de upscale. AnimeSharp = optimizado para ilustraciones/estilos limpios. Se llena solo desde ComfyUI":
      "Upscale model. AnimeSharp = optimized for illustrations/clean styles. Auto-filled from ComfyUI",
    "Modelo de ControlNet Union que acepta múltiples tipos de preprocesadores. Se llena solo desde ComfyUI":
      "ControlNet Union model that accepts multiple preprocessor types. Auto-filled from ComfyUI",
    "Semilla aleatoria. -1 = aleatoria cada vez. Fijar un número = resultados reproducibles. Recomendado: -1 para explorar, fijá un número cuando te guste un resultado.":
      "Random seed. -1 = random every time. Set a number = reproducible results. Recommended: -1 to explore, set a number when you like a result.",

    // ── Opciones de menús / selects ──
    "⭐ Canny Edge (bordes duros)": "⭐ Canny Edge (hard edges)",
    "⭐ Lineart Standard (líneas)": "⭐ Lineart Standard (lines)",
    "⭐ Depth Anything V2 (profundidad)": "⭐ Depth Anything V2 (depth)",
    "⭐ MiDaS Normal Map (relieve)": "⭐ MiDaS Normal Map (relief)",
    "⭐ DWPose (pose cuerpo/manos/cara)": "⭐ DWPose (body/hands/face pose)",
    "⭐ HED (bordes suaves)": "⭐ HED (soft edges)",
    "⭐ TTPlanet Tile (detalle/upscale)": "⭐ TTPlanet Tile (detail/upscale)",
    "crop (recortar)": "crop",
    "stretch (estirar)": "stretch",
    "pad (bordes)": "pad (borders)",
    "— (conectá / agregá un LoRA) —": "— (connect / add a LoRA) —",

    // ── "Probá esto" (demos) ──
    "Probá esto:": "Try this:",
    "subí la fuerza a 1.5": "raise the strength to 1.5",
    "y vas a ver cómo el personaje se \"fríe\". La zona buena es 0.7–0.9.":
      "and you'll see the character \"fry\". The good zone is 0.7–0.9.",
    "poné CFG en 8": "set CFG to 8",
    "y mirá cómo se \"quema\" la imagen. Z-Image Turbo quiere CFG 1.":
      "and watch the image \"burn\". Z-Image Turbo wants CFG 1.",

    // Guía modal
    "📖 Guía de easy comfy": "📖 easy comfy guide",
    "Preprocesadores": "Preprocessors",
    "Parámetros": "Parameters",
    "LoRA": "LoRA",
    "Qué es ControlNet": "What is ControlNet",

    // Guía modal — títulos h4 (fragmentos con <span class="term">)
    "(pasos)": "(steps)",
    "(qué tanto obedece el prompt)": "(how much it obeys the prompt)",
    "(cuánto borra antes de redibujar)": "(how much it erases before redrawing)",
    "(semilla)": "(seed)",
    "(el algoritmo)": "(the algorithm)",
    "Fuerza (model strength)": "Strength (model strength)",
    "¿No está en la lista?": "Not in the list?",
    "Cómo funciona el flujo": "How the flow works",
    "Dos cosas que confunden": "Two confusing things",

    // section-desc sin negrita (fragmento único)
    "El tamaño base en píxeles de la generación. Más grande = más lento y más VRAM. Los defaults (1024×640) andan bien. El prompt y el negativo se escriben en la caja grande de arriba.":
      "The base size in pixels of the generation. Bigger = slower and more VRAM. The defaults (1024×640) work well. The prompt and negative are written in the big box above.",
    "Refinado de alta resolución dividiendo la imagen en mosaicos y regenerando cada uno con poco denoise. Da más detalle pero es delicado de calibrar. Solo en el DIPLO completo. (En \"DIPLO Colab\" el upscale es directo 2× — más simple y robusto.)":
      "High-res refinement by splitting the image into tiles and regenerating each with low denoise. Gives more detail but is delicate to calibrate. Only in the full DIPLO. (In \"DIPLO Colab\" the upscale is a direct 2× — simpler and more robust.)",

    // Preview + varios
    "Vista previa del preprocesado (lo que \"ve\" el ControlNet):": "Preprocess preview (what ControlNet \"sees\"):",
    "preview preprocesado": "preprocess preview",
    "Modelo (tamaño)": "Model (size)",
    "a (ángulo)": "a (angle)",
    "Cuerpo": "Body",
    "Manos": "Hands",
    "Cara": "Face",
    "Safe (suaviza)": "Safe (smooths)",
    "Sí": "Yes",
    "Preprocesador genérico (nodo AIO, sin parámetros propios). Para controles finos, elegí uno de los 7 dedicados (Canny, Lineart Standard, Depth Anything V2, MiDaS Normal, DWPose, HED, TTPlanet Tile).":
      "Generic preprocessor (AIO node, no parameters of its own). For fine controls, pick one of the 7 dedicated ones (Canny, Lineart Standard, Depth Anything V2, MiDaS Normal, DWPose, HED, TTPlanet Tile).",

    // Familias de preprocesadores (leyenda + guía)
    "Bordes duros": "Hard edges",
    "Bordes suaves / sketch": "Soft edges / sketch",
    "Rectas": "Straight lines",
    "Profundidad": "Depth",
    "Normales": "Normals",
    "Pose humana": "Human pose",
    "Segmentación": "Segmentation",
    "Cara (mesh)": "Face (mesh)",
    "Otros": "Other",
    "Usalo para:": "Use it for:",

    // Descripciones de familias (preproc.js)
    "Bordes nítidos (líneas blancas sobre negro). Máxima fidelidad de contorno.":
      "Sharp edges (white lines on black). Maximum contour fidelity.",
    "Bordes blandos y orgánicos (no binarios). Respeta texturas y transiciones.":
      "Soft, organic edges (not binary). Respects textures and transitions.",
    "Extrae el dibujo de líneas limpio (como entintado).":
      "Extracts the clean line drawing (like inking).",
    "Solo líneas rectas. Ignora curvas.":
      "Straight lines only. Ignores curves.",
    "Mapa de profundidad: claro = cerca, oscuro = lejos. Conserva volumen y disposición espacial, no los detalles.":
      "Depth map: light = near, dark = far. Keeps volume and spatial layout, not the details.",
    "Mapa de normales: orientación de cada superficie. Más relieve que depth.":
      "Normal map: orientation of each surface. More relief than depth.",
    "Detecta el esqueleto (articulaciones). Ignora ropa y fondo: solo la pose.":
      "Detects the skeleton (joints). Ignores clothing and background: just the pose.",
    "Divide la escena en regiones por tipo de objeto (cielo, persona, edificio…).":
      "Splits the scene into regions by object type (sky, person, building…).",
    "Conservan color, textura o composición tonal en vez de la forma.":
      "Keep color, texture or tonal composition instead of shape.",
    "Malla facial detallada (MediaPipe). Rasgos y expresión.":
      "Detailed facial mesh (MediaPipe). Features and expression.",
    "Preprocesadores menos comunes o utilitarios.":
      "Less common or utility preprocessors.",

    // "Usalo para" de cada familia
    "Objetos, arquitectura, lowpoly, cualquier cosa con formas definidas. Ajustás low/high threshold para más o menos detalle.":
      "Objects, architecture, lowpoly, anything with defined shapes. Adjust low/high threshold for more or less detail.",
    "Retratos, pelo, naturaleza, o cuando Canny queda muy rígido. Scribble = guía muy laxa, parte de un garabato.":
      "Portraits, hair, nature, or when Canny is too rigid. Scribble = very loose guidance, starts from a doodle.",
    "Ilustración, anime, cómic — cuando querés conservar el dibujo de líneas.":
      "Illustration, anime, comics — when you want to keep the line drawing.",
    "Interiores, edificios, geometría — donde importan las rectas.":
      "Interiors, buildings, geometry — where straight lines matter.",
    "Paisajes, escenas con primer plano/fondo, dar sensación 3D sin atarte a los bordes exactos. Depth Anything V2 es el mejor hoy.":
      "Landscapes, foreground/background scenes, a 3D feel without tying yourself to exact edges. Depth Anything V2 is the best today.",
    "Cuando querés conservar el relieve fino / iluminación de la referencia.":
      "When you want to keep the fine relief / lighting of the reference.",
    "Personajes en una pose específica sin copiar la apariencia. DWPose es el más preciso; AnimalPose para animales.":
      "Characters in a specific pose without copying the appearance. DWPose is the most precise; AnimalPose for animals.",
    "Escenas complejas donde querés controlar QUÉ va en cada zona.":
      "Complex scenes where you want to control WHAT goes in each area.",
    "Tile para upscale con detalle; Color/Palette para guiar la paleta; Shuffle para transferir estilo.":
      "Tile for detailed upscale; Color/Palette to guide the palette; Shuffle to transfer style.",
    "Retratos donde importa la expresión exacta.":
      "Portraits where the exact expression matters.",

    // Tags de familia
    "el más usado": "most used",
    "preciso": "precise",
    "para retratos": "for portraits",
    "suave": "soft",
    "ilustración / anime": "illustration / anime",
    "interiores / arquitectura": "interiors / architecture",
    "muy usado": "very used",
    "algunos lentos": "some slow",
    "relieve / 3D": "relief / 3D",
    "personajes": "characters",
    "escenas complejas": "complex scenes",
    "avanzado": "advanced",
    "estilo / upscale": "style / upscale",
    "retratos": "portraits",
  };

  // Reverse EN → ES (para volver a español)
  const EN_ES = {};
  for (const k in ES_EN) EN_ES[ES_EN[k]] = k;

  // ---- Elementos "ricos" (párrafos con <b>/<i>/<br>): se traduce el innerHTML
  //      entero, matcheando por textContent, para no romper el orden de palabras ----
  const RICH = [
    // section-desc: Constructor de prompt
    ["La \"máquina de prompts\" de la Clase 4: elegí un <b>estilo</b>, una <b>cámara/óptica</b> y <b>detalles</b>, y se arma un sufijo <b>en inglés</b> que se agrega al final de tu prompt. El profe dice que una buena máquina de prompts rinde más que un LoRA. Es 100% navegador: no toca el Colab.",
     "The Class 4 \"prompt machine\": pick a <b>style</b>, a <b>camera/optics</b> and <b>details</b>, and it builds an <b>English</b> suffix that gets appended to your prompt. The professor says a good prompt machine beats a LoRA. It's 100% browser: it doesn't touch Colab."],
    // section-desc: Editar imagen
    ["Subí una imagen y escribí qué cambiar (ej. <i>\"ponele pelo azul\"</i>, <i>\"cambiá el fondo a un bosque\"</i>) y devuelve una <b>imagen nueva editada</b>. Pensado para los estados de Elena. La 1ª vez tarda (carga el modelo Qwen-Image-Edit en el Colab). El resultado entra a la galería como una imagen más.",
     "Upload an image and write what to change (e.g. <i>\"make the hair blue\"</i>, <i>\"change the background to a forest\"</i>) and it returns a <b>new edited image</b>. Made for Elena's states. The first time is slow (it loads the Qwen-Image-Edit model on Colab). The result enters the gallery like any other image."],
    // section-desc: Restaurar
    ["Subí una foto (vieja, chica, con poco detalle) y la <b>agranda reconstruyendo detalle real</b> — no interpola píxeles como Topaz, repromptea con poco \"ruido\". Pensado para tu archivo de foto documental. El <b>Denoise</b> manda: 0.2 = fiel al original (restaurar/limpiar), alto = inventa. Usa el motor de imagen con la foto como base (img2img) + upscale.",
     "Upload a photo (old, small, low-detail) and it <b>enlarges it reconstructing real detail</b> — it doesn't interpolate pixels like Topaz, it re-prompts with little \"noise\". Made for your documentary photo archive. <b>Denoise</b> rules: 0.2 = faithful to the original (restore/clean), high = invents. It uses the image engine with the photo as a base (img2img) + upscale."],
    // restore sub-desc
    ["Zona 0.15–0.3 para fotos reales. <b>0.2 fiel ↔ alto inventa.</b>",
     "Zone 0.15–0.3 for real photos. <b>0.2 faithful ↔ high invents.</b>"],
    // section-desc: ¿Partís de una imagen? (ControlNet)
    ["Subí una imagen (una sola) y, abajo, elegí <b>qué hacer con ella</b>. Hay tres formas distintas:<br>🔎 <b>Describirla</b> (te arma el prompt, abajo)<br>🖼️ <b>Usarla de base</b> (img2img: variás/mejorás ESA imagen)<br>🎯 <b>Copiar su estructura</b> (ControlNet: pose/bordes/profundidad)<br>Si no subís nada, generás desde cero con el prompt.",
     "Upload an image (just one) and, below, choose <b>what to do with it</b>. There are three ways:<br>🔎 <b>Describe it</b> (builds the prompt, below)<br>🖼️ <b>Use as base</b> (img2img: vary/enhance THAT image)<br>🎯 <b>Copy its structure</b> (ControlNet: pose/edges/depth)<br>If you upload nothing, you generate from scratch with the prompt."],
    // section-desc: LoRA
    ["Un <b>LoRA</b> es un mini-modelo que le enseña a la IA <b>una cosa específica</b>: una cara (Elena), un estilo de dibujo, una paleta. Activá <b>\"Usar LoRA\"</b>, elegí uno del desplegable y ajustá la fuerza (0.7–0.9 normal). ¿No está en la lista? Pegá el link de Civitai abajo y se baja al Colab.",
     "A <b>LoRA</b> is a mini-model that teaches the AI <b>one specific thing</b>: a face (Elena), a drawing style, a palette. Turn on <b>\"Use LoRA\"</b>, pick one from the dropdown and adjust the strength (0.7–0.9 normal). Not in the list? Paste the Civitai link below and it downloads to Colab."],
    // section-desc: Describir imagen (Qwen-VL)
    ["Subí una imagen y un modelo de visión (Qwen3-VL) la describe y te arma un <b>prompt</b>. Sirve para copiar el estilo/contenido de una referencia. La 1ª vez tarda ~1-1½ min (carga el modelo 8B en el Colab). Es independiente: no activa ControlNet.",
     "Upload an image and a vision model (Qwen3-VL) describes it and builds a <b>prompt</b> for you. Useful to copy the style/content of a reference. The first time takes ~1-1½ min (loads the 8B model on Colab). It's independent: it doesn't enable ControlNet."],
    // section-desc: KSampler
    ["El corazón del proceso: convierte el texto en imagen muestreando ruido. <b>Steps</b> = cuántas iteraciones (Z-Image Turbo va con ~8). <b>CFG</b> = qué tanto obedece el prompt (Turbo usa 1; +1 quema). <b>Sampler/Scheduler</b> = el algoritmo (euler/simple es seguro). Los dropdowns se llenan solos con lo que tiene el backend. Con los defaults ya sale bien.",
     "The heart of the process: turns text into an image by sampling noise. <b>Steps</b> = how many iterations (Z-Image Turbo runs with ~8). <b>CFG</b> = how much it obeys the prompt (Turbo uses 1; +1 burns). <b>Sampler/Scheduler</b> = the algorithm (euler/simple is safe). The dropdowns fill from the backend. With the defaults it already comes out fine."],
    // section-desc: Upscale
    ["El último paso: agranda la imagen con un modelo de upscale. En <b>DIPLO Colab</b> el upscale es directo 2× (la salida final sale al doble del tamaño base; el \"Upscale model\" en Modelos avanzados es lo que aplica). Los campos de tamaño/resize de abajo solo cuentan en el DIPLO completo.",
     "The last step: enlarges the image with an upscale model. In <b>DIPLO Colab</b> the upscale is a direct 2× (the final output comes out at double the base size; the \"Upscale model\" under Advanced models is what applies). The size/resize fields below only count in the full DIPLO."],

    // Guía modal — pestaña Parámetros
    ["El <b>motor fino</b> del muestreo. Con los defaults ya sale bien; tocá esto solo si querés experimentar.",
     "The <b>fine engine</b> of sampling. With the defaults it already comes out fine; touch this only if you want to experiment."],
    ["Cuántas pasadas hace la IA para dibujar. <b>Más</b> = un poco más de detalle pero más lento; arriba de ~12 casi no cambia. <b>Menos</b> = imagen a medio terminar. Z-Image Turbo va fino con <b>8</b>.",
     "How many passes the AI makes to draw. <b>More</b> = a bit more detail but slower; above ~12 it barely changes. <b>Fewer</b> = a half-finished image. Z-Image Turbo runs great with <b>8</b>."],
    ["1 = sigue el prompt al pie. Subirlo lo hace \"más creativo\" en modelos normales, pero <b>en Z-Image Turbo pasar de 1 quema y distorsiona</b> la imagen. Dejalo en <b>1</b>. (Probalo en el panel: poné 8 y mirá.)",
     "1 = follows the prompt exactly. Raising it makes it \"more creative\" in normal models, but <b>in Z-Image Turbo going above 1 burns and distorts</b> the image. Leave it at <b>1</b>. (Try it in the panel: set 8 and look.)"],
    ["En txt2img (desde cero) dejalo en <b>1</b>. Solo importa en <b>img2img</b>: 0.3 mantiene casi toda la imagen de partida (útil para variar expresiones del mismo personaje), 0.6 cambia bastante.",
     "In txt2img (from scratch) leave it at <b>1</b>. It only matters in <b>img2img</b>: 0.3 keeps almost all of the starting image (useful to vary expressions of the same character), 0.6 changes a lot."],
    ["El número del que arranca el ruido. <b>-1</b> = una distinta cada vez (explorar). Si te gustó un resultado, <b>fijá ese número</b> y vas a poder reproducirlo y variarlo de a poco.",
     "The number the noise starts from. <b>-1</b> = a different one each time (explore). If you liked a result, <b>set that number</b> and you'll be able to reproduce it and vary it little by little."],
    ["<b>euler + simple</b> es la combinación segura y rápida. Otros (dpmpp_2m, karras…) dan matices de detalle. Si no sabés, no los toques.",
     "<b>euler + simple</b> is the safe, fast combo. Others (dpmpp_2m, karras…) give nuances of detail. If you're not sure, don't touch them."],

    // Guía modal — pestaña LoRA
    ["Un <b>LoRA</b> es un mini-modelo que le enseña a la IA <b>una cosa específica</b>: una cara (Elena), un estilo de dibujo, una paleta. Lo aplicás sobre el modelo base y a partir de ahí tus imágenes salen SIEMPRE con ese personaje o look.",
     "A <b>LoRA</b> is a mini-model that teaches the AI <b>one specific thing</b>: a face (Elena), a drawing style, a palette. You apply it on top of the base model and from then on your images ALWAYS come out with that character or look."],
    ["<b>¿Cuándo lo uso?</b> Cuando querés que tus imágenes tengan siempre la misma cara/trazo/paleta. Sin LoRA = caras y estilos genéricos; con LoRA = tu personaje recurrente, tu look de autor.",
     "<b>When do I use it?</b> When you want your images to always have the same face/line/palette. Without LoRA = generic faces and styles; with LoRA = your recurring character, your signature look."],
    ["Cuánto pesa el estilo. Zona buena: <b>0.7–0.9</b>. Arriba de ~1.2 el personaje se <b>\"fríe\"</b> (la imagen se rompe). En 0 no se nota.",
     "How much the style weighs. Good zone: <b>0.7–0.9</b>. Above ~1.2 the character <b>\"fries\"</b> (the image breaks). At 0 it shows nothing."],
    ["Pegá el link de descarga directa de <b>Civitai</b> en \"Agregar un LoRA por link\" y se baja al Colab solo; después aparece en el desplegable. <b>Tiene que ser compatible con Z-Image</b> (no SDXL/Flux).",
     "Paste the direct download link from <b>Civitai</b> into \"Add a LoRA by link\" and it downloads to Colab on its own; then it appears in the dropdown. <b>It must be Z-Image compatible</b> (not SDXL/Flux)."],
    ["<b>Límite de hoy:</b> un LoRA por vez. Todavía no se combinan estilo + personaje a la vez.",
     "<b>Current limit:</b> one LoRA at a time. Combining style + character at once isn't supported yet."],

    // Guía modal — pestaña ControlNet
    ["<b>ControlNet</b> hace que la imagen nueva respete la <b>estructura</b> de una foto tuya: sus bordes, su pose o su profundidad. No copia la imagen — copia su <i>esqueleto</i> y lo rellena con lo que pida tu prompt.",
     "<b>ControlNet</b> makes the new image respect the <b>structure</b> of one of your photos: its edges, its pose or its depth. It doesn't copy the image — it copies its <i>skeleton</i> and fills it with whatever your prompt asks for."],
    ["1) Subís una imagen → el ControlNet se activa solo. 2) Elegís un <b>preprocesador</b> (qué se extrae: bordes, pose, profundidad…). 3) La <b>vista previa</b> te muestra lo que \"ve\" la IA. 4) Generás: tu prompt se dibuja respetando esa estructura.",
     "1) You upload an image → ControlNet turns on by itself. 2) You pick a <b>preprocessor</b> (what gets extracted: edges, pose, depth…). 3) The <b>preview</b> shows you what the AI \"sees\". 4) You generate: your prompt is drawn respecting that structure."],
    ["<b>Ejemplos:</b> tu personaje en una <b>pose exacta</b> (DWPose), copiar el <b>contorno</b> de un edificio (Canny), mantener la <b>disposición 3D</b> de una escena (Depth).",
     "<b>Examples:</b> your character in an <b>exact pose</b> (DWPose), copy the <b>outline</b> of a building (Canny), keep the <b>3D layout</b> of a scene (Depth)."],
    ["· El <b>ControlNet strength</b> NO cambia la vista previa — solo se nota en el resultado final. La preview cambia con el <i>preprocesador</i>, los <i>thresholds</i> y la <i>resolución</i>.<br>· El cartel <b>[experimental]</b> asusta pero anda. Para los tipos de preprocesador, mirá la pestaña <b>Preprocesadores</b>.",
     "· <b>ControlNet strength</b> does NOT change the preview — it only shows in the final result. The preview changes with the <i>preprocessor</i>, the <i>thresholds</i> and the <i>resolution</i>.<br>· The <b>[experimental]</b> label is scary but it works. For the preprocessor types, see the <b>Preprocessors</b> tab."],

    // Guía preprocesadores (preproc.js): intro + tip
    ["El <b>preprocesador</b> extrae UNA característica de tu imagen de referencia (bordes, profundidad, pose…) y el ControlNet usa eso para guiar la generación. No copia la imagen: copia su <i>estructura</i>. En el desplegable cada preprocesador está <b>coloreado por familia</b> (mismos colores que acá). Elegí según QUÉ querés conservar de la referencia.",
     "The <b>preprocessor</b> extracts ONE feature from your reference image (edges, depth, pose…) and ControlNet uses that to guide the generation. It doesn't copy the image: it copies its <i>structure</i>. In the dropdown each preprocessor is <b>colored by family</b> (same colors as here). Choose based on WHAT you want to keep from the reference."],
    ["💡 <b>Tip:</b> ahora la <b>vista previa se actualiza sola</b> cuando cambiás de preprocesador (con una imagen subida). Así ves al toque qué extrae cada uno. El <b>ControlNet strength</b> NO cambia la vista previa — eso solo se nota en el resultado final.",
     "💡 <b>Tip:</b> the <b>preview now updates on its own</b> when you switch preprocessor (with an image uploaded). So you instantly see what each one extracts. <b>ControlNet strength</b> does NOT change the preview — that only shows in the final result."],
  ];
  // Clave insensible a espacios (los <br>/negritas cambian el espaciado del textContent)
  const stripNorm = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  const richEs = {}, richEn = {};
  RICH.forEach(([es, en]) => { richEs[stripNorm(es)] = en; richEn[stripNorm(en)] = es; });
  const RICH_SEL = '.section-desc, .guide-pane p, .guide-pane .qa, .modal-body .intro, .pp-card p, .pp-card .pp-use';

  function translateRich(root, toEn) {
    const map = toEn ? richEs : richEn;
    const doOne = (el) => {
      const k = (el.textContent || '').replace(/\s+/g, '');
      if (map[k] != null) el.innerHTML = map[k];
    };
    if (root.querySelectorAll) root.querySelectorAll(RICH_SEL).forEach(doOne);
    if (root.matches && root.matches(RICH_SEL)) doOne(root);
  }

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const ATTRS = ['data-tip', 'placeholder', 'title', 'alt'];

  let lang = 'es';

  function mapFor(target) { return target === 'en' ? ES_EN : EN_ES; }

  function translateTextNodes(root, dict) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n; while ((n = w.nextNode())) nodes.push(n);
    for (const node of nodes) {
      const raw = node.nodeValue;
      const key = norm(raw);
      if (!key) continue;
      const val = dict[key];
      if (val != null && val !== key) {
        // preservar espacios de los bordes
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        node.nodeValue = lead + val + trail;
      }
    }
  }

  function translateAttrs(root, dict) {
    const sel = ATTRS.map(a => '[' + a + ']').join(',');
    const els = root.querySelectorAll ? root.querySelectorAll(sel) : [];
    els.forEach(el => {
      ATTRS.forEach(a => {
        if (!el.hasAttribute(a)) return;
        const cur = el.getAttribute(a);
        const val = dict[norm(cur)];
        if (val != null && val !== norm(cur)) el.setAttribute(a, val);
      });
    });
  }

  function apply(root) {
    if (lang === 'es') return; // ES es el idioma fuente del HTML
    const dict = ES_EN;
    if (root.nodeType === 1) translateRich(root, true);
    translateTextNodes(root, dict);
    if (root.nodeType === 1) translateAttrs(root, dict);
  }

  // Cambio de idioma en caliente: traduce todo el body en la dirección pedida.
  function setLang(next) {
    if (next === lang) return;
    const dict = mapFor(next);
    translateRich(document.body, next === 'en');
    translateTextNodes(document.body, dict);
    translateAttrs(document.body, dict);
    // topbar / config viven fuera de body? no — todo está en body. document.title:
    lang = next;
    try { localStorage.setItem('cw-lang', next); } catch (e) {}
    document.documentElement.lang = next;
    updateToggleLabel();
  }

  // ---- Toggle en la topbar ----
  let toggleBtn;
  function updateToggleLabel() {
    if (toggleBtn) toggleBtn.textContent = lang === 'es' ? '🌐 EN' : '🌐 ES';
  }
  function injectToggle() {
    const bar = document.querySelector('.topbar-controls');
    if (!bar) return;
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'iconbtn';
    toggleBtn.id = 'langToggle';
    toggleBtn.title = 'Language / Idioma';
    toggleBtn.onclick = () => setLang(lang === 'es' ? 'en' : 'es');
    // insertar antes del engranaje de config si está
    const gear = document.getElementById('configGear');
    if (gear) bar.insertBefore(toggleBtn, gear); else bar.appendChild(toggleBtn);
    updateToggleLabel();
  }

  // ---- Popup de elección de idioma (primer arranque) ----
  function showChooser() {
    const ov = document.createElement('div');
    ov.id = 'langChooser';
    ov.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);';
    ov.innerHTML =
      '<div style="background:var(--surface,#1d2027);color:var(--text,#e6e8ec);border:1px solid var(--border,#2c313b);border-radius:14px;padding:28px 30px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
      '<div style="font-size:44px;font-weight:800;letter-spacing:-2px;line-height:1;margin-bottom:6px;">easy comfy</div>' +
      '<p style="color:var(--text-muted,#9aa1ad);margin:6px 0 20px;font-size:15px;">Elegí tu idioma · Choose your language</p>' +
      '<div style="display:flex;gap:10px;">' +
      '<button data-l="es" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border,#2c313b);background:var(--surface-2,#242832);color:inherit;font-size:15px;font-weight:600;cursor:pointer;">🇦🇷 Español</button>' +
      '<button data-l="en" style="flex:1;padding:13px;border-radius:10px;border:none;background:var(--accent,#8b7cf0);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">🇬🇧 English</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-l]');
      if (!b) return;
      const chosen = b.getAttribute('data-l');
      try { localStorage.setItem('cw-lang', chosen); } catch (err) {}
      if (chosen === 'en') setLang('en');
      ov.remove();
    });
  }

  // ---- MutationObserver: traducir lo que el JS inyecta después ----
  function watch() {
    const mo = new MutationObserver((muts) => {
      if (lang === 'es') return;
      for (const m of muts) {
        m.addedNodes.forEach((nd) => {
          if (nd.nodeType === 1) { apply(nd); }
          else if (nd.nodeType === 3) {
            const val = ES_EN[norm(nd.nodeValue)];
            if (val) nd.nodeValue = nd.nodeValue.replace(norm(nd.nodeValue), val);
          }
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem('cw-lang'); } catch (e) {}
    injectToggle();
    watch();
    if (saved === 'en') { setLang('en'); }
    else if (saved === 'es') { /* ya en ES */ }
    else { showChooser(); }   // primer arranque: preguntar
  }

  // exponer por si otro script quiere reaplicar / traducir un string (alerts)
  window.i18nApply = () => apply(document.body);
  window.i18nSetLang = setLang;
  window.i18nT = (s) => (lang === 'en' ? (ES_EN[norm(s)] || s) : s);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
