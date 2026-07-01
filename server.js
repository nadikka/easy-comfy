const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const socketIO = require('socket.io');
const { URL } = require('url');
const { buildZip } = require('./zipper');

const clientId = uuidv4();
const configPath = path.join(__dirname, 'config.json');

// Cargar configuración
function loadConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading config:', error);
        return { comfyUrl: 'http://localhost:8188', isRemote: false };
    }
}

// Guardar configuración
function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving config:', error);
        return false;
    }
}

let config = loadConfig();
let wsComfy = null;

// Función para obtener el protocolo HTTP correcto
function getHttpModule(url) {
    return url.startsWith('https') ? https : http;
}

// Función para parsear URL de ComfyUI
function parseComfyUrl(comfyUrl) {
    const url = new URL(comfyUrl);
    return {
        protocol: url.protocol.replace(':', ''),
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '8188'),
        baseUrl: comfyUrl.replace(/\/$/, '') // Remove trailing slash
    };
}

// Función para conectar a ComfyUI WebSocket
// Reconexión automática del WS con backoff exponencial (A2). El feed de progreso en
// vivo se cae cuando el túnel corta WS largos; la imagen igual sale por HTTP polling,
// pero esto recupera el progreso solo, sin intervención.
let wsReconnectTimer = null;
let wsReconnectDelay = 2000; // arranca en 2s, dobla hasta 30s
function scheduleWsReconnect() {
    if (wsReconnectTimer) return; // ya hay uno agendado (anti-acumulación)
    console.log(`↻ WS caído — reintento en ${wsReconnectDelay / 1000}s`);
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectToComfyUI();
    }, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
}

function connectToComfyUI() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (wsComfy) {
        try {
            // removeAllListeners: el cierre intencional del socket viejo NO debe disparar reconexión
            wsComfy.removeAllListeners();
            wsComfy.close();
        } catch (e) {
            console.error('Error closing previous WebSocket:', e);
        }
    }

    const parsedUrl = parseComfyUrl(config.comfyUrl);
    const wsProtocol = parsedUrl.protocol === 'https' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${parsedUrl.hostname}:${parsedUrl.port}/ws?clientId=${clientId}`;
    
    console.log(`Connecting to ComfyUI at: ${wsUrl}`);
    broadcastToClients({ type: 'connection_status', status: 'connecting', url: config.comfyUrl });
    
    wsComfy = new WebSocket(wsUrl);
    
    wsComfy.on('open', () => {
        console.log('✓ WebSocket connection established with ComfyUI');
        console.log(`✓ WebSocket ready state: ${wsComfy.readyState}`);
        wsReconnectDelay = 2000; // conexión OK → reseteo el backoff
        broadcastToClients({
            type: 'connection_status',
            status: 'connected',
            url: config.comfyUrl,
            message: 'Conectado exitosamente a ComfyUI'
        });
    });

    wsComfy.on('error', (error) => {
        const errorMsg = error.message || 'Error desconocido';
        console.error('✗ WebSocket error:', errorMsg);
        broadcastToClients({
            type: 'connection_status',
            status: 'error',
            url: config.comfyUrl,
            error: errorMsg,
            message: `Error al conectar a ComfyUI: ${errorMsg}`
        });
        scheduleWsReconnect();
    });

    wsComfy.on('close', (code, reason) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason || 'No reason'}`);
        broadcastToClients({
            type: 'connection_status',
            status: 'disconnected',
            url: config.comfyUrl,
            message: 'Desconectado de ComfyUI'
        });
        scheduleWsReconnect();
    });
    
    setupComfyWebSocketHandlers();
}

// Función para enviar mensajes a todos los clientes conectados
function broadcastToClients(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                console.error('Error broadcasting to client:', e);
            }
        }
    });
}

function setupComfyWebSocketHandlers() {
    wsComfy.on('message', async (data) => {
        const messageString = data.toString();
        console.log('WebSocket message received:', messageString);

        // A1: ComfyUI puede mandar frames binarios (previews) o no-JSON. Sin este
        // try/catch un solo frame raro tiraba una excepción no capturada y mataba el proceso.
        let message;
        try {
            message = JSON.parse(messageString);
        } catch (e) {
            console.log('(frame WS no-JSON, se ignora)');
            return;
        }

        // Manejar progreso de ejecución
        if (message.type === 'progress') {
            const value = message.data.value;
            const max = message.data.max;
            const percent = max ? Math.round((value / max) * 100) : 0;
            
            console.log(`Progress: ${value}/${max} (${percent}%)`);
            
            broadcastToClients({
                type: 'generation_progress',
                value: value,
                max: max,
                percent: percent,
                message: `⚙️ Generando: Step ${value}/${max}`
            });
        }
        
        // Manejar ejecución iniciada
        if (message.type === 'executing') {
            if (message.data.node) {
                console.log(`Executing node: ${message.data.node}`);
                broadcastToClients({
                    type: 'generation_status',
                    status: 'executing',
                    message: '🎨 ComfyUI procesando...'
                });
            }
        }

        if (message.type === 'executed') {
            const details = promptDetails[message.data.prompt_id];
            console.log(`Execution completed for prompt ID: ${message.data.prompt_id}, node: ${message.data.node}`);

            // Prompts marcados como 'polled' se resuelven por HTTP (pollHistoryAndEmit),
            // no por este handler WS — evita emitir la imagen dos veces.
            if (details && details.polled) {
                console.log('(prompt polled por HTTP, el handler WS lo ignora)');
                return;
            }

            // Anti-flicker: este workflow tiene varios nodos de salida (SaveImage/Preview).
            // Si conocemos el nodo final esperado, ignoramos el resto.
            if (details && details.outputNode && String(message.data.node) !== String(details.outputNode)) {
                console.log(`(nodo ${message.data.node} no es la salida final ${details.outputNode}, se ignora)`);
                return;
            }

            // Varios nodos emiten 'executed' (ShowText, PreviewImage, etc.) sin imagenes.
            // Solo procesamos los que efectivamente devuelven imagenes.
            const images = message.data.output && message.data.output.images;
            if (!images || images.length === 0) {
                console.log(`(sin imagenes en este nodo, se ignora)`);
                return;
            }
            console.log('Images:', images);

            for (const image of images) {
                const subfolder = '';
                const parsedUrl = parseComfyUrl(config.comfyUrl);
                const imageUrl = `${parsedUrl.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(image.type)}`;
                console.log('Downloading image from:', imageUrl);
                
                // Notificar que está descargando
                broadcastToClients({
                    type: 'generation_status',
                    status: 'downloading',
                    message: '📥 Descargando imagen desde ComfyUI...'
                });
                
                const filename = path.join(__dirname, 'public', 'imagenes', subfolder, image.filename);
                await downloadImage(imageUrl, filename, subfolder);
                console.log(`Downloaded image: ${filename}`);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        const imagePath = subfolder ? `/imagenes/${subfolder}/${image.filename}` : `/imagenes/${image.filename}`;
                        // Base configurable via env IMAGE_BASE_URL. Default = VPS (no rompe produccion).
                        // Para uso local: IMAGE_BASE_URL="http://localhost:8085"
                        const imageUrl = `${IMAGE_BASE_URL}${imagePath}`;
                        console.log(`📤 Sending image URL to client: ${imageUrl}`);
                        client.send(JSON.stringify({
                            type: 'image_generated',
                            url: imageUrl,
                            prompt: details ? details.prompt : ''
                        }));
                    }
                });
            }
        }
    });
}

const app = express();

// Configurar subpath para producción (cuando se accede desde /comfyweb)
const BASE_PATH = process.env.BASE_PATH || '';
const PUBLIC_URL = process.env.PUBLIC_URL || '';
// Base absoluta para las URLs de imagenes que se envian al cliente.
// Orden: env explicita > PUBLIC_URL (lo setea el VPS via ecosystem) > localhost.
// Asi corre en cualquier PC con solo "node server.js", sin setear nada.
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || process.env.PUBLIC_URL || 'http://localhost:8085';

app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '30mb' })); // 30mb para subir imágenes de referencia en base64

const port = 8085;
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`BASE_PATH: ${BASE_PATH}`);
    console.log(`PUBLIC_URL: ${PUBLIC_URL || '(not set - using relative paths)'}`);
});

const io = require('socket.io')(server);

const wss = new WebSocket.Server({ server });
const promptDetails = {};  // Almacena detalles del prompt

// Conectar a ComfyUI después de que el servidor esté listo
setTimeout(() => {
    connectToComfyUI();
}, 1000);

