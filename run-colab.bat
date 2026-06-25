@echo off
title ComfyWeb (UI propia) -> ComfyUI en COLAB (Cloudflare)
cd /d "%~dp0"

REM ============================================================
REM   UI propia apuntando al ComfyUI de COLAB (GPU T4 gratis).
REM
REM   ANTES de abrir esto:
REM   1) Prende el notebook de Colab y corre la celda con
REM      cloudflared (pycloudflared). Copia la URL que imprime:
REM         >>> URL PARA TU UI: https://xxxx.trycloudflare.com
REM   2) Esa URL CAMBIA cada vez que reinicias el notebook.
REM
REM   Cuando abra la UI (http://localhost:8085):
REM   - Click en "Colab (Cloudflare)", pega la URL nueva y
REM     "Guardar y Conectar" (no hace falta reiniciar este server).
REM   - Workflow recomendado: "Z-Image (Colab)".
REM ============================================================

REM Las imagenes generadas se sirven desde este mismo server local
set IMAGE_BASE_URL=http://localhost:8085

echo ============================================================
echo   ComfyWeb (UI propia) - backend: ComfyUI en COLAB
echo.
echo   Abrila en el navegador:  http://localhost:8085
echo   Pega la URL *.trycloudflare.com en "Colab (Cloudflare)".
echo ============================================================
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:8085"

node server.js

echo.
echo El servidor se detuvo.
pause
