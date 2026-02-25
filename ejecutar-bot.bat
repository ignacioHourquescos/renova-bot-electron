@echo off
chcp 65001 >nul
title Renova Bot - WhatsApp
color 0A

echo.
echo ========================================
echo    RENOVA BOT - WHATSAPP
echo ========================================
echo.

REM Cambiar al directorio donde está el script (directorio del proyecto)
cd /d "%~dp0"

REM Verificar si se pasó el parámetro para limpiar credenciales
if "%1"=="--reset" (
    echo [INFO] Limpiando credenciales de autenticacion...
    if exist "auth_info" (
        rmdir /s /q "auth_info"
        echo [OK] Credenciales eliminadas. Se generara una nueva sesion.
    ) else (
        echo [INFO] No hay credenciales para eliminar.
    )
    echo.
)

REM Verificar que estamos en el directorio correcto
if not exist "package.json" (
    echo [ERROR] No se encontro package.json en el directorio actual.
    echo [ERROR] Asegurate de ejecutar este archivo desde la carpeta del proyecto.
    echo.
    echo Directorio actual: %CD%
    echo.
    echo Presiona cualquier tecla para salir...
    pause >nul
    exit /b 1
)

REM Verificar si existe node_modules
if not exist "node_modules" (
    echo [INFO] Instalando dependencias por primera vez...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Error al instalar dependencias.
        echo Presiona cualquier tecla para salir...
        pause >nul
        exit /b 1
    )
    echo.
    echo [OK] Dependencias instaladas correctamente.
    echo.
)

echo [INFO] Iniciando el bot...
echo.
echo ========================================
echo    ESCANEA EL CODIGO QR CON WHATSAPP
echo ========================================
echo.
echo Instrucciones:
echo 1. Abre WhatsApp en tu celular
echo 2. Ve a Configuracion ^> Dispositivos vinculados
echo 3. Toca "Vincular un dispositivo"
echo 4. Escanea el codigo QR que aparece abajo
echo.
echo ========================================
echo.

REM Ejecutar el bot en modo desarrollo
call npm run dev

REM Si el bot se cierra, mantener la ventana abierta para ver errores
if errorlevel 1 (
    echo.
    echo [ERROR] El bot se ha cerrado con un error.
    echo.
    echo Presiona cualquier tecla para salir...
    pause >nul
)

