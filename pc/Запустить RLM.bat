@echo off
title Roleplay Machine
cd /d "%~dp0"

rem Проверяем не папку node_modules, а САМ бинарник оболочки: у Electron 43 в пакете нет postinstall,
rem поэтому npm ставит только обёртку, а electron.exe не появляется. Качаем его вторым шагом сами.
rem Файл сохранён в кодировке DOS: cmd читает батник ею, и UTF-8 превращался в мусор и ошибки.
if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo Первый запуск: ставлю оболочку приложения.
    echo Она весит около 200 МБ, это займёт несколько минут. Окно не закрывай.
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [!] npm не смог поставить зависимости. Проверь, установлен ли Node.js и есть ли интернет.
        pause
        exit /b 1
    )

    if not exist "node_modules\electron\dist\electron.exe" (
        echo.
        echo Скачиваю саму оболочку Electron...
        call node "node_modules\electron\install.js"
    )

    if not exist "node_modules\electron\dist\electron.exe" (
        echo.
        echo [!] Оболочка не скачалась, обычно это оборванная связь.
        echo     Запусти этот файл ещё раз: уже скачанное заново не качается.
        pause
        exit /b 1
    )
    echo.
    echo Готово, запускаю...
)

call npm start

if errorlevel 1 (
    echo.
    echo [!] Приложение завершилось с ошибкой.
    pause
)
