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
const { buildInterpolateWorkflow, buildWanPostSmooth, buildVideo2VideoWorkflow } = require('./video-workflows');

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
// 30mb default (imágenes de referencia en base64); 200mb SOLO en /api/upload-video
// (clips de video pesan más) — límite por-ruta, no global, para no aflojar el resto.
const jsonParser30mb = bodyParser.json({ limit: '30mb' });
const jsonParser200mb = bodyParser.json({ limit: '200mb' });
app.use((req, res, next) => {
    const isVideoUpload = req.path === (BASE_PATH + '/api/upload-video');
    (isVideoUpload ? jsonParser200mb : jsonParser30mb)(req, res, next);
});

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
// La API key de comfy.org NUNCA sale del server en texto plano (ni acá ni en logs):
// se refleja solo como booleano (hasComfyOrgApiKey) para que el front sepa si ya hay
// una cargada, sin exponerla en la respuesta HTTP / DevTools del cliente.
app.get(BASE_PATH + '/api/config', (req, res) => {
    const { comfyOrgApiKey, ...safeConfig } = config;
    res.json({ ...safeConfig, hasComfyOrgApiKey: !!comfyOrgApiKey });
});

// Guarda SOLO la API key de comfy.org, sin tocar comfyUrl/isRemote (evita pisar la
// config del Colab). Endpoint separado para no mezclar con /api/config (que hoy
// reconecta el WS al guardar, algo que no aplica acá).
app.post(BASE_PATH + '/api/comfy-org-key', (req, res) => {
    const { apiKey } = req.body || {};
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
        return res.status(400).json({ success: false, error: 'falta apiKey' });
    }
    config.comfyOrgApiKey = apiKey.trim();
    if (saveConfig(config)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false, error: 'no se pudo guardar la configuración' });
    }
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