wss.on('connection', async (ws, req) => {
    console.log('WebSocket client connected');
    
    // Enviar estado actual de conexión al nuevo cliente
    if (wsComfy && wsComfy.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'connection_status',
            status: 'connected',
            url: config.comfyUrl,
            message: 'Conectado a ComfyUI'
        }));
    }
    
    ws.on('message', async (data) => {
        const message = JSON.parse(data);
        if (message.type === 'generarImagen') {
            console.log(`📥 Prompt received: ${message.prompt}`);
            console.log(`📊 Workflow: ${message.workflow || 'simple'}, Parámetros:`, message.params);
            
            // Notificar al cliente que se está procesando
            ws.send(JSON.stringify({
                type: 'generation_status',
                status: 'queued',
                message: '🔄 Prompt en cola para procesamiento'
            }));
            
            try {
                const params = message.params || {};
                const workflow = message.workflow || 'simple';

                // Proveedor serverless: fal.ai (Z-Image Turbo). No usa ComfyUI ni GPU local.
                // Se activa con PROVIDER=fal (env) o config.provider="fal".
                if ((process.env.PROVIDER || config.provider || 'comfyui') === 'fal') {
                    await generarImagenFal(message.prompt, params, ws);
                    return;
                }

                let result;
                if (workflow === 'diplo') {
                    result = await generarImagenDiplo(message.prompt, params);
                } else if (workflow === 'diplocolab') {
                    result = await generarImagenDiploColab(message.prompt, params);
                } else if (workflow === 'diplocolabcn') {
                    result = await generarImagenDiploColabCN(message.prompt, params);
                } else if (workflow === 'local') {
                    result = await generarImagenLocal(message.prompt, params);
                } else if (workflow === 'zimage') {
                    result = await generarImagenZImage(message.prompt, params);
                } else {
                    result = await generarImagen(message.prompt, params);
                }

                const promptId = result.promptId;
                // Guarda prompt, websocket y el nodo de salida final (para filtrar salidas intermedias)
                promptDetails[promptId] = { prompt: message.prompt, ws: ws, outputNode: result.outputNode, polled: !!result.polled };

                // Red de seguridad: si el flujo lo pide (result.polled), detectamos el fin
                // por HTTP /history en vez de por WS. Robusto ante caidas del WS del tunel.
                if (result.polled) {
                    pollHistoryAndEmit(promptId, ws, result.outputNode, message.prompt);
                }
                
                console.log(`✓ Prompt queued with ID: ${promptId}`);
                console.log(`🔍 WebSocket ComfyUI state: ${wsComfy ? wsComfy.readyState : 'null'} (1=OPEN, 0=CONNECTING, 2=CLOSING, 3=CLOSED)`);
                ws.send(JSON.stringify({
                    type: 'generation_status',
                    status: 'processing',
                    promptId: promptId,
                    message: '⚙️ ComfyUI está generando la imagen...'
                }));
            } catch (error) {
                console.error('❌ Error queuing prompt:', error);
                ws.send(JSON.stringify({
                    type: 'generation_status',
                    status: 'error',
                    message: '❌ Error al enviar prompt a ComfyUI: ' + error.message
                }));
            }
        }
    });
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

io.on('connection', function(socket) {
    console.log('SOCKET IO');
    socket.on('slider change', function(data) {
        console.log('Slider value received: ', data);
        socket.broadcast.emit('slider update', data);
    });
    socket.on('disconnect', function() {
        console.log('User disconnected');
    });
});

// API endpoints para configuración
app.get(BASE_PATH + '/api/config', (req, res) => {
    res.json(config);
});

// Ping HTTP real al ComfyUI configurado (via /system_stats). Confiable a traves del
// tunel (a diferencia del WebSocket, que los tuneles free suelen cortar). El frontend
// lo polea para mantener el indicador "vivo/caido" honesto y la URL siempre al dia.
app.get(BASE_PATH + '/api/ping', (req, res) => {
    let done = false;
    const finish = (alive, info, gpu, gpuTier, vramGB) => {
        if (done) return; done = true;
        res.json({ alive, url: config.comfyUrl, info: info || null, gpu: gpu || null, gpuTier: gpuTier || null, vramGB: vramGB || null });
    };
    try {
        const parsed = parseComfyUrl(config.comfyUrl);
        const httpModule = getHttpModule(config.comfyUrl);
        const r = httpModule.request({ hostname: parsed.hostname, port: parsed.port, path: '/system_stats', method: 'GET' }, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => {
                let ok = false, ver = null, gpu = null, tier = null, vramGB = null;
                try {
                    const j = JSON.parse(data);
                    ok = !!(j && j.system); ver = j.system && j.system.comfyui_version;
                    // A6: extraer la GPU. Es lo que decide si Qwen-Image-Edit hace OOM (T4) o no (L4).
                    const dev = (j.devices || [])[0];
                    if (dev) {
                        gpu = dev.name || null;
                        vramGB = dev.vram_total ? Math.round(dev.vram_total / 1e9) : null;
                        const n = (gpu || '').toUpperCase();
                        if (n.includes('T4')) tier = 'T4';
                        else if (n.includes('L4')) tier = 'L4';
                        else if (vramGB && vramGB >= 20) tier = 'big';   // A100/otras grandes
                        else if (vramGB) tier = 'small';
                    }
                } catch (e) {}
                finish(ok && resp.statusCode === 200, ver, gpu, tier, vramGB);
            });
        });
        r.setTimeout(12000, () => { r.destroy(); finish(false); });
        r.on('error', () => finish(false));
        r.end();
    } catch (e) { finish(false); }
});

