// Asistente de preguntas: cada checkbox despliega/oculta una sección (= conecta/desconecta
// sus nodos del workflow) y suma "peso" estimado. Se compone con la lógica de data-modes:
// una sección se ve solo si el modo la permite (data-hidden=0) Y el wizard la prendió (data-wiz).

(function () {
    // Secciones que el wizard controla. Por defecto APAGADAS (progressive disclosure):
    // el usuario arranca con lo mínimo (prompt + generar) y va sumando lo que necesita.
    // onOff: limpieza cuando se apaga la pregunta, para que el nodo no se mande por error.
    const WIZ = [
        { input: 'wizLora', target: 'sec-lora', onOff: () => {
            const u = document.getElementById('useLora'); if (u) u.checked = false;
        }},
        { input: 'wizCn', target: 'sec-cn', onOff: () => {
            const r = document.getElementById('refImage'); if (r) r.value = '';
            const f = document.getElementById('refImageFile'); if (f) f.value = '';
            const i = document.getElementById('useImg2img'); if (i) i.checked = false;
        }},
        { input: 'wizUpscale',  target: 'sec-upscale' },
        { input: 'wizAdvanced', target: 'sec-ksampler' },
        { input: 'wizQwen', target: 'sec-qwen', onOff: () => {
            const h = document.getElementById('qwenImage'); if (h) h.value = '';
            const f = document.getElementById('qwenFile'); if (f) f.value = '';
        }},
        { input: 'wizQwenEdit', target: 'sec-qwen-edit', onOff: () => {
            const h = document.getElementById('editImage'); if (h) h.value = '';
            const f = document.getElementById('editFile'); if (f) f.value = '';
            const i = document.getElementById('editInstruction'); if (i) i.value = '';
        }}
    ];

    function setSectionWiz(targetId, on) {
        const sec = document.getElementById(targetId);
        if (sec) sec.setAttribute('data-wiz', on ? 'on' : 'off');
    }

    function updateWeight() {
        let total = 0;
        WIZ.forEach(w => {
            const cb = document.getElementById(w.input);
            if (cb && cb.checked) total += Number(cb.getAttribute('data-cost') || 0);
        });
        // Escala: 0 = liviano, 11 = máximo (LoRA1 + CN3 + Upscale3 + Qwen1 + QwenEdit3)
        const pct = Math.min(100, Math.round((total / 11) * 100));
        const bar = document.getElementById('wizBar');
        const label = document.getElementById('wizWeightLabel');
        if (bar) bar.style.width = pct + '%';
        if (label) {
            let txt = 'liviano', color = '#2e7d32';
            if (total >= 5) { txt = 'pesado'; color = '#c62828'; }
            else if (total >= 2) { txt = 'medio'; color = '#e08600'; }
            label.textContent = txt;
            label.style.color = color;
        }
    }

    function applyOne(w) {
        const cb = document.getElementById(w.input);
        if (!cb) return;
        setSectionWiz(w.target, cb.checked);
        if (!cb.checked && typeof w.onOff === 'function') w.onOff();
        updateWeight();
    }

    document.addEventListener('DOMContentLoaded', () => {
        WIZ.forEach(w => {
            const cb = document.getElementById(w.input);
            if (!cb) return;
            setSectionWiz(w.target, cb.checked); // estado inicial (todas off)
            cb.addEventListener('change', () => applyOne(w));
        });
        updateWeight();
    });
})();
