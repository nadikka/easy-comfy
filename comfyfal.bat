@echo off
title ComfyWeb + fal.ai (Z-Image Turbo)
cd /d "%~dp0"

REM ============================================================
REM   COMFYWEB con backend SERVERLESS fal.ai (Z-Image Turbo)
REM   No usa GPU local, no usa ComfyUI, no apaga la PC.
REM ============================================================

REM Modo serverless (en vez de ComfyUI local)
set PROVIDER=fal

REM Modelo en fal (text-to-image Z-Image Turbo)
set FAL_MODEL=fal-ai/z-image/turbo

REM URL base de las imagenes (local). En el VPS, borra esta linea.
set IMAGE_BASE_URL=http://localhost:8085

REM === PEGA TU API KEY DE FAL ACA (https://fal.ai/dashboard/keys) ===
set FAL_KEY=PEGA_TU_KEY_ACA

if "%FAL_KEY%"=="PEGA_TU_KEY_ACA" (
  echo.
  echo  [!] Falta tu FAL_KEY.
  echo      1^) Entra a https://fal.ai/dashboard/keys y crea una clave
  echo      2^) Edita este archivo ^(comfyfal.bat^) y pegala en la linea FAL_KEY
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   COMFYWEB + fal.ai  ^(Z-Image Turbo, serverless^)
echo   Backend: fal.ai  ^(sin GPU local^)
echo.
echo   Abrila en el navegador:  http://localhost:8085
echo ============================================================
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:8085"

node server.js

echo.
echo El servidor se detuvo.
pause
