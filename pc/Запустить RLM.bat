@echo off
chcp 65001 >nul
title Roleplay Machine
cd /d "%~dp0"

rem Проверяем не папку node_modules, а САМ бинарник оболочки: с Electron 43 пакет ставится без него.
rem В его package.json больше нет postinstall — npm кладёт только обёртку и рапортует «added N packages»,
rem а electron.exe не появляется. Поэтому установщик оболочки зовём руками, следующей строкой.
if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo Первый запуск: ставлю оболочку приложения.
    echo Она весит около 200 МБ — это займёт несколько минут. Окно не закрывай.
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
        echo [!] Оболочка не скачалась — обычно это оборванная связь.
        echo     Запусти этот файл ещё раз: уже скачанное не качается заново.
        pause
        exit /b 1
    )
    echo.
    echo Готово. Запускаю...
)

call npm start

if errorlevel 1 (
    echo.
    echo [!] Приложение завершилось с ошибкой.
    pause
)
