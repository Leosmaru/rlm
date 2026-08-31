@echo off
title Roleplay Machine
cd /d "%~dp0"

if not exist "node_modules\" (
    echo Первый запуск: устанавливаю зависимости...
    call npm install
    if errorlevel 1 (
        echo.
        echo [!] Ошибка при npm install. Проверь, установлен ли Node.js.
        pause
        exit /b 1
    )
)

echo Запускаю Roleplay Machine...
call npm start

if errorlevel 1 (
    echo.
    echo [!] Приложение завершилось с ошибкой.
    pause
)