// Sube un VIDEO (base64) al Colab para usarlo como entrada de VHS_LoadVideo. Espejo
// de /api/upload-image pero con el límite de 200mb (ver bodyParser por-ruta arriba).
app.post(BASE_PATH + '/api/upload-video', async (req, res) => {
    try {
        const { filename, dataUrl } = req.body || {};
        if (!dataUrl) return res.json({ success: false, error: 'falta dataUrl' });
        const m = /^data:.+?;base64,(.*)$/.exec(dataUrl);
        const b64 = m ? m[1] : dataUrl;
        const safe = (filename || `video_${Date.now()}.mp4`).replace(/[^\w.\-]/g, '_');
        const tmp = path.join(__dirname, 'public', 'imagenes', '_upload_' + safe);
        fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
        const result = await uploadFile(tmp, safe, 'video/mp4');
        console.log(`📤 [upload-video] subido a ComfyUI: ${result && result.name}`);
        res.json({ success: true, name: result.name, subfolder: result.subfolder || '', info: result });
    } catch (e) {
        console.error('[upload-video] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Pre-chequeo genérico: valida que 'need' esté en /object_info antes de encolar. El
// class_type "FILM VFI" (con espacio) es literal según el pack de la Clase 5 —
// ⚠️ si el Colab lo expone con otro nombre, este chequeo lo va a decir clarito.
async function checkNodesOrError(need) {
    const oi = await fetchObjectInfo().catch(() => null);
    if (!oi) return null; // no se pudo consultar (Colab caído) -> dejamos que falle más adelante con su propio error
    const missing = need.filter(n => !oi[n]);
    if (missing.length) {
        return `Faltan nodos en el Colab: ${missing.join(', ')}. Reiniciá el Colab con el notebook actualizado ` +
            `(celda de VideoHelperSuite/Frame-Interpolation corrida) y reconectá la URL.`;
    }
    return null;
}

// 🎞️ Suavizar / Slow motion (FILM VFI). Sube (si hace falta) y corre VHS_LoadVideo →
// FILM VFI → CreateVideo → SaveVideo. "Probar 1 frame" no aplica acá (FILM necesita
// al menos 2 frames para interpolar entre medio).
app.post(BASE_PATH + '/api/interpolate-video', async (req, res) => {
    try {
        const { filename, multiplier, mode, sourceFps } = req.body || {};
        if (!filename) return res.json({ success: false, error: 'falta filename (subí un video primero)' });

        let built;
        try {
            built = buildInterpolateWorkflow({ filename, multiplier, mode, sourceFps });
        } catch (e) {
            return res.json({ success: false, error: e.message });
        }

        const errMsg = await checkNodesOrError(built.requiredNodes);
        if (errMsg) return res.json({ success: false, error: errMsg });

        console.log(`🎞️ [interpolate-video] ${filename} | ×${multiplier || 2} modo=${mode || 'fluid'}`);
        const out = await queuePollDownload(built.workflow, built.saveNodeId, 240);
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[interpolate-video] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// 🎬 Reimaginar un video (vid2vid estilo Octavio). Con frameLoadCap===1 devuelve
// isPreviewFrame:true y una IMAGEN sola (truco "probar 1 frame primero" antes de
// quemar créditos en el video completo).
app.post(BASE_PATH + '/api/video2video', async (req, res) => {
    try {
        const body = req.body || {};
        const { filename, prompt, negative_prompt, denoise, frame_load_cap, force_rate,
            steps, cfg, seed, controlnet_strength, preprocessor, film_multiplier } = body;
        if (!filename) return res.json({ success: false, error: 'falta filename (subí un video primero)' });
        if (!prompt || !String(prompt).trim()) return res.json({ success: false, error: 'falta el prompt' });

        let built;
        try {
            built = buildVideo2VideoWorkflow({
                filename, prompt, negativePrompt: negative_prompt, denoise, frameLoadCap: frame_load_cap,
                forceRate: force_rate, steps, cfg, seed, controlnetStrength: controlnet_strength,
                preprocessor, filmMultiplier: film_multiplier
            });
        } catch (e) {
            return res.json({ success: false, error: e.message });
        }

        const errMsg = await checkNodesOrError(built.requiredNodes);
        if (errMsg) return res.json({ success: false, error: errMsg });

        console.log(`🎬 [video2video] ${filename} | denoise=${denoise} frames=${frame_load_cap || 'todos'} preview=${built.isPreviewFrame}`);
        const out = await queuePollDownload(built.workflow, built.saveNodeId, 300);
        res.json({ success: true, url: out.url, filename: out.filename, isPreviewFrame: !!built.isPreviewFrame });
    } catch (e) {
        console.error('[video2video] error:', e.message);
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

// Arma el grafo SimpleQwenVLgguf (1 imagen) + PreviewAny sink, lo encola y devuelve el
// texto. Extraído de /api/describe-image para reusarlo también en el prompt de
// transición de video (2 llamadas, una por frame — ver /api/video-transition-prompt).
async function describeImageWithQwen(image, systemPrompt, userPrompt) {
    const wf = {
        "1": { inputs: { image }, class_type: "LoadImage", _meta: { title: "describe src" } },
        "2": {
            // Inputs EXACTOS del nodo SimpleQwenVLgguf (verificados via object_info, 2026-06-29).
            // El modelo se pasa por ruta de archivo (model_path/mmproj_path), no por dropdown.
            inputs: {
                image: ["1", 0],
                system_prompt: systemPrompt || "You are a precise vision assistant. Describe the image as a detailed text-to-image prompt.",
                user_prompt: userPrompt || "Describe this image as a detailed, comma-separated prompt for an image generator. Be specific about subject, style, colors, lighting and composition.",
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
    const promptId = await queuePrompt(wf);
    const text = await pollHistoryForText(promptId, "3");
    if (!text) throw new Error('el nodo no devolvió texto (¿está instalado SimpleQwenVLgguf? reiniciá el Colab con el notebook actualizado)');
    return text;
}

app.post(BASE_PATH + '/api/describe-image', async (req, res) => {
    try {
        const { image, user_prompt, system_prompt } = req.body || {};
        if (!image) return res.json({ success: false, error: 'falta image (subí una referencia primero)' });
        console.log(`🔎 [describe-image] Qwen3-VL sobre ${image}`);
        const text = await describeImageWithQwen(image, system_prompt, user_prompt);
        res.json({ success: true, prompt: text });
    } catch (e) {
        console.error('[describe-image] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// 🤖 Prompt de transición para video (Clase 5, backlog #9): "le dan frame inicial+final
// y GENERA el prompt del entremedio". SimpleQwenVLgguf solo acepta 1 imagen por llamada
// (confirmado en object_info) — en vez de inventar una capacidad multi-imagen no
// verificada, describimos cada frame por separado (reusando el mismo nodo ya probado
// en vivo) y componemos la transición EN TEXTO acá, con un system_prompt que le pide al
// modelo enfocarse en describir ese frame como punto de partida/llegada de un movimiento.
app.post(BASE_PATH + '/api/video-transition-prompt', async (req, res) => {
    try {
        const { frame_start, frame_end, hint } = req.body || {};
        if (!frame_start || !frame_end) {
            return res.json({ success: false, error: 'faltan frame_start y frame_end (subí las 2 imágenes primero)' });
        }
        const sysStart = "You are describing the FIRST frame of a short video clip for a text-to-video prompt. Be specific about subject, pose, environment and lighting. No camera jargon, plain descriptive prose.";
        const sysEnd = "You are describing the LAST frame of a short video clip for a text-to-video prompt. Be specific about subject, pose, environment and lighting. No camera jargon, plain descriptive prose.";
        console.log(`🤖 [video-transition-prompt] describiendo start=${frame_start} end=${frame_end}`);
        const [startDesc, endDesc] = await Promise.all([
            describeImageWithQwen(frame_start, sysStart),
            describeImageWithQwen(frame_end, sysEnd)
        ]);
        const hintPart = (hint && String(hint).trim()) ? `, ${String(hint).trim()}` : '';
        const prompt = `${startDesc.replace(/\.$/, '')}, gradually and smoothly transitioning to ${endDesc.replace(/\.$/, '')}, continuous fluid motion, no jump cuts, no blur${hintPart}`;
        res.json({ success: true, prompt, start_description: startDesc, end_description: endDesc });
    } catch (e) {
        console.error('[video-transition-prompt] error:', e.message);
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
        const { image, instruction, negative, steps, cfg, seed, fast, refImages } = req.body || {};
        if (!image) return res.json({ success: false, error: 'falta image (subí la imagen a editar)' });
        // refImages: hasta 2 imágenes YA subidas al Colab, opcionales — se pasan como
        // image2/image3 de TextEncodeQwenImageEditPlus (identidad/textura), NO afectan
        // el tamaño de salida (eso lo sigue definiendo `image`, vía VAEEncode nodo 9).
        const extraRefs = Array.isArray(refImages) ? refImages.filter(Boolean).slice(0, 2) : [];
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
        // Referencias extra (identidad/textura): cada una LoadImage + escala 1MP propia,
        // conectadas como image2/image3 de AMBOS TextEncodeQwenImageEditPlus (pos y neg).
        extraRefs.forEach((refName, idx) => {
            const slot = idx === 0 ? "image2" : "image3";
            const loadId = `20${idx}`, scaleId = `21${idx}`;
            wf[loadId] = { inputs: { image: refName }, class_type: "LoadImage", _meta: { title: `ref ${slot}` } };
            wf[scaleId] = { inputs: { image: [loadId, 0], upscale_method: "nearest-exact", megapixels: 1.0, resolution_steps: 1 },
                             class_type: "ImageScaleToTotalPixels", _meta: { title: `scale ${slot}` } };
            wf["7"].inputs[slot] = [scaleId, 0];
            wf["8"].inputs[slot] = [scaleId, 0];
        });

        console.log(`✏️ [edit-image] Qwen-Image-Edit sobre ${image} (+${extraRefs.length} ref) | "${String(instruction).slice(0, 60)}" | fast=${useFast} steps=${realSteps} cfg=${realCfg}`);
        const out = await queuePollDownload(wf, "15", 240); // ~12 min: la 1ª carga del modelo de edit es lenta
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[edit-image] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ── Generar VIDEO con Seedance 2.0 (API nodes oficiales de ComfyUI, core) ──────────
// Nodos reales usados (verificados contra comfy_api_nodes/nodes_bytedance.py del
// mismo repo local, node_id): "ByteDance2TextToVideoNode" (texto → video) y
// "ByteDance2ReferenceNode" (1 o más imágenes de referencia → video). Son API nodes:
// el cómputo lo hace ByteDance/comfy.org, consumen créditos de la cuenta de comfy.org
// del usuario. La key viaja por extra_data.api_key_comfy_org (NUNCA en el grafo ni en
// los logs — es SENSITIVE_EXTRA_DATA_KEYS en ComfyUI, ver execution.py:202).
const SEEDANCE2_MODEL_LABELS = ["Seedance 2.0", "Seedance 2.0 Fast"];
const SEEDANCE2_RES_BY_MODEL = {
    "Seedance 2.0": ["480p", "720p", "1080p"],
    "Seedance 2.0 Fast": ["480p", "720p"]
};
const SEEDANCE2_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"];

app.post(BASE_PATH + '/api/generate-video', async (req, res) => {
    try {
        const apiKey = (config.comfyOrgApiKey || process.env.COMFY_ORG_API_KEY || '').trim();
        if (!apiKey) {
            return res.status(400).json({ success: false,
                error: 'Falta la API key de comfy.org — cargala en Configuración.' });
        }

        const body = req.body || {};
        const {
            prompt,
            mode = 'text',           // 'text' | 'image'
            image,                   // nombre ya subido a ComfyUI (input/), solo si mode='image'
            model = 'Seedance 2.0',  // "Seedance 2.0" | "Seedance 2.0 Fast"
            resolution = '720p',
            ratio = '16:9',
            duration = 7,
            generate_audio = true,
            seed = 0,
            watermark = false
        } = body;

        if (!prompt || !String(prompt).trim()) {
            return res.json({ success: false, error: 'falta el prompt (describí el video que querés generar)' });
        }
        if (!SEEDANCE2_MODEL_LABELS.includes(model)) {
            return res.json({ success: false, error: `modelo inválido: ${model}` });
        }
        const validResolutions = SEEDANCE2_RES_BY_MODEL[model];
        if (!validResolutions.includes(resolution)) {
            return res.json({ success: false,
                error: `resolución "${resolution}" no soportada por ${model}. Válidas: ${validResolutions.join(', ')}` });
        }
        if (!SEEDANCE2_RATIOS.includes(ratio)) {
            return res.json({ success: false, error: `ratio inválido: ${ratio}` });
        }
        const dur = Number(duration);
        if (!Number.isFinite(dur) || dur < 4 || dur > 15) {
            return res.json({ success: false, error: 'duration debe estar entre 4 y 15 segundos' });
        }
        if (mode === 'image' && !image) {
            return res.json({ success: false, error: 'falta image (subí una imagen de referencia primero)' });
        }

        // Pre-chequeo: si el Colab todavia no tiene los nodos de Seedance 2.0 (ComfyUI
        // desactualizado), error claro en vez de un 500 críptico.
        const oi = await fetchObjectInfo().catch(() => null);
        const nodeClass = mode === 'image' ? 'ByteDance2ReferenceNode' : 'ByteDance2TextToVideoNode';
        if (oi && !oi[nodeClass]) {
            return res.json({ success: false,
                error: `Falta el nodo ${nodeClass} en el Colab. Reiniciá el Colab (clona ComfyUI latest en cada boot, así que un simple reinicio ya lo trae).` });
        }

        const modelWidget = {
            model,
            prompt: String(prompt),
            resolution,
            ratio,
            duration: dur,
            generate_audio: !!generate_audio
        };

        let wf;
        if (mode === 'image') {
            modelWidget.reference_images = { image_1: image };
            wf = {
                "1": {
                    inputs: { model: modelWidget, seed: Number(seed) || 0, watermark: !!watermark },
                    class_type: "ByteDance2ReferenceNode",
                    _meta: { title: "Seedance 2.0 Reference to Video" }
                }
            };
        } else {
            wf = {
                "1": {
                    inputs: { model: modelWidget, seed: Number(seed) || 0, watermark: !!watermark },
                    class_type: "ByteDance2TextToVideoNode",
                    _meta: { title: "Seedance 2.0 Text to Video" }
                }
            };
        }

        console.log(`🎬 [generate-video] ${model} | mode=${mode} | ${resolution} ${ratio} ${dur}s | "${String(prompt).slice(0, 60)}"`);
        // Video largo: timeout generoso (~15 min). Los nodos API hacen su propio polling
        // interno contra comfy.org; queuePollDownload solo espera a que /history cierre.
        const extraData = { api_key_comfy_org: apiKey };
        const out = await queuePollDownload(wf, "1", 300, extraData);
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[generate-video] error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ── Generar VIDEO con Wan 2.2 TI2V-5B (nodos NATIVOS de ComfyUI, sin custom node) ──
// Modelo abierto, corre LOCAL en el Colab de Leo (sin API paga, sin costo por clip).
// Grafo con el nodo real `WanImageToVideo` (comfy_extras/nodes_wan.py, confirmado
// contra el código fuente local): admite start_image OPCIONAL — con imagen hace
// imagen→video, sin imagen hace texto→video puro (mismo nodo para ambos modos).
// Pesos: diffusion_models/Wan2.2-TI2V-5B-Q8_0.gguf (QuantStack, vía UnetLoaderGGUF
// — mismo loader ya usado para Qwen-Image-Edit), text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors
// (Comfy-Org, YA está en el notebook para Wan), vae/wan2.2_vae.safetensors (VAE
// propio del TI2V-5B, no confundir con wan_2.1_vae que es del 14B).
const WAN_UNET = 'Wan2.2-TI2V-5B-Q8_0.gguf';
const WAN_CLIP = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors';
const WAN_VAE = 'wan2.2_vae.safetensors';

app.post(BASE_PATH + '/api/generate-video-wan', async (req, res) => {
    try {
        const body = req.body || {};
        const {
            prompt,
            negative_prompt = '',
            mode = 'text',            // 'text' | 'image'
            image,                    // nombre ya subido a ComfyUI (input/), solo si mode='image'
            width = 832,
            height = 480,
            length = 81,
            steps = 20,
            cfg = 5.0,
            seed,
            smooth = false,        // ✨ post-proceso: FILM VFI ×2 antes de armar el video
            smooth_multiplier = 2
        } = body;

        if (!prompt || !String(prompt).trim()) {
            return res.json({ success: false, error: 'falta el prompt (describí el video que querés generar)' });
        }
        if (mode === 'image' && !image) {
            return res.json({ success: false, error: 'falta image (subí una imagen de partida primero)' });
        }
        const w = Number(width) || 832;
        const h = Number(height) || 480;
        const len = Number(length) || 81;
        const realSteps = Number(steps) || 20;
        const realCfg = Number(cfg) || 5.0;
        const realSeed = (seed !== undefined && seed !== null && seed !== '')
            ? Number(seed) : (Math.floor(Math.random() * 1e15) + 1);

        // Pre-chequeo: si faltan nodos en el Colab (aún no re-corrido con los pesos de
        // Wan), error claro y accionable en vez de un 500 críptico.
        const oi = await fetchObjectInfo().catch(() => null);
        if (oi) {
            const need = ["UnetLoaderGGUF", "CLIPLoader", "VAELoader", "CLIPTextEncode",
                "WanImageToVideo", "KSamplerAdvanced", "VAEDecode", "CreateVideo", "SaveVideo"];
            if (smooth) need.push("FILM VFI");
            const missing = need.filter(n => !oi[n]);
            if (missing.length) return res.json({ success: false,
                error: `Faltan nodos en el Colab: ${missing.join(", ")}. Reiniciá el Colab con el notebook actualizado (celda de Wan 2.2${smooth ? '/Frame-Interpolation' : ''} corrida).` });
        }

        const wf = {
            "1": { inputs: { clip_name: WAN_CLIP, type: "wan", device: "default" }, class_type: "CLIPLoader", _meta: { title: "wan clip" } },
            "2": { inputs: { unet_name: WAN_UNET }, class_type: "UnetLoaderGGUF", _meta: { title: "Wan 2.2 TI2V-5B GGUF" } },
            "3": { inputs: { vae_name: WAN_VAE }, class_type: "VAELoader", _meta: { title: "wan vae" } },
            "4": { inputs: { text: String(prompt), clip: ["1", 0] }, class_type: "CLIPTextEncode", _meta: { title: "positive" } },
            "5": { inputs: { text: String(negative_prompt || ""), clip: ["1", 0] }, class_type: "CLIPTextEncode", _meta: { title: "negative" } },
            "6": { inputs: { positive: ["4", 0], negative: ["5", 0], vae: ["3", 0], width: w, height: h, length: len, batch_size: 1 },
                    class_type: "WanImageToVideo", _meta: { title: "Wan image/text to video" } },
            "7": { inputs: { add_noise: "enable", enable_denoise: "enable", noise_seed: realSeed,
                    steps: realSteps, cfg: realCfg, sampler_name: "euler", scheduler: "simple",
                    start_at_step: 0, end_at_step: 10000, return_with_leftover_noise: "disable",
                    model: ["2", 0], positive: ["6", 0], negative: ["6", 1], latent_image: ["6", 2] },
                    class_type: "KSamplerAdvanced", _meta: { title: "wan sampler" } },
            "8": { inputs: { samples: ["7", 0], vae: ["3", 0] }, class_type: "VAEDecode", _meta: { title: "decode" } },
            "9": { inputs: { fps: 16, images: ["8", 0] }, class_type: "CreateVideo", _meta: { title: "create video" } },
            "10": { inputs: { filename_prefix: "wan2.2_video", format: "auto", codec: "auto", video: ["9", 0] },
                    class_type: "SaveVideo", _meta: { title: "save video" } }
        };
        if (mode === 'image') {
            wf["6"].inputs.start_image = ["11", 0];
            wf["11"] = { inputs: { image }, class_type: "LoadImage", _meta: { title: "wan start image" } };
        }
        if (smooth) {
            buildWanPostSmooth(wf, { decodeNodeId: "8", combineNodeId: "9", multiplier: Number(smooth_multiplier) || 2 });
        }

        console.log(`🎬 [generate-video-wan] mode=${mode} | ${w}x${h} len=${len} steps=${realSteps} cfg=${realCfg} smooth=${smooth} | "${String(prompt).slice(0, 60)}"`);
        // Video local: sin llamada a API externa, pero la 1ª carga del modelo (~5-6GB
        // GGUF + text encoder) puede tardar; timeout generoso como en edit-image.
        const out = await queuePollDownload(wf, "10", 240);
        res.json({ success: true, url: out.url, filename: out.filename });
    } catch (e) {
        console.error('[generate-video-wan] error:', e.message);
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
        .filter(n => /\.(png|jpe?g|webp|mp4|webm)$/i.test(n))   // incluye video (FILM/vid2vid/Wan)
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

// LoRA-stack "especiero" (Clase 5): encadena N LoraLoader, cada uno parcheando el
// model/clip que le pasa el anterior. Con loras=[] no agrega nodos y devuelve
// modelSrc/clipSrc intactos (grafo sin LoRA queda idéntico a hoy). idPrefix evita
// colisión de node ids cuando se aplica el mismo stack sobre más de un loader
// (ej. Turbo=16 y, con calidad Base/Mixta, también sobre el loader Base=91).
function applyLoraStack(wf, loras, modelSrc, clipSrc, idPrefix) {
    let modelOut = modelSrc, clipOut = clipSrc;
    (loras || []).forEach((l, i) => {
        if (!l || !l.name) return;
        const nodeId = `${idPrefix}${i}`;
        wf[nodeId] = {
            inputs: {
                lora_name: l.name,
                strength_model: l.strength_model ?? 0.8,
                strength_clip: l.strength_clip ?? 1.0,
                model: modelOut,
                clip: clipOut
            },
            class_type: "LoraLoader",
            _meta: { title: `LoRA especiero #${i + 1}: ${l.name}` }
        };
        modelOut = [nodeId, 0];
        clipOut = [nodeId, 1];
    });
    return [modelOut, clipOut];
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

// Generalización de la vieja uploadImage(filePath): sube CUALQUIER archivo (imagen o
// video) al mismo endpoint /upload/image de ComfyUI. VHS_LoadVideo usa ese mismo
// endpoint para sus .mp4 (confirmar contra el Colab vivo; documentado en el plan de
// la Clase 5). mimeType es opcional, solo ayuda al form-data a declarar el content-type.
async function uploadFile(filePath, filename, mimeType) {
    const formData = new FormData();
    const opts = {};
    if (filename) opts.filename = filename;
    if (mimeType) opts.contentType = mimeType;
    formData.append('image', fs.createReadStream(filePath), Object.keys(opts).length ? opts : undefined);

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
async function uploadImage(filePath) { return uploadFile(filePath); }

// extraData (opcional): se mergea en el POST /prompt como "extra_data". Lo usan los
// API nodes oficiales de ComfyUI (ej. Seedance 2.0) para recibir la key de comfy.org
// sin que viaje en el grafo (server.js:202 de execution.py la trata como sensible).
async function queuePrompt(promptWorkflow, extraData) {
    const body = { prompt: promptWorkflow, client_id: clientId };
    if (extraData) body.extra_data = extraData;
    const postData = JSON.stringify(body);
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
        // Los nodos de la suite VHS (VHS_VideoCombine) históricamente emiten bajo la
        // clave "gifs" en vez de "images" aunque el formato sea MP4 -> fallback defensivo
        // (anticipado por el plan de la Clase 5, "Plan B" en KNOW_HOW/CLASE5-INVENTARIO...).
        let imgs = (outputs[outputNode] && (outputs[outputNode].images || outputs[outputNode].gifs)) || null;
        if (!imgs) {
            for (const k of Object.keys(outputs)) {
                const cand = outputs[k].images || outputs[k].gifs;
                if (cand && cand.length) { imgs = cand; break; }
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
async function queuePollDownload(wf, outputNode, maxTries = 100, extraData) {
    const promptId = await queuePrompt(wf, extraData);
    const intervalMs = 3000; // maxTries=100 ≈ 5 min (default); más para cargas pesadas (Qwen-Image-Edit)
    for (let i = 0; i < maxTries; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        let hist;
        try { hist = await getHistory(promptId); } catch (e) { continue; }
        const entry = hist && hist[promptId];
        if (!entry) continue;
        const status = entry.status || {};
        const outputs = entry.outputs || {};
        // Fallback .gifs: ver comentario equivalente en pollHistoryAndEmit (VHS_VideoCombine).
        let imgs = (outputs[outputNode] && (outputs[outputNode].images || outputs[outputNode].gifs)) || null;
        if (!imgs) for (const k of Object.keys(outputs)) { const cand = outputs[k].images || outputs[k].gifs; if (cand && cand.length) { imgs = cand; break; } }
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

    // LoRA-stack "especiero" (Clase 5, backlog #7): encadena N LoraLoader, cada uno
    // parcheando el model/clip del anterior (mismo patrón que rgthree Power Lora
    // Loader / Easy Lora Stack — mezclar varios a strengths bajas). Retrocompatible:
    // si no viene params.loras[], usamos el toggle viejo use_lora+lora_name como stack
    // de 1 elemento (mismo resultado que antes de esta sesión).
    let loraList = Array.isArray(params.loras) ? params.loras.filter(l => l && l.name) : [];
    if (!loraList.length && params.use_lora && params.lora_name) {
        loraList = [{ name: params.lora_name, strength_model: params.lora_strength_model ?? 0.8, strength_clip: params.lora_strength_clip ?? 1.0 }];
    }
    const [turboModel, clipOut] = applyLoraStack(wf, loraList, ["16", 0], ["28", 0], "90_");
    setIn(wf, "3", "model", turboModel);   // KSampler usa el modelo parcheado (o el UNET directo si no hay LoRAs)
    setIn(wf, "6", "clip", clipOut);        // prompt + usa el clip parcheado
    setIn(wf, "7", "clip", clipOut);        // prompt - usa el clip parcheado
    if (loraList.length) {
        console.log(`🧩 [DIPLO-COLAB] LoRA-stack (${loraList.length}): ${loraList.map(l => `${l.name}@model${l.strength_model ?? 0.8}/clip${l.strength_clip ?? 1.0}`).join(', ')}`);
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

    // Calidad de imagen (Clase 5): Turbo (default) | Base (más consistente, CFG variable,
    // recomendada por el profe para edición fina) | Mixta (receta del profe: Turbo da
    // forma → Base le da cuerpo → Turbo remata, todo en LATENT sin decodificar entre medio).
    // Checkpoint Z-Image BASE confirmado 2026-07-06 (listado real de HuggingFace, no
    // resumen): Comfy-Org/z_image → split_files/diffusion_models/z_image_bf16.safetensors
    // (12.3GB, bf16 sin cuantizar — weight_dtype "default" carga cualquier precisión sin
    // forzar cast, la opción segura). El mismo repo confirma que Base reusa el MISMO CLIP
    // (qwen_3_4b_fp8_mixed.safetensors) y VAE (ae.safetensors) que ya usa Turbo — no hace
    // falta bajar nada más. Hay una variante int8 más liviana (z_image_int8_convrot.safetensors,
    // 6.2GB) pero su compatibilidad con UNETLoader estándar no está verificada (nombre de
    // cuantización no estándar) — se deja como override manual, no como default.
    const quality = params.quality || 'turbo';
    let finalSamplerNode = "3"; // qué nodo alimenta finalmente a VAEDecode (92)
    if (quality !== 'turbo') {
        const baseUnet = params.unet_name_base || process.env.ZIMAGE_BASE_UNET || 'z_image_bf16.safetensors';
        wf["91"] = { inputs: { unet_name: baseUnet, weight_dtype: params.weight_dtype_base || "default" },
            class_type: "UNETLoader", _meta: { title: "UNET Z-Image BASE" } };

        // El LoRA-stack (si hay) se aplica TAMBIÉN sobre el loader Base — si no, un
        // LoRA activo se perdería en cuanto la calidad deja de ser Turbo.
        const [baseModel] = applyLoraStack(wf, loraList, ["91", 0], ["28", 0], "91lora_");
        if (quality === 'base') {
            // Base sola: mismo KSampler(3) pero con el modelo Base — más steps, CFG
            // deja de estar clavado en 1 (Turbo SI necesita cfg=1, Base no).
            setIn(wf, "3", "model", baseModel);
            setIn(wf, "3", "steps", params.steps ?? 20);
            setIn(wf, "3", "cfg", params.cfg ?? 4.0);
            console.log(`🎨 [DIPLO-COLAB] Calidad BASE: steps=${params.steps ?? 20} cfg=${params.cfg ?? 4.0}`);
        } else if (quality === 'mixta') {
            wf["93"] = {
                inputs: {
                    seed, steps: params.steps_base ?? 20, cfg: params.cfg_base ?? 4.0,
                    sampler_name, scheduler, denoise: params.denoise_base ?? 0.45,
                    model: baseModel, positive: ["6", 0], negative: ["7", 0], latent_image: ["3", 0]
                },
                class_type: "KSampler", _meta: { title: "KSampler (Base — le da cuerpo)" }
            };
            wf["94"] = {
                inputs: {
                    seed, steps: params.steps_turbo2 ?? 8, cfg: 1.0,
                    sampler_name, scheduler, denoise: params.denoise_turbo2 ?? 0.25,
                    model: turboModel, positive: ["6", 0], negative: ["7", 0], latent_image: ["93", 0]
                },
                class_type: "KSampler", _meta: { title: "KSampler (Turbo — remate)" }
            };
            finalSamplerNode = "94";
            console.log(`🎨 [DIPLO-COLAB] Calidad MIXTA: Turbo→Base(denoise ${params.denoise_base ?? 0.45})→Turbo(denoise ${params.denoise_turbo2 ?? 0.25})`);
        }
    }

    // Refinar (2º pase latente, denoise bajo, corre siempre con Turbo): opcional,
    // encadenable con cualquier calidad — mejora detalle general sin re-decodificar.
    // OJO: usa turboModel (no ["16",0] crudo) para que el LoRA-stack, si está activo,
    // sobreviva también en este último pase (bug real encontrado en auditoría 2026-07-06).
    if (params.refine) {
        wf["95"] = {
            inputs: {
                seed, steps: params.steps_refine ?? 8, cfg: 1.0,
                sampler_name, scheduler, denoise: params.denoise_refine ?? 0.25,
                model: turboModel, positive: ["6", 0], negative: ["7", 0], latent_image: [finalSamplerNode, 0]
            },
            class_type: "KSampler", _meta: { title: "KSampler (Refinar)" }
        };
        finalSamplerNode = "95";
        console.log(`✨ [DIPLO-COLAB] Refinar activado: denoise ${params.denoise_refine ?? 0.25}`);
    }
    if (finalSamplerNode !== "3") setIn(wf, "92", "samples", [finalSamplerNode, 0]);

    console.log(`🎨 [DIPLO-COLAB] Generando:`, {
        prompt: promptText.substring(0, 60) + '...', seed, steps, cfg, sampler_name, scheduler, width, height, quality, refine: !!params.refine
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
