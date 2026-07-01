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

    // Guía modal
    "📖 Guía de easy comfy": "📖 easy comfy guide",
    "Preprocesadores": "Preprocessors",
    "Parámetros": "Parameters",
    "LoRA": "LoRA",
    "Qué es ControlNet": "What is ControlNet",
  };

  // Reverse EN → ES (para volver a español)
  const EN_ES = {};
  for (const k in ES_EN) EN_ES[ES_EN[k]] = k;

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
    translateTextNodes(root, dict);
    if (root.nodeType === 1) translateAttrs(root, dict);
  }

  // Cambio de idioma en caliente: traduce todo el body en la dirección pedida.
  function setLang(next) {
    if (next === lang) return;
    const dict = mapFor(next);
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

  // exponer por si otro script quiere reaplicar
  window.i18nApply = () => apply(document.body);
  window.i18nSetLang = setLang;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
