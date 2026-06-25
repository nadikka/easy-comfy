@echo off
title ComfyWeb (UI propia) -> ComfyUI LOCAL en GPU AMD/ZLUDA
cd /d "%~dp0"

REM ============================================================
REM   UI propia apuntando al ComfyUI LOCAL (GPU AMD via ZLUDA).
REM   Requisito: tener corriendo ComfyUI-Zluda (ComfyZLUDA.bat)
REM   en http://localhost:8188 ANTES de abrir esto.
REM
REM   En la UI elegi el workflow "Z-Image GGUF (local)".
REM ============================================================

REM Las imagenes generadas se sirven desde este mismo server local
set IMAGE_BASE_URL=http://localhost:8085

echo ============================================================
echo   ComfyWeb (UI propia) - backend: ComfyUI LOCAL (GPU/ZLUDA)
echo.
echo   Abrila en el navegador:  http://localhost:8085
echo   (Asegurate que ComfyUI-Zluda este corriendo en :8188)
echo ============================================================
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:8085"

node server.js

echo.
echo El servidor se detuvo.
pause
