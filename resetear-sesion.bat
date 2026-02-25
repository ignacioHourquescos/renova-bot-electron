@echo off
chcp 65001 >nul
title Resetear Sesion - Renova Bot
color 0E

echo.
echo ========================================
echo    RESETEAR SESION DE WHATSAPP
echo ========================================
echo.
echo Este script eliminara las credenciales actuales
echo y generara una nueva sesion de WhatsApp.
echo.
echo ADVERTENCIA: Tendras que escanear el QR nuevamente.
echo.
set /p confirmar="¿Estas seguro? (S/N): "

if /i "%confirmar%"=="S" (
    echo.
    cd /d "%~dp0"
    
    if exist "auth_info" (
        echo [INFO] Eliminando credenciales...
        rmdir /s /q "auth_info"
        echo [OK] Credenciales eliminadas correctamente.
        echo.
        echo Ahora ejecuta "ejecutar-bot.bat" para iniciar el bot
        echo y escanear el nuevo codigo QR.
    ) else (
        echo [INFO] No hay credenciales para eliminar.
    )
) else (
    echo.
    echo Operacion cancelada.
)

echo.
echo Presiona cualquier tecla para salir...
pause >nul






