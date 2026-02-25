@echo off
chcp 65001 >nul

REM Obtener el directorio donde está el script
cd /d "%~dp0"

REM Verificar si existe node_modules
if not exist "node_modules" (
    start /min cmd /c "npm install && npm install electron --save-dev"
    timeout /t 5 /nobreak >nul
)

REM Verificar si Electron está instalado
call npm list electron >nul 2>&1
if errorlevel 1 (
    start /min cmd /c "npm install electron --save-dev"
    timeout /t 3 /nobreak >nul
)

REM Ejecutar Electron sin mostrar consola
start "" "%~dp0node_modules\.bin\electron.cmd" .

REM Cerrar la ventana de CMD inmediatamente
exit