// Sube una imagen de referencia (base64 desde el browser) al ComfyUI del Colab.
// Devuelve el nombre con que quedó en ComfyUI/input/ para usarlo en LoadImage.
app.post(BASE_PATH + '/api/upload-image', async (req, res) => {
    try {
        const { filename, dataUrl } = req.body || {};
        if (!dataUrl) return res.json({ success: false, error: 'falta dataUrl' });
        const m = /^data:.+?;base64,(.*)$/.exec(dataUrl);
        const b64 = m ? m[1] : dataUrl;
        const safe = (filename || `ref_${Date.now()}.png`).replace(/[^\w.\-]/g, '_');
        const tmp = path.join(__dirname, 'public', 'imagenes', '_upload_' + safe);
        fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
        const result = await uploadImage(tmp); // -> { name, subfolder, type }
        console.log(`📤 [upload-image] subida a ComfyUI: ${result && result.name}`);
        res.json({ success: true, name: result.name, subfolder: result.subfolder || '', info: result });
    } catch (e) {
        console.error('[upload-image] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Agrega un LoRA al Colab descargándolo por URL. Usa el mini-endpoint /leo/add_lora
// del custom node leo_lora_fetch que instala nuestro notebook. Devuelve el nombre guardado.
app.post(BASE_PATH + '/api/add-lora', async (req, res) => {
    try {
        const { url, filename } = req.body || {};
        if (!url) return res.json({ success: false, error: 'falta la URL del LoRA' });
        const parsed = parseComfyUrl(config.comfyUrl);
        const httpModule = getHttpModule(config.comfyUrl);
        const payload = JSON.stringify({ url, filename: filename || '' });
        const target = new URL(parsed.baseUrl + '/leo/add_lora');
        console.log(`🧩 [add-lora] pidiendo al Colab bajar: ${url}`);
        const out = await new Promise((resolve, reject) => {
            const r = httpModule.request(target, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                timeout: 600000 // descargas grandes
            }, (resp) => {
                let data = '';
                resp.on('data', c => data += c);
                resp.on('end', () => {
                    if (resp.statusCode === 404 || resp.statusCode === 405) {
                        return reject(new Error('El Colab todavía no tiene la función para agregar LoRAs (/leo/add_lora). Reiniciá el Colab con el notebook actualizado (Run all desde GitHub) y reconectá la URL.'));
                    }
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('El Colab respondió algo inesperado (¿reiniciaste con el notebook nuevo?): ' + data.slice(0, 120))); }
                });
            });
            r.on('error', reject);
            r.on('timeout', () => r.destroy(new Error('timeout descargando el LoRA')));
            r.write(payload);
            r.end();
        });
        if (out && out.success) {
            console.log(`🧩 [add-lora] OK en Colab: ${out.name}`);
            res.json({ success: true, name: out.name, path: out.path });
        } else {
            res.json({ success: false, error: (out && out.error) || 'fallo en el Colab' });
        }
    } catch (e) {
        console.error('[add-lora] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Corre SOLO el preprocesador sobre la imagen de referencia y devuelve la URL del
// resultado, para que el usuario VEA cómo procesa antes de generar (vista previa).
// ── Preprocesadores dedicados ──────────────────────────────────────────────
// Los 7 elegidos: cada uno es su PROPIO class_type (los mismos nombres que el
// dropdown del AIO), con sus parámetros propios y defaults. Para el resto de los
// ~40 preprocesadores se sigue usando el AIO_Preprocessor genérico.
const RICH_PREPROCS = {
    "CannyEdgePreprocessor":        { low_threshold: 100, high_threshold: 200 },
    "LineartStandardPreprocessor":  { guassian_sigma: 6.0, intensity_threshold: 8 },
    "DepthAnythingV2Preprocessor":  { ckpt_name: "depth_anything_v2_vitl.pth" },
    "MiDaS-NormalMapPreprocessor":  { a: 6.283185307179586, bg_threshold: 0.1 },
    "DWPreprocessor":               { detect_hand: "enable", detect_body: "enable", detect_face: "enable" },
    "HEDPreprocessor":              { safe: "enable" },
    "TTPlanet_TileGF_Preprocessor": { scale_factor: 1.0, blur_strength: 2.0, radius: 7, eps: 0.01 },
};

// Arma el nodo de preprocesado en wf[nodeId]: si 'preprocessor' es uno de los 7
// ricos, usa su class_type dedicado con sus params (de opts, o el default); si no,
// AIO_Preprocessor genérico. Preserva el link de 'image' que ya tenía el nodo.
function setPreprocessorNode(wf, nodeId, opts) {
    const name = opts.preprocessor || "CannyEdgePreprocessor";
    const prev = (wf[nodeId] && wf[nodeId].inputs) ? wf[nodeId].inputs : {};
    const imageLink = prev.image;
    const resolution = Number(opts.resolution) || 512;
    if (RICH_PREPROCS[name]) {
        const inputs = { image: imageLink, resolution };
        for (const [k, def] of Object.entries(RICH_PREPROCS[name])) {
            // la UI manda 'pp_<param>'; aceptamos también el nombre pelado por compat
            const v = (opts['pp_' + k] !== undefined) ? opts['pp_' + k] : opts[k];
            const empty = (v === undefined || v === null || v === '');
            inputs[k] = empty ? def : (typeof def === 'number' ? Number(v) : v);
        }
        wf[nodeId] = { inputs, class_type: name, _meta: { title: name } };
        console.log(`🎛️ [preproc] dedicado ${name}:`, inputs);
    } else {
        wf[nodeId] = { inputs: { image: imageLink, preprocessor: name, resolution }, class_type: "AIO_Preprocessor", _meta: { title: "AIO_Preprocessor" } };
        console.log(`🎛️ [preproc] AIO genérico: ${name}`);
    }
}

// ── Describir imagen → prompt (Qwen3-VL / SimpleQwenVLgguf) ──────────────────
// Sube/usa una imagen ya en el input del Colab, corre el nodo de visión y devuelve
// el prompt generado. Requiere que el Colab tenga instalado el nodo (notebook actualizado).
// OJO: esquema del nodo tomado de la doc — verificar/ajustar contra object_info la 1ª corrida.
const QWEN_LLM_DIR = '/content/drive/MyDrive/ComfyUI-Leo/models/LLM';
app.post(BASE_PATH + '/api/describe-image', async (req, res) => {
    try {
        const { image, user_prompt, system_prompt } = req.body || {};
        if (!image) return res.json({ success: false, error: 'falta image (subí una referencia primero)' });
        const wf = {
            "1": { inputs: { image }, class_type: "LoadImage", _meta: { title: "describe src" } },
            "2": {
                // Inputs EXACTOS del nodo SimpleQwenVLgguf (verificados via object_info, 2026-06-29).
                // El modelo se pasa por ruta de archivo (model_path/mmproj_path), no por dropdown.
                inputs: {
                    image: ["1", 0],
                    system_prompt: system_prompt || "You are a precise vision assistant. Describe the image as a detailed text-to-image prompt.",
                    user_prompt: user_prompt || "Describe this image as a detailed, comma-separated prompt for an image generator. Be specific about subject, style, colors, lighting and composition.",
                    model_path: `${QWEN_LLM_DIR}/Qwen3VL-8B-Instruct-Q4_K_M.gguf`,
                    mmproj_path: `${QWEN_LLM_DIR}/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf`,
                    output_max_tokens: 512,
                    image_max_tokens: 4096,
                    ctx: 8192,
                    n_batch: 512,
                    gpu_layers: -1,
                    temperature: 0.7,
                    seed: Math.floor(Math.random() * 1e15) + 1,
                    unload_all_models: true,   // libera VRAM (8B comparte la L4 con Z-Image)
                    top_p: 0.92,
                    repeat_penalty: 1.2,
                    top_k: 0,
                    pool_size: 4194304
                },
                class_type: "SimpleQwenVLgguf",
                _meta: { title: "Qwen3-VL describe" }
            },
            // Sink: ComfyUI no ejecuta el grafo sin un nodo de salida. PreviewAny consume el
            // texto y lo expone en /history (outputs[3].text). Verificado en vivo 2026-06-29.
            "3": { inputs: { source: ["2", 0] }, class_type: "PreviewAny", _meta: { title: "describe out" } }
        };
        console.log(`🔎 [describe-image] Qwen3-VL sobre ${image}`);
        const promptId = await queuePrompt(wf);
        // Polea /history y extrae el texto de la salida del nodo (defensivo: busca cualquier string)
        const text = await pollHistoryForText(promptId, "3");
        if (!text) return res.json({ success: false, error: 'el nodo no devolvió texto (¿está instalado SimpleQwenVLgguf? reiniciá el Colab con el notebook actualizado)' });
        res.json({ success: true, prompt: text });
    } catch (e) {
        console.error('[describe-image] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Polea /history hasta que el prompt termina y devuelve el primer texto que encuentre
// en la salida del nodo dado (los nodos VLM suelen exponer su texto en outputs[id].text/string).
async function pollHistoryForText(promptId, nodeId, timeoutMs = 180000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        await new Promise(r => setTimeout(r, 3000));
        let h;
        try { h = await getHistory(promptId); } catch { continue; }
        const entry = h && h[promptId];
        if (!entry) continue;
        const st = (entry.status || {}).status_str;
        if (st === 'error') throw new Error('ComfyUI devolvió error al describir la imagen');
        const outs = entry.outputs || {};
        const node = outs[nodeId] || {};
        // busca texto en las claves típicas, o cualquier array de strings
        for (const key of ['text', 'string', 'STRING', 'result', 'prompt']) {
            const v = node[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
            if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v.join('\n').trim();
        }
        // fallback: cualquier valor string/array-de-string en el nodo
        for (const v of Object.values(node)) {
            if (typeof v === 'string' && v.trim().length > 10) return v.trim();
            if (Array.isArray(v) && v.length && typeof v[0] === 'string' && v[0].length > 10) return v.join('\n').trim();
        }
        if (st === 'success' || entry.status?.completed) return null; // terminó pero sin texto reconocible
    }
    throw new Error('timeout describiendo la imagen');
}

// ── Editar imagen con instrucción → nueva imagen (Qwen-Image-Edit-2509) ───────
// Sube/usa una imagen ya en el input del Colab + una instrucción de texto ("ponele
// pelo azul") y devuelve la imagen editada. Pensado para los estados de Elena.
// Grafo NATIVO canónico de 2509: TextEncodeQwenImageEditPlus hace la magia (escala
// la imagen, se la da al text-encoder VL para que la "vea" y la codifica como
// reference_latent en una sola pasada). UNET GGUF vía city96 ComfyUI-GGUF.
// Schema verificado contra el código fuente local (comfy_extras/nodes_qwen.py,
// nodes_post_processing.py, nodes_model_advanced.py, nodes.py) 2026-06-29.
const QWEN_EDIT_UNET = 'Qwen-Image-Edit-2509-Q4_K_M.gguf';
const QWEN_EDIT_CLIP = 'qwen_2.5_vl_7b_fp8_scaled.safetensors';
const QWEN_EDIT_VAE  = 'qwen_image_vae.safetensors';
const QWEN_EDIT_LIGHTNING_LORA = 'Qwen-Image-Lightning-4steps-V1.0.safetensors';
app.post(BASE_PATH + '/api/edit-image', async (req, res) => {
    try {
        const { image, instruction, negative, steps, cfg, seed, fast } = req.body || {};
        if (!image) return res.json({ success: false, error: 'falta image (subí la imagen a editar)' });
        if (!instruction || !String(instruction).trim())
            return res.json({ success: false, error: 'falta la instrucción de edición (ej. "ponele pelo azul")' });

        const useFast = (fast !== false);                  // por defecto: LoRA Lightning (4 pasos, cfg 1)
        const realSteps = Number(steps) || (useFast ? 4 : 20);
        const realCfg = (cfg !== undefined && cfg !== null && cfg !== '') ? Number(cfg) : (useFast ? 1.0 : 2.5);
        const realSeed = (seed !== undefined && seed !== null && seed !== '')
            ? Number(seed) : (Math.floor(Math.random() * 1e15) + 1);
        const modelSrc = useFast ? ["6", 0] : ["3", 0];    // (LoRA) -> ModelSamplingAuraFlow

        // Pre-chequeo: si faltan nodos en el Colab, error claro y accionable (no críptico).
        const oi = await fetchObjectInfo().catch(() => null);
        if (oi) {
            const need = ["UnetLoaderGGUF", "CLIPLoader", "VAELoader", "ImageScaleToTotalPixels",
                "TextEncodeQwenImageEditPlus", "ModelSamplingAuraFlow", "KSampler", "VAEEncode",
                "VAEDecode", "SaveImage", "LoadImage"];
            if (useFast) need.push("LoraLoaderModelOnly");
            const missing = need.filter(n => !oi[n]);
            if (missing.length) return res.json({ success: false,
                error: `Faltan nodos en el Colab: ${missing.join(", ")}. Reiniciá el Colab con el notebook actualizado (ComfyUI-GGUF instalado).` });
        }

        // TextEncodeQwenImageEditPlus escala la imagen internamente y le pone el ref_latent;
        // el VAEEncode (nodo 9) sobre la imagen ya escalada a ~1MP define el TAMAÑO de salida
        // (denoise 1.0 ⇒ del latente inicial solo importa la forma).
        const wf = {
            "1":  { inputs: { image }, class_type: "LoadImage", _meta: { title: "edit src" } },
            "2":  { inputs: { image: ["1", 0], upscale_method: "nearest-exact", megapixels: 1.0, resolution_steps: 1 },
                    class_type: "ImageScaleToTotalPixels", _meta: { title: "scale 1MP" } },
            "3":  { inputs: { unet_name: QWEN_EDIT_UNET }, class_type: "UnetLoaderGGUF", _meta: { title: "Qwen-Edit UNET" } },
            "4":  { inputs: { clip_name: QWEN_EDIT_CLIP, type: "qwen_image" }, class_type: "CLIPLoader", _meta: { title: "qwen clip" } },
            "5":  { inputs: { vae_name: QWEN_EDIT_VAE }, class_type: "VAELoader", _meta: { title: "qwen vae" } },
            "7":  { inputs: { clip: ["4", 0], prompt: String(instruction), vae: ["5", 0], image1: ["1", 0] },
                    class_type: "TextEncodeQwenImageEditPlus", _meta: { title: "edit prompt (VL)" } },
            "8":  { inputs: { clip: ["4", 0], prompt: negative || "", vae: ["5", 0], image1: ["1", 0] },
                    class_type: "TextEncodeQwenImageEditPlus", _meta: { title: "negative (VL)" } },
            "9":  { inputs: { pixels: ["2", 0], vae: ["5", 0] }, class_type: "VAEEncode", _meta: { title: "size latent" } },
            "12": { inputs: { model: modelSrc, shift: 3.5 }, class_type: "ModelSamplingAuraFlow", _meta: { title: "shift" } },
            "13": { inputs: { model: ["12", 0], positive: ["7", 0], negative: ["8", 0], latent_image: ["9", 0],
                    seed: realSeed, steps: realSteps, cfg: realCfg, sampler_name: "euler", scheduler: "simple", denoise: 1.0 },
                    class_type: "KSampler", _meta: { title: "edit sampler" } },
            "14": { inputs: { samples: ["13", 0], vae: ["5", 0] }, class_type: "VAEDecode", _meta: { title: "decode" } },
            "15": { inputs: { images: ["14", 0], filename_prefix: "qwen-edit" }, class_type: "SaveImage", _meta: { title: "save" } }
        };
        if (useFast) {
            wf["6"] = { inputs: { model: ["3", 0], lora_name: QWEN_EDIT_LIGHTNING_LORA, strength_model: 1.0 },
                        class_type: "LoraLoaderModelOnly", _meta: { title: "lightning 4step" } };
        }

        console.log(`✏️ [edit-image] Qwen-Image-Edit sobre ${image} | "${String(instruction).slice(0, 60)}" | fast=${useFast} steps=${realSteps} cfg=${realCfg}`);
        const out = await queuePollDownload(wf, "15", 240); // ~12 min: la 1ª carga del modelo de edit es lenta
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[edit-image] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

app.post(BASE_PATH + '/api/preprocess-preview', async (req, res) => {
    try {
        const { image, preprocessor, resolution, scale_by } = req.body || {};
        if (!image) return res.json({ success: false, error: 'falta image (subí una referencia primero)' });
        const wf = await readWorkflowPreprocess();
        setIn(wf, "1", "image", image);
        setIn(wf, "2", "scale_by", Number(scale_by) || 1.0);
        // Nodo 3 = preprocesador (dedicado si es uno de los 7, AIO si no)
        setPreprocessorNode(wf, "3", req.body || {});
        console.log(`🔍 [preprocess-preview] ${preprocessor} res=${resolution} scale=${scale_by} sobre ${image}`);
        const out = await queuePollDownload(wf, "4");
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[preprocess-preview] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Lista de preprocesadores disponibles en el AIO_Preprocessor del backend
app.get(BASE_PATH + '/api/preprocessors', async (req, res) => {
    try {
        const oi = await fetchObjectInfo();
        const node = oi.AIO_Preprocessor;
        const opt = node && node.input && (node.input.optional || {});
        const list = (opt && opt.preprocessor && Array.isArray(opt.preprocessor[0])) ? opt.preprocessor[0] : [];
        res.json({ success: true, preprocessors: list });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Endpoint para obtener modelos disponibles
app.get(BASE_PATH + '/api/models', async (req, res) => {
    try {
        const parsedUrl = parseComfyUrl(config.comfyUrl);
        const httpModule = getHttpModule(config.comfyUrl);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/object_info',
            method: 'GET'
        };
        
        const request = httpModule.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                try {
                    const objectInfo = JSON.parse(data);
                    // Usa el helper defensivo (maneja formato viejo y ComfyUI 0.26+ ["COMBO",{options}]).
                    // Z-Image carga por UNETLoader, no por CheckpointLoaderSimple -> fallback a diffusion models.
                    let models = extractList(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name');
                    if (!models.length) models = extractList(objectInfo, 'UNETLoader', 'unet_name');
                    if (models.length) {
                        res.json({ success: true, models });
                    } else {
                        res.json({ success: false, error: 'No se pudo obtener la lista de modelos' });
                    }
                } catch (e) {
                    res.json({ success: false, error: 'Error al parsear respuesta: ' + e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            res.json({ success: false, error: error.message });
        });
        
        request.end();
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Helper: trae /object_info de ComfyUI como objeto
function fetchObjectInfo() {
    return new Promise((resolve, reject) => {
        const parsedUrl = parseComfyUrl(config.comfyUrl);
        const httpModule = getHttpModule(config.comfyUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/object_info',
            method: 'GET'
        };
        const request = httpModule.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        request.on('error', reject);
        request.end();
    });
}

// Helper: extrae la lista de archivos de un loader de forma defensiva
function extractList(objectInfo, nodeClass, field) {
    try {
        const node = objectInfo[nodeClass];
        const req = node && node.input && (node.input.required || {});
        const opt = node && node.input && (node.input.optional || {});
        const entry = (req && req[field]) || (opt && opt[field]);
        if (!entry) return [];
        // Formato viejo: entry[0] es directamente la lista de opciones.
        if (Array.isArray(entry[0])) return entry[0];
        // Formato nuevo (ComfyUI 0.26+): ["COMBO", { options: [...] }].
        if (entry[0] === 'COMBO' && entry[1] && Array.isArray(entry[1].options)) return entry[1].options;
    } catch (e) { /* nodo no instalado */ }
    return [];
}

// Endpoint: devuelve todas las listas de modelos para los dropdowns de DIPLO
app.get(BASE_PATH + '/api/object-info', async (req, res) => {
    try {
        const oi = await fetchObjectInfo();
        res.json({
            success: true,
            options: {
                ckpt_name:         extractList(oi, 'CheckpointLoaderSimple', 'ckpt_name'),
                unet_name:         extractList(oi, 'UNETLoader', 'unet_name'),
                vae_name:          extractList(oi, 'VAELoader', 'vae_name'),
                // El CLIP es .safetensors -> CLIPLoader core (no GGUF). Fallback a GGUF por compat.
                clip_name:         extractList(oi, 'CLIPLoader', 'clip_name').length
                                     ? extractList(oi, 'CLIPLoader', 'clip_name')
                                     : extractList(oi, 'CLIPLoaderGGUF', 'clip_name'),
                lora_name:         extractList(oi, 'LoraLoader', 'lora_name'),
                upscale_model_name: extractList(oi, 'UpscaleModelLoader', 'model_name'),
                model_patch_name:  extractList(oi, 'ModelPatchLoader', 'model_patch_name'),
                // Listas para los selects de sampler/scheduler (del KSampler core)
                sampler_name:      extractList(oi, 'KSampler', 'sampler_name'),
                scheduler:         extractList(oi, 'KSampler', 'scheduler')
            }
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Lista las imagenes GENERADAS (no los mapas del preprocesador, que son previews intermedios).
// Los previews del preprocesador se guardan con prefijo 'preprocess_preview' y NO son output final.
function listGeneratedImages() {
    const dir = path.join(__dirname, 'public', 'imagenes');
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    return names
        .filter(n => /\.(png|jpe?g|webp)$/i.test(n))
        .filter(n => !/^preprocess_preview/i.test(n))   // excluye los mapas del preprocesador
        .filter(n => {
            try { return fs.statSync(path.join(dir, n)).isFile(); } catch (e) { return false; }
        });
}

// Endpoint: devuelve la lista de imagenes generadas (para reconstruir la galeria al recargar).
app.get(BASE_PATH + '/api/images', (req, res) => {
    const files = listGeneratedImages()
        .map(n => ({ name: n, url: `${IMAGE_BASE_URL}/imagenes/${n}`, mtime: (() => {
            try { return fs.statSync(path.join(__dirname, 'public', 'imagenes', n)).mtimeMs; } catch (e) { return 0; }
        })() }))
        .sort((a, b) => a.mtime - b.mtime);
    res.json({ success: true, images: files });
});

// Endpoint: zipea TODAS las imagenes generadas y las manda como descarga.
app.get(BASE_PATH + '/api/download-all', (req, res) => {
    try {
        const dir = path.join(__dirname, 'public', 'imagenes');
        const names = listGeneratedImages();
        if (!names.length) {
            return res.status(404).json({ success: false, error: 'No hay imagenes generadas todavia.' });
        }
        const files = names.map(n => ({ name: n, data: fs.readFileSync(path.join(dir, n)) }));
        const zip = buildZip(files);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="comfyweb-imagenes-${stamp}.zip"`);
        res.setHeader('Content-Length', zip.length);
        res.end(zip);
        console.log(`📦 Descarga ZIP: ${names.length} imagenes (${zip.length} bytes)`);
    } catch (e) {
        console.error('[download-all] error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Endpoint para listar workflows disponibles
app.get(BASE_PATH + '/api/workflows', (req, res) => {
    const workflows = Object.entries(WORKFLOWS).map(([key, wf]) => ({
        id: key,
        name: wf.name,
        description: wf.description
    }));
    res.json({ success: true, workflows });
});

app.post(BASE_PATH + '/api/config', (req, res) => {
    const newConfig = req.body;
    if (!newConfig.comfyUrl) {
        return res.status(400).json({ error: 'comfyUrl is required' });
    }
    
    config = newConfig;
    if (saveConfig(config)) {
        // Reconectar con la nueva configuración
        connectToComfyUI();
        res.json({ success: true, config });
    } else {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

async function readWorkflowAPI() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_api.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowDiplo() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_diplo.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowLocal() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_local.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowZImage() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_zimage.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowDiploColab() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_diplo_colab.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowDiploColabCN() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_diplo_colab_cn.json'), 'utf8');
    return JSON.parse(data);
}

async function readWorkflowPreprocess() {
    const data = await fs.promises.readFile(path.join(__dirname, 'workflow_preprocess.json'), 'utf8');
    return JSON.parse(data);
}

// Helper defensivo: setea un input SOLO si el nodo existe en el workflow.
// Evita el crash "Cannot set properties of undefined" cuando un workflow
// no tiene cierto nodo (p.ej. la version Colab sin LoRA/ControlNet).
function setIn(wf, id, key, val) {
    if (wf[id] && wf[id].inputs) wf[id].inputs[key] = val;
}

// Lista de workflows disponibles con sus parametros
const WORKFLOWS = {
    simple: {
        file: 'workflow_api.json',
        name: 'Simple txt2img',
        description: 'Generacion basica texto-a-imagen con KSampler',
        readFn: readWorkflowAPI
    },
    diplo: {
        file: 'workflow_diplo.json',
        name: 'DIPLO LowPoly + Tiled Upscale',
        description: 'Z-Image-Turbo + LoRA LowPoly + ControlNet + Tile Refine + Upscale',
        readFn: readWorkflowDiplo
    },
    // Modo LOCAL: Z-Image Turbo GGUF Q5 (validado en GPU AMD/ZLUDA). txt2img puro,
    // sin LoRA/ControlNet/tile. Usa los mismos campos que 'simple' (prompt/steps/dims/seed).
    local: {
        file: 'workflow_local.json',
        name: 'Z-Image GGUF (local AMD/ZLUDA)',
        description: 'Z-Image-Turbo Q5 GGUF, txt2img directo — corre en la GPU local',
        readFn: readWorkflowLocal
    },
    // Modo ZIMAGE: Z-Image Turbo fp8 en Colab/NVIDIA. Solo nodos core + modelos
    // presentes en el Colab (validado 2026-06-19). Usa campos del panel 'simple'.
    zimage: {
        file: 'workflow_zimage.json',
        name: 'Z-Image (Colab)',
        description: 'Z-Image-Turbo fp8 en Colab — txt2img directo, sin custom nodes',
        readFn: readWorkflowZImage
    },
    // Modo DIPLO-COLAB: Z-Image Turbo fp8 + upscale 2x (AnimeSharp), validado
    // end-to-end en Colab/NVIDIA (2026-06-25). Ruta robusta sin LoRA/ControlNet/tile
    // (esos assets no estan en este Colab; el estilo lowpoly ya sale del modelo+prompt).
    // Salida final = nodo 86 (upscale). Expone todos los params aplicables.
    diplocolab: {
        file: 'workflow_diplo_colab.json',
        name: 'DIPLO Colab (Z-Image + Upscale 2x)',
        description: 'Z-Image-Turbo fp8 + upscale 2x AnimeSharp — corre en Colab, alta resolucion',
        readFn: readWorkflowDiploColab
    },
    // Igual que diplocolab pero con ControlNet experimental: imagen de referencia ->
    // ImageScaleBy -> AIO_Preprocessor -> QwenImageDiffsynthControlnet (+ModelPatchLoader).
    // El frontend lo activa con el toggle "Usar ControlNet" en el modo DIPLO Colab.
    diplocolabcn: {
        file: 'workflow_diplo_colab_cn.json',
        name: 'DIPLO Colab + ControlNet',
        description: 'Z-Image-Turbo fp8 + ControlNet (preprocesador sobre imagen de referencia) + upscale 2x',
        readFn: readWorkflowDiploColabCN
    }
};

async function uploadImage(filePath) {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(filePath));

    const parsedUrl = parseComfyUrl(config.comfyUrl);
    const httpModule = getHttpModule(config.comfyUrl);
    
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: '/upload/image',
        method: 'POST',
        headers: formData.getHeaders()
    };

    return new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                // El backend (Colab) puede devolver HTML de error (502/530) si el túnel
                // está caído → NO romper el proceso parseando como JSON.
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`backend respondió HTTP ${res.statusCode} (¿Colab caído? Cloudflare 502/530). Reiniciá/reconectá el Colab.`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        formData.pipe(req);
    });
}

async function queuePrompt(promptWorkflow) {
    const postData = JSON.stringify({ prompt: promptWorkflow, client_id: clientId });
    const parsedUrl = parseComfyUrl(config.comfyUrl);
    const httpModule = getHttpModule(config.comfyUrl);
    
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: '/prompt',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (!j.prompt_id) return reject(new Error('el backend rechazó el workflow: ' + (data || '').slice(0, 300)));
                    resolve(j.prompt_id);
                } catch (e) {
                    reject(new Error(`backend respondió HTTP ${res.statusCode} no-JSON (¿Colab caído? Cloudflare 502/530). Reiniciá/reconectá el Colab.`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

async function getHistory(promptId) {
    const parsedUrl = parseComfyUrl(config.comfyUrl);
    const httpModule = getHttpModule(config.comfyUrl);
    const url = `${parsedUrl.baseUrl}/history/${promptId}`;
    
    return new Promise((resolve, reject) => {
        httpModule.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`backend respondió HTTP ${res.statusCode} no-JSON al pedir history (¿Colab caído?)`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Red de seguridad por HTTP: cuando el WS a ComfyUI se cae (los tuneles free son
// inestables con WebSocket), poleamos /history hasta que el prompt termine, bajamos
// la imagen del nodo de salida y la emitimos con el MISMO mensaje 'image_generated'
// que escucha el frontend. Funciona aunque el WS de ComfyUI este muerto.
async function pollHistoryAndEmit(promptId, ws, outputNode, promptText) {
    const intervalMs = 5000;
    const maxTries = 150; // ~12.5 min (cubre cold-start)
    const sendSafe = (obj) => { try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch (e) {} };

    for (let i = 0; i < maxTries; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        let hist;
        try { hist = await getHistory(promptId); } catch (e) { continue; }
        const entry = hist && hist[promptId];
        if (!entry) continue;

        const status = entry.status || {};
        const outputs = entry.outputs || {};

        // Imagenes del nodo de salida preferido; si no, el primer nodo que tenga.
        let imgs = (outputs[outputNode] && outputs[outputNode].images) || null;
        if (!imgs) {
            for (const k of Object.keys(outputs)) {
                if (outputs[k].images && outputs[k].images.length) { imgs = outputs[k].images; break; }
            }
        }

        if ((status.completed || status.status_str === 'success') && imgs && imgs.length) {
            const parsed = parseComfyUrl(config.comfyUrl);
            sendSafe({ type: 'generation_status', status: 'downloading', message: '📥 Descargando imagen(es) desde Colab...' });
            // Emite TODAS las imagenes del batch (antes solo la ultima) para verlas en la galeria.
            for (const image of imgs) {
                const subfolder = image.subfolder || '';
                const srcUrl = `${parsed.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(image.type)}`;
                const filename = path.join(__dirname, 'public', 'imagenes', image.filename);
                try {
                    await downloadImage(srcUrl, filename, '');
                } catch (e) {
                    console.error('[poll] error bajando imagen:', e.message);
                    sendSafe({ type: 'generation_status', status: 'error', message: '❌ Error bajando la imagen: ' + e.message });
                    return;
                }
                const outUrl = `${IMAGE_BASE_URL}/imagenes/${image.filename}`;
                sendSafe({ type: 'image_generated', url: outUrl, prompt: promptText });
                console.log(`📤 [poll] Imagen emitida al cliente: ${outUrl}`);
            }
            return;
        }

        if (status.status_str === 'error') {
            console.error('[poll] ComfyUI reporto error para', promptId);
            sendSafe({ type: 'generation_status', status: 'error', message: '❌ ComfyUI reporto un error en la generacion' });
            return;
        }
    }
    console.warn('[poll] timeout esperando', promptId);
    sendSafe({ type: 'generation_status', status: 'error', message: '⌛ Timeout esperando la imagen de Colab' });
}

// Encola un workflow, polea /history y baja la imagen del outputNode a public/imagenes.
// Devuelve { filename, url } servible por el browser. Para flujos SINCRONICOS (preview
// del preprocesador) que responden por HTTP, no por WS.
async function queuePollDownload(wf, outputNode, maxTries = 100) {
    const promptId = await queuePrompt(wf);
    const intervalMs = 3000; // maxTries=100 ≈ 5 min (default); más para cargas pesadas (Qwen-Image-Edit)
    for (let i = 0; i < maxTries; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        let hist;
        try { hist = await getHistory(promptId); } catch (e) { continue; }
        const entry = hist && hist[promptId];
        if (!entry) continue;
        const status = entry.status || {};
        const outputs = entry.outputs || {};
        let imgs = (outputs[outputNode] && outputs[outputNode].images) || null;
        if (!imgs) for (const k of Object.keys(outputs)) { if (outputs[k].images && outputs[k].images.length) { imgs = outputs[k].images; break; } }
        if ((status.completed || status.status_str === 'success') && imgs && imgs.length) {
            const image = imgs[imgs.length - 1];
            const parsed = parseComfyUrl(config.comfyUrl);
            const sub = image.subfolder || '';
            const src = `${parsed.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(sub)}&type=${encodeURIComponent(image.type)}`;
            const dest = path.join(__dirname, 'public', 'imagenes', image.filename);
            await downloadImage(src, dest, '');
            return { filename: image.filename, url: `${IMAGE_BASE_URL}/imagenes/${image.filename}` };
        }
        if (status.status_str === 'error') throw new Error('ComfyUI reportó error en el workflow');
    }
    throw new Error('Timeout esperando el resultado');
}

async function downloadImage(url, filename, subfolder) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(filename);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const filePath = filename;
        const file = fs.createWriteStream(filePath);
        const httpModule = getHttpModule(url);
        
        httpModule.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => reject(err));
        });
    });
}
// ============================================================
//  PROVEEDOR SERVERLESS: fal.ai (Z-Image Turbo)
//  No usa GPU local ni ComfyUI. Llama al API de fal, descarga
//  la imagen y la emite con el MISMO mensaje 'image_generated'
//  que ya escucha el frontend.
// ============================================================

// POST sincronico al API de fal. Devuelve el JSON de resultado.
function falGenerate(input) {
    return new Promise((resolve, reject) => {
        const FAL_KEY = process.env.FAL_KEY || '';
        if (!FAL_KEY) {
            return reject(new Error('Falta FAL_KEY. Conseguí una en https://fal.ai/dashboard/keys y ponela en el launcher comfyfal.bat'));
        }
        const model = process.env.FAL_MODEL || config.falModel || 'fal-ai/z-image/turbo';
        const body = JSON.stringify(input);
        const options = {
            hostname: 'fal.run',
            path: '/' + model,
            method: 'POST',
            headers: {
                'Authorization': 'Key ' + FAL_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('Respuesta de fal no es JSON: ' + data.slice(0, 200))); }
                } else {
                    reject(new Error(`fal HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Orquesta una generacion via fal y emite el resultado al cliente.
async function generarImagenFal(promptText, params = {}, ws) {
    const width = params.width || 1024;
    const height = params.height || 640;
    const steps = params.steps || 8;

    const input = {
        prompt: promptText,
        image_size: { width, height },
        num_inference_steps: steps,
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false
    };
    if (params.seed) input.seed = Number(params.seed);

    console.log(`🎨 [fal] Generando:`, { promptText: promptText.slice(0, 60) + '...', width, height, steps, seed: input.seed });

    ws.send(JSON.stringify({
        type: 'generation_status',
        status: 'processing',
        message: '⚙️ Generando en fal.ai (Z-Image Turbo)...'
    }));

    const result = await falGenerate(input);
    const img = result && result.images && result.images[0];
    if (!img || !img.url) {
        throw new Error('fal no devolvió ninguna imagen: ' + JSON.stringify(result).slice(0, 200));
    }

    ws.send(JSON.stringify({
        type: 'generation_status',
        status: 'downloading',
        message: '📥 Descargando imagen de fal...'
    }));

    // Nombre de archivo unico (no hay filename de ComfyUI).
    const fname = `fal_${Date.now()}_${Math.floor(Math.random() * 1e6)}.png`;
    const filename = path.join(__dirname, 'public', 'imagenes', fname);
    await downloadImage(img.url, filename, '');
    console.log(`✓ [fal] Imagen descargada: ${filename}`);

    const imageUrl = `${IMAGE_BASE_URL}/imagenes/${fname}`;
    ws.send(JSON.stringify({
        type: 'image_generated',
        url: imageUrl,
        prompt: promptText
    }));
    console.log(`📤 [fal] URL enviada al cliente: ${imageUrl}`);
}

// Función para validar si un modelo existe
async function validateModel(modelName) {
    try {
        const parsedUrl = parseComfyUrl(config.comfyUrl);
        const httpModule = getHttpModule(config.comfyUrl);
        
        return new Promise((resolve) => {
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: '/object_info',
                method: 'GET'
            };
            
            const request = httpModule.request(options, (response) => {
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });
                response.on('end', () => {
                    try {
                        const objectInfo = JSON.parse(data);
                        const checkpointLoader = objectInfo.CheckpointLoaderSimple;
                        if (checkpointLoader && checkpointLoader.input && checkpointLoader.input.required) {
                            const models = checkpointLoader.input.required.ckpt_name[0];
                            const exists = models.includes(modelName);
                            resolve({ exists, availableModels: models });
                        } else {
                            resolve({ exists: false, availableModels: [] });
                        }
                    } catch (e) {
                        resolve({ exists: false, availableModels: [] });
                    }
                });
            });
            
            request.on('error', () => {
                resolve({ exists: false, availableModels: [] });
            });
            
            request.end();
        });
    } catch (error) {
        return { exists: false, availableModels: [] };
    }
}

async function generarImagen(promptText, params = {}) {
    const promptWorkflow = await readWorkflowAPI();
    
    // Parámetros por defecto
    const steps = params.steps || 6;
    const width = params.width || 512;
    const height = params.height || 512;
    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;
    const model = params.model || 'realvisxl.safetensors';
    
    console.log(`🎨 Generando imagen con parámetros:`, { promptText, steps, width, height, seed, model });
    
    // Validar si el modelo existe
    const modelValidation = await validateModel(model);
    if (!modelValidation.exists) {
        console.error(`❌ Modelo "${model}" no encontrado en ComfyUI`);
        console.log(`📋 Modelos disponibles:`, modelValidation.availableModels.slice(0, 5).join(', '));
        
        // Notificar al cliente
        broadcastToClients({
            type: 'generation_status',
            status: 'error',
            message: `❌ Modelo "${model}" no encontrado. Usando modelo por defecto.`
        });
        
        // Usar el primer modelo disponible como fallback
        if (modelValidation.availableModels.length > 0) {
            promptWorkflow["4"]["inputs"]["ckpt_name"] = modelValidation.availableModels[0];
            console.log(`✓ Usando modelo fallback: ${modelValidation.availableModels[0]}`);
        }
    } else {
        console.log(`✓ Modelo "${model}" encontrado`);
        promptWorkflow["4"]["inputs"]["ckpt_name"] = model;
        
        broadcastToClients({
            type: 'generation_status',
            status: 'info',
            message: `✓ Usando modelo: ${model}`
        });
    }
    
    // Configurar parámetros del workflow
    promptWorkflow["6"]["inputs"]["text"] = promptText;
    promptWorkflow["7"]["inputs"]["text"] = params.negative_prompt || "text, watermark";
    promptWorkflow["3"]["inputs"]["seed"] = seed;
    promptWorkflow["3"]["inputs"]["steps"] = steps;
    promptWorkflow["5"]["inputs"]["width"] = width;
    promptWorkflow["5"]["inputs"]["height"] = height;
    promptWorkflow["5"]["inputs"]["batch_size"] = 1;
    promptWorkflow["9"]["inputs"]["filename_prefix"] = "ComfyUI";

    const promptId = await queuePrompt(promptWorkflow);

    console.log(`✓ Prompt en cola con ID: ${promptId}`);
    // outputNode: nodo SaveImage final, para filtrar el resto de salidas (PreviewImage, etc.)
    return { promptId, outputNode: "9" };
}

// Workflow LOCAL: Z-Image Turbo GGUF Q5 (txt2img puro en GPU AMD/ZLUDA).
// Nodos: 3=KSampler, 6=prompt+, 7=prompt-, 13=EmptySD3LatentImage, 9=SaveImage.
async function generarImagenLocal(promptText, params = {}) {
    const promptWorkflow = await readWorkflowLocal();

    const steps = params.steps || 8;
    const width = params.width || 1024;
    const height = params.height || 640;
    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;

    console.log(`🎨 [LOCAL] Z-Image GGUF:`, { prompt: promptText.substring(0, 60) + '...', steps, width, height, seed });

    // Prompts
    promptWorkflow["6"]["inputs"]["text"] = promptText;
    promptWorkflow["7"]["inputs"]["text"] = params.negative_prompt || "blurry, ugly, low quality, text, watermark";
    // KSampler
    promptWorkflow["3"]["inputs"]["seed"] = seed;
    promptWorkflow["3"]["inputs"]["steps"] = steps;
    // Dimensiones
    promptWorkflow["13"]["inputs"]["width"] = width;
    promptWorkflow["13"]["inputs"]["height"] = height;
    promptWorkflow["13"]["inputs"]["batch_size"] = 1;

    const promptId = await queuePrompt(promptWorkflow);
    console.log(`✓ [LOCAL] Prompt en cola con ID: ${promptId}`);
    return { promptId, outputNode: "9" };
}

// Workflow ZIMAGE: Z-Image Turbo en Colab/NVIDIA (txt2img puro, fp8).
// Usa SOLO nodos core + los modelos que SI estan en el Colab (validado 2026-06-19):
// UNETLoader(10) -> CLIPLoader lumina2(11) -> CLIPTextEncode(6/7) -> EmptySD3LatentImage(13)
// -> KSampler(3) -> VAEDecode(8) -> SaveImage(9). Sin LoRA/ControlNet/tile (esos faltan en Colab).
async function generarImagenZImage(promptText, params = {}) {
    const promptWorkflow = await readWorkflowZImage();

    const steps = params.steps || 8;
    const width = params.width || 1024;
    const height = params.height || 640;
    const cfg = params.cfg || 1.0;
    const sampler_name = params.sampler_name || "euler";
    const scheduler = params.scheduler || "simple";
    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;
    // Modelos (defaults = nombres reales del Colab; overridables desde la UI avanzada)
    const unet_name = params.unet_name || "z-image-turbo-fp8-e4m3fn.safetensors";
    const weight_dtype = params.weight_dtype || "fp8_e4m3fn";
    const clip_name = params.clip_name || "qwen_3_4b_fp8_mixed.safetensors";
    const clip_type = params.clip_type || "lumina2";
    const vae_name = params.vae_name || "ae.safetensors";

    console.log(`🎨 [ZIMAGE] Z-Image Colab:`, { prompt: promptText.substring(0, 60) + '...', steps, width, height, seed });

    promptWorkflow["6"]["inputs"]["text"] = promptText;
    promptWorkflow["7"]["inputs"]["text"] = params.negative_prompt || "blurry, ugly, low quality, text, watermark";
    promptWorkflow["3"]["inputs"]["seed"] = seed;
    promptWorkflow["3"]["inputs"]["steps"] = steps;
    promptWorkflow["3"]["inputs"]["cfg"] = cfg;
    promptWorkflow["3"]["inputs"]["sampler_name"] = sampler_name;
    promptWorkflow["3"]["inputs"]["scheduler"] = scheduler;
    promptWorkflow["13"]["inputs"]["width"] = width;
    promptWorkflow["13"]["inputs"]["height"] = height;
    promptWorkflow["13"]["inputs"]["batch_size"] = 1;
    promptWorkflow["10"]["inputs"]["unet_name"] = unet_name;
    promptWorkflow["10"]["inputs"]["weight_dtype"] = weight_dtype;
    promptWorkflow["11"]["inputs"]["clip_name"] = clip_name;
    promptWorkflow["11"]["inputs"]["type"] = clip_type;
    promptWorkflow["12"]["inputs"]["vae_name"] = vae_name;

    const promptId = await queuePrompt(promptWorkflow);
    console.log(`✓ [ZIMAGE] Prompt en cola con ID: ${promptId}`);
    return { promptId, outputNode: "9" };
}

// Workflow DIPLO-COLAB: Z-Image Turbo fp8 + upscale 2x (validado en Colab 2026-06-25).
// Ruta robusta sin LoRA/ControlNet/tile. Usa setIn() defensivo: si el nodo no existe
// se ignora, asi el mismo codigo sirve aunque cambie el workflow.
// Salida final = nodo 86 (upscale). Nodos: 16/28/17 loaders, 6/7 prompts, 13 latent,
// 3 KSampler, 92 VAEDecode++, 9 SaveImage base, 85/84 upscale, 86 SaveImage final.
async function generarImagenDiploColab(promptText, params = {}) {
    const wf = await readWorkflowDiploColab();

    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;
    const steps = params.steps || 8;
    const cfg = params.cfg ?? 1.0;
    const sampler_name = params.sampler_name || "euler";
    const scheduler = params.scheduler || "simple";
    const denoise = params.denoise ?? 1.0;
    const width = params.width || 1024;
    const height = params.height || 640;
    const batch_size = params.batch_size || 1;
    // Modelos (defaults = nombres reales del Colab; overridables desde la UI)
    const unet_name = params.unet_name || "z-image-turbo-fp8-e4m3fn.safetensors";
    const weight_dtype = params.weight_dtype || "fp8_e4m3fn";
    const vae_name = params.vae_name || "ae.safetensors";
    const clip_name = params.clip_name || "qwen_3_4b_fp8_mixed.safetensors";
    const clip_type = params.clip_type || "lumina2";
    const upscale_model_name = params.upscale_model_name || "2x-AnimeSharpV4_RCAN.safetensors";

    setIn(wf, "6", "text", promptText);
    setIn(wf, "7", "text", params.negative_prompt || "blurry, ugly, low quality, deformed hands, extra limbs, text, watermark");
    setIn(wf, "3", "seed", seed);
    setIn(wf, "3", "steps", steps);
    setIn(wf, "3", "cfg", cfg);
    setIn(wf, "3", "sampler_name", sampler_name);
    setIn(wf, "3", "scheduler", scheduler);
    setIn(wf, "3", "denoise", denoise);
    setIn(wf, "13", "width", width);
    setIn(wf, "13", "height", height);
    setIn(wf, "13", "batch_size", batch_size);
    setIn(wf, "16", "unet_name", unet_name);
    setIn(wf, "16", "weight_dtype", weight_dtype);
    setIn(wf, "17", "vae_name", vae_name);
    setIn(wf, "28", "clip_name", clip_name);
    setIn(wf, "28", "type", clip_type);
    setIn(wf, "85", "model_name", upscale_model_name);

    // LoRA opcional: si la UI manda use_lora + lora_name, insertamos un LoraLoader
    // completo (nodo 90) que parchea MODEL (del UNET 16) y CLIP (del CLIPLoader 28).
    // Reruteamos el clip de los prompts (6/7) al clip parcheado, así strength_clip
    // surte efecto. Si use_lora está OFF, el grafo queda intacto (model del UNET, clip del 28).
    if (params.use_lora && params.lora_name) {
        wf["90"] = {
            inputs: {
                lora_name: params.lora_name,
                strength_model: params.lora_strength_model ?? 0.8,
                strength_clip: params.lora_strength_clip ?? 1.0,
                model: ["16", 0],
                clip: ["28", 0]
            },
            class_type: "LoraLoader",
            _meta: { title: "LoRA (opcional)" }
        };
        setIn(wf, "3", "model", ["90", 0]);   // KSampler usa el modelo parcheado
        setIn(wf, "6", "clip", ["90", 1]);     // prompt + usa el clip parcheado
        setIn(wf, "7", "clip", ["90", 1]);     // prompt - usa el clip parcheado
        console.log(`🧩 [DIPLO-COLAB] LoRA: ${params.lora_name} @ model ${params.lora_strength_model ?? 0.8} / clip ${params.lora_strength_clip ?? 1.0}`);
    }

    // img2img opcional: si la UI manda img2img + ref_image, codificamos la imagen subida
    // y la usamos como latente inicial del KSampler (en vez del EmptySD3LatentImage 13).
    // Aditivo y gateado: sin img2img, el txt2img puro queda intacto. El nodo 13 queda
    // huerfano (ComfyUI no lo ejecuta) y el tamano de salida lo da la imagen de entrada.
    if (params.img2img && params.ref_image) {
        wf["61"] = {
            inputs: { image: params.ref_image },
            class_type: "LoadImage",
            _meta: { title: "img2img source" }
        };
        wf["62"] = {
            inputs: { pixels: ["61", 0], vae: ["17", 0] },  // VAE = VAELoader (17)
            class_type: "VAEEncode",
            _meta: { title: "img2img encode" }
        };
        setIn(wf, "3", "latent_image", ["62", 0]);
        console.log(`🖼️ [DIPLO-COLAB] img2img desde ${params.ref_image} @ denoise ${denoise}`);
    }

    console.log(`🎨 [DIPLO-COLAB] Generando:`, {
        prompt: promptText.substring(0, 60) + '...', seed, steps, cfg, sampler_name, scheduler, width, height
    });

    const promptId = await queuePrompt(wf);
    console.log(`✓ [DIPLO-COLAB] Prompt en cola con ID: ${promptId}`);
    // polled: true -> el server detecta el fin por HTTP /history (robusto ante WS caido)
    return { promptId, outputNode: "86", polled: true };
}

// DIPLO-COLAB + ControlNet experimental. Igual que diplocolab pero con la cadena
// LoadImage(61) -> ImageScaleBy(89) -> AIO_Preprocessor(80) -> QwenImageDiffsynthControlnet(75)
// (+ ModelPatchLoader 76) que parchea el modelo del KSampler. Requiere ref_image ya subida.
async function generarImagenDiploColabCN(promptText, params = {}) {
    const wf = await readWorkflowDiploColabCN();

    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;
    const steps = params.steps || 8;
    const cfg = params.cfg ?? 1.0;
    const sampler_name = params.sampler_name || "euler";
    const scheduler = params.scheduler || "simple";
    const denoise = params.denoise ?? 1.0;
    const width = params.width || 1024;
    const height = params.height || 640;
    const batch_size = params.batch_size || 1;
    const unet_name = params.unet_name || "z-image-turbo-fp8-e4m3fn.safetensors";
    const weight_dtype = params.weight_dtype || "fp8_e4m3fn";
    const vae_name = params.vae_name || "ae.safetensors";
    const clip_name = params.clip_name || "qwen_3_4b_fp8_mixed.safetensors";
    const clip_type = params.clip_type || "lumina2";
    // ControlNet
    const ref_image = params.ref_image;
    const scale_by = params.scale_by ?? 1.0;
    const scale_method = params.scale_method || "nearest-exact";
    const preprocessor = params.preprocessor || "CannyEdgePreprocessor";
    const preprocessor_resolution = params.preprocessor_resolution || 512;
    const controlnet_strength = params.controlnet_strength ?? 0.80;
    const model_patch_name = params.model_patch_name || "Z-Image-Turbo-Fun-Controlnet-Union.safetensors";

    if (!ref_image) throw new Error('ControlNet activo pero falta la imagen de referencia (subila primero)');

    setIn(wf, "6", "text", promptText);
    setIn(wf, "7", "text", params.negative_prompt || "blurry, ugly, low quality, deformed hands, extra limbs, text, watermark");
    setIn(wf, "3", "seed", seed);
    setIn(wf, "3", "steps", steps);
    setIn(wf, "3", "cfg", cfg);
    setIn(wf, "3", "sampler_name", sampler_name);
    setIn(wf, "3", "scheduler", scheduler);
    setIn(wf, "3", "denoise", denoise);
    setIn(wf, "13", "width", width);
    setIn(wf, "13", "height", height);
    setIn(wf, "13", "batch_size", batch_size);
    setIn(wf, "16", "unet_name", unet_name);
    setIn(wf, "16", "weight_dtype", weight_dtype);
    setIn(wf, "17", "vae_name", vae_name);
    setIn(wf, "28", "clip_name", clip_name);
    setIn(wf, "28", "type", clip_type);
    // ControlNet chain
    setIn(wf, "61", "image", ref_image);
    setIn(wf, "89", "scale_by", Number(scale_by));
    setIn(wf, "89", "upscale_method", scale_method);
    // Nodo 80 = preprocesador: dedicado (con sus params propios) si es uno de los 7,
    // o AIO_Preprocessor genérico para el resto. Los params propios llegan en params.
    setPreprocessorNode(wf, "80", { ...params, preprocessor, resolution: preprocessor_resolution });
    setIn(wf, "75", "strength", Number(controlnet_strength));
    setIn(wf, "76", "name", model_patch_name);

    console.log(`🎨 [DIPLO-COLAB-CN] Generando:`, {
        prompt: promptText.substring(0, 50) + '...', seed, steps, ref_image, preprocessor, controlnet_strength, scale_by
    });

    const promptId = await queuePrompt(wf);
    console.log(`✓ [DIPLO-COLAB-CN] Prompt en cola con ID: ${promptId}`);
    return { promptId, outputNode: "86", polled: true };
}

// Funcion especifica para el workflow DIPLO
// Expone TODAS las variables modificables de los nodos criticos
async function generarImagenDiplo(promptText, params = {}) {
    const promptWorkflow = await readWorkflowDiplo();
    
    // ── KSampler (nodo 3) ──
    const seed = params.seed || Math.floor(Math.random() * 18446744073709551614) + 1;
    const steps = params.steps || 8;
    const cfg = params.cfg || 1.0;
    const sampler_name = params.sampler_name || "euler";
    const scheduler = params.scheduler || "simple";
    const denoise = params.denoise || 0.55;
    
    // ── EmptySD3LatentImage (nodo 13) ──
    const width = params.width || 1024;
    const height = params.height || 640;
    const batch_size = params.batch_size || 1;
    
    // ── Modelos (nodos 16, 17, 28, 85, 76) ──
    const unet_name = params.unet_name || "z-image-turbo-fp8-e4m3fn.safetensors";
    const weight_dtype = params.weight_dtype || "fp8_e4m3fn";
    const vae_name = params.vae_name || "ae.safetensors";
    const clip_name = params.clip_name || "qwen_3_4b_fp8_mixed.safetensors";
    const clip_type = params.clip_type || "lumina2";
    const upscale_model_name = params.upscale_model_name || "2x-AnimeSharpV4_RCAN.safetensors";
    const model_patch_name = params.model_patch_name || "Z-Image-Turbo-Fun-Controlnet-Union.safetensors";
    
    // ── LoRA (nodo 90) ──
    const lora_name = params.lora_name || "Bradhamel_art_style.safetensors";
    const lora_strength_model = params.lora_strength_model || 0.80;
    const lora_strength_clip = params.lora_strength_clip || 1.00;
    
    // ── LoadImage referencia (nodo 61) ──
    const ref_image = params.ref_image || "DSC09211 (2).jpg";
    
    // ── ImageScaleBy (nodo 89) ──
    const scale_method = params.scale_method || "nearest-exact";
    const scale_by = params.scale_by || 0.19;
    
    // ── AIO_Preprocessor / ControlNet (nodos 80, 75) ──
    const preprocessor = params.preprocessor || "CannyEdgePreprocessor";
    const preprocessor_low = params.preprocessor_low || 100;
    const preprocessor_high = params.preprocessor_high || 200;
    const preprocessor_resolution = params.preprocessor_resolution || 512;
    const controlnet_strength = params.controlnet_strength || 0.90;
    
    // ── KSamplerSelect (nodo 39) ──
    const tile_sampler = params.tile_sampler || "euler";
    
    // ── BasicScheduler tile refine (nodo 56) ──
    const tile_scheduler = params.tile_scheduler || "simple";
    const tile_steps = params.tile_steps || 10;
    const tile_denoise = params.tile_denoise || 0.2;
    
    // ── TTP_Tile_image_size (nodo 49) ──
    const tile_cols = params.tile_cols || 3;
    const tile_rows = params.tile_rows || 3;
    const tile_overlap = params.tile_overlap ?? 0.05;
    
    // ── VAEDecodeTiled (nodo 46) ──
    const decode_tile_size = params.decode_tile_size || 2048;
    
    // ── Image Resize post-upscale (nodo 87) ──
    const upscale_width = params.upscale_width || 1128;
    const upscale_height = params.upscale_height || 672;
    const upscale_resize_mode = params.upscale_resize_mode || "crop";
    const upscale_resize_method = params.upscale_resize_method || "nearest-exact";
    
    // ── ImageScaleToTotalPixels (nodo 43) ──
    const scale_to_megapixels = params.scale_to_megapixels || 4;
    const scale_to_method = params.scale_to_method || "lanczos";
    
    // ── VAEDecodePlusPlus (nodo 92) ──
    const vae_decode_mode = params.vae_decode_mode || "tiled";
    const vae_decode_tile = params.vae_decode_tile || 512;
    
    console.log(`🎨 [DIPLO] Generando con:`, {
        prompt: promptText.substring(0,60)+'...', seed, steps, cfg, sampler_name, scheduler, denoise,
        width, height, lora_name, lora_strength_model, controlnet_strength,
        preprocessor, scale_by, tile_steps, tile_denoise, upscale_width, upscale_height
    });
    
    // ── Aplicar parametros al workflow ──
    
    // KSampler base (nodo 3)
    promptWorkflow["3"]["inputs"]["seed"] = seed;
    promptWorkflow["3"]["inputs"]["steps"] = steps;
    promptWorkflow["3"]["inputs"]["cfg"] = cfg;
    promptWorkflow["3"]["inputs"]["sampler_name"] = sampler_name;
    promptWorkflow["3"]["inputs"]["scheduler"] = scheduler;
    promptWorkflow["3"]["inputs"]["denoise"] = denoise;
    
    // Prompts
    promptWorkflow["6"]["inputs"]["text"] = promptText;
    promptWorkflow["7"]["inputs"]["text"] = params.negative_prompt || "blurry, ugly, low quality, deformed hands, extra limbs, text, watermark";
    promptWorkflow["47"]["inputs"]["text"] = params.tile_prompt || promptText;
    
    // Dimensiones
    promptWorkflow["13"]["inputs"]["width"] = width;
    promptWorkflow["13"]["inputs"]["height"] = height;
    promptWorkflow["13"]["inputs"]["batch_size"] = batch_size;
    
    // Modelos
    promptWorkflow["16"]["inputs"]["unet_name"] = unet_name;
    promptWorkflow["16"]["inputs"]["weight_dtype"] = weight_dtype;
    promptWorkflow["17"]["inputs"]["vae_name"] = vae_name;
    promptWorkflow["28"]["inputs"]["clip_name"] = clip_name;
    promptWorkflow["28"]["inputs"]["type"] = clip_type;
    promptWorkflow["85"]["inputs"]["model_name"] = upscale_model_name;
    promptWorkflow["76"]["inputs"]["model_patch_name"] = model_patch_name;
    
    // LoRA
    promptWorkflow["90"]["inputs"]["lora_name"] = lora_name;
    promptWorkflow["90"]["inputs"]["strength_model"] = lora_strength_model;
    promptWorkflow["90"]["inputs"]["strength_clip"] = lora_strength_clip;
    
    // Imagen de referencia
    promptWorkflow["61"]["inputs"]["image"] = ref_image;
    
    // ImageScaleBy
    promptWorkflow["89"]["inputs"]["upscale_method"] = scale_method;
    promptWorkflow["89"]["inputs"]["scale_by"] = scale_by;
    
    // Preprocesador (dedicado para los 7 ricos, AIO genérico para el resto) + ControlNet
    setPreprocessorNode(promptWorkflow, "80", {
        ...params, preprocessor, resolution: preprocessor_resolution,
        // compat con los campos viejos de Canny si el front aún manda low/high sueltos
        low_threshold: params.pp_low_threshold ?? preprocessor_low,
        high_threshold: params.pp_high_threshold ?? preprocessor_high,
    });
    promptWorkflow["75"]["inputs"]["strength"] = controlnet_strength;
    
    // KSamplerSelect (tile refine)
    promptWorkflow["39"]["inputs"]["sampler_name"] = tile_sampler;
    
    // BasicScheduler tile refine
    promptWorkflow["56"]["inputs"]["scheduler"] = tile_scheduler;
    promptWorkflow["56"]["inputs"]["steps"] = tile_steps;
    promptWorkflow["56"]["inputs"]["denoise"] = tile_denoise;
    
    // Tile config
    promptWorkflow["49"]["inputs"]["cols"] = tile_cols;
    promptWorkflow["49"]["inputs"]["rows"] = tile_rows;
    promptWorkflow["49"]["inputs"]["overlap"] = tile_overlap;
    
    // VAEDecodeTiled
    promptWorkflow["46"]["inputs"]["tile_size"] = decode_tile_size;
    
    // Image Resize post-upscale
    promptWorkflow["87"]["inputs"]["width"] = upscale_width;
    promptWorkflow["87"]["inputs"]["height"] = upscale_height;
    promptWorkflow["87"]["inputs"]["resize_mode"] = upscale_resize_mode;
    promptWorkflow["87"]["inputs"]["method"] = upscale_resize_method;
    
    // ImageScaleToTotalPixels
    promptWorkflow["43"]["inputs"]["megapixels"] = scale_to_megapixels;
    promptWorkflow["43"]["inputs"]["upscale_method"] = scale_to_method;
    
    // VAEDecodePlusPlus
    promptWorkflow["92"]["inputs"]["mode"] = vae_decode_mode;
    promptWorkflow["92"]["inputs"]["tile_size"] = vae_decode_tile;
    
    // RandomNoise seed (nodo 40) - siempre random para variedad
    promptWorkflow["40"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 18446744073709551614) + 1;
    
    // Ajustar dimensiones del tile para que sean proporcionales al upscale
    const tileW = Math.min(1024, Math.ceil(upscale_width / tile_cols));
    const tileH = Math.min(1024, Math.ceil(upscale_height / tile_rows));
    promptWorkflow["50"]["inputs"]["tile_width"] = tileW;
    promptWorkflow["50"]["inputs"]["tile_height"] = tileH;

    const promptId = await queuePrompt(promptWorkflow);
    console.log(`✓ [DIPLO] Prompt en cola con ID: ${promptId}`);
    // outputNode: nodo 30 = SaveImage de la rama tiled (salida final de mayor resolucion).
    // Filtra las salidas intermedias (9 = base, 86 = upscale sin tile) para no parpadear.
    return { promptId, outputNode: "30" };
}
