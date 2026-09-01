# RLM в Termux

```
pkg update -y && pkg install -y git nodejs
git clone --depth 1 https://github.com/Leosmaru/rlm
cd rlm/termux && bash install-termux.sh
```

Дальше запуск одной командой:

```
rlm
```

Холст откроется в браузере телефона: `http://127.0.0.1:8100/rlm/`
(браузер запускается сам, если стоит `pkg install -y termux-api`).

Всё как на ПК, кроме озвучки — голосовой сервис на телефон не ставится.

Если `rlm` не найден — значит установка ещё не проходила: выполни блок выше целиком.
