#!/usr/bin/env node
// cc_diplo.js — disparar el workflow DIPLO-Colab desde la linea de comandos.
// Pensado para que Claude Code (o vos) genere sin abrir el navegador ni el server 8085.
// Lee la URL del Colab de config.json, inyecta el prompt en workflow_diplo_colab.json,
// encola en /prompt, polea /history y baja la imagen final a public/imagenes/.
//
// Uso:
//   node cc_diplo.js "tu prompt aca"
//   node cc_diplo.js "tu prompt" --seed 1234 --steps 8 --cfg 1 --w 1024 --h 640
//   node cc_diplo.js "tu prompt" --url https://xxxx.trycloudflare.com   (override URL)
//
// Salida: imprime la ruta del PNG bajado (y el filename en Colab).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function arg(flag, def) {
    const i = process.argv.indexOf(flag);
    return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}

const prompt = process.argv[2];
if (!prompt || prompt.startsWith('--')) {
    console.error('Falta el prompt. Uso: node cc_diplo.js "tu prompt" [--seed N --steps N --cfg N --w N --h N --url URL]');
    process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const baseUrl = (arg('--url', cfg.comfyUrl) || '').replace(/\/$/, '');
if (!baseUrl) { console.error('No hay comfyUrl en config.json ni --url'); process.exit(1); }

const seed = Number(arg('--seed', Math.floor(Math.random() * 1e15)));
const steps = Number(arg('--steps', 8));
const cfgScale = Number(arg('--cfg', 1.0));
const width = Number(arg('--w', 1024));
const height = Number(arg('--h', 640));
const denoise = Number(arg('--denoise', 1.0));
const neg = arg('--neg', 'blurry, ugly, low quality, deformed hands, extra limbs, text, watermark');
const loraName = arg('--lora', null);
const loraStrength = Number(arg('--lora-str', 0.8));

const mod = baseUrl.startsWith('https') ? https : http;

function req(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(baseUrl + urlPath);
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method,
            headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        };
        const r = mod.request(opts, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

function download(urlPath, dest) {
    return new Promise((resolve, reject) => {
        const u = new URL(baseUrl + urlPath);
        mod.get(u, (res) => {
            if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
            const f = fs.createWriteStream(dest);
            res.pipe(f);
            f.on('finish', () => f.close(() => resolve(dest)));
        }).on('error', reject);
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow_diplo_colab.json'), 'utf8'));
    wf['6'].inputs.text = prompt;
    wf['7'].inputs.text = neg;
    wf['3'].inputs.seed = seed;
    wf['3'].inputs.steps = steps;
    wf['3'].inputs.cfg = cfgScale;
    wf['3'].inputs.denoise = denoise;
    wf['13'].inputs.width = width;
    wf['13'].inputs.height = height;

    if (loraName) {
        wf['90'] = {
            inputs: {
                lora_name: loraName,
                strength_model: loraStrength,
                strength_clip: 1.0,
                model: ['16', 0],
                clip: ['28', 0]
            },
            class_type: 'LoraLoader',
            _meta: { title: 'LoRA (cc_diplo)' }
        };
        wf['3'].inputs.model = ['90', 0];
        wf['6'].inputs.clip = ['90', 1];
        wf['7'].inputs.clip = ['90', 1];
        console.log(`-> LoRA: ${loraName} @ ${loraStrength}`);
    }

    console.log(`-> Colab: ${baseUrl}`);
    console.log(`-> prompt: "${prompt}"  seed=${seed} steps=${steps} cfg=${cfgScale} ${width}x${height}`);

    const q = await req('POST', '/prompt', { client_id: 'cc_diplo', prompt: wf });
    let pid;
    try { pid = JSON.parse(q.body).prompt_id; } catch (e) {}
    if (!pid) { console.error('No se encolo. Respuesta:', q.body.slice(0, 400)); process.exit(1); }
    console.log(`-> encolado: ${pid}`);

    for (let i = 0; i < 150; i++) {
        await sleep(5000);
        const h = await req('GET', '/history/' + pid);
        let hist; try { hist = JSON.parse(h.body); } catch (e) { continue; }
        const entry = hist[pid];
        if (!entry) { process.stdout.write('.'); continue; }
        const status = entry.status || {};
        const outputs = entry.outputs || {};
        let imgs = (outputs['86'] && outputs['86'].images) || null;
        if (!imgs) for (const k of Object.keys(outputs)) { if (outputs[k].images && outputs[k].images.length) { imgs = outputs[k].images; break; } }
        if ((status.completed || status.status_str === 'success') && imgs && imgs.length) {
            const img = imgs[imgs.length - 1];
            const dest = path.join(__dirname, 'public', 'imagenes', img.filename);
            const sub = img.subfolder || '';
            await download(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(sub)}&type=${encodeURIComponent(img.type)}`, dest);
            console.log(`\nOK -> ${dest}  (Colab: ${img.filename})`);
            process.exit(0);
        }
        if (status.status_str === 'error') { console.error('\nComfyUI reporto error.'); process.exit(1); }
    }
    console.error('\nTimeout esperando la imagen.');
    process.exit(2);
})();
