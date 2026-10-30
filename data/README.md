# data/

Datové soubory, které jdou do prohlížeče. **Každý z nich vyrábí nástroj
z `../tools/` z originálu** — žádný se needituje ručně a žádný neobsahuje
číslo, které by někdo odhadl.

| soubor | co v něm je | dělá ho | doloženo |
|---|---|---|---|
| `screen.json` | `title`: ★ **bajty programu `$DA30`–`$E515`**, zabalená úvodní obrazovka, kterou rozbalí převod `$D9D8` (`app/screenComposer.js` `unpack`) | `tools/mkscreen.py` | `tools/matchscreen.mjs` — **21 150 kontrol, 0 rozdílů** |
| `world.json` | ★ **místnosti z programu**: 13 úseků paměti originálu (tabulka 245 místností `$EC54`, proudy `$61A8`, záznamy místností `$2A` a výš, 32 bloků `$9A00`, šipky `$C620`), přesně co stavba místnosti čte; popis `../sources/docs/world.md` | `tools/dumpworld.py` (úseky z `tools/traceworld.py`) | `tools/matchworld.mjs` — **245 místností, 15 392 367 kontrol, 0 rozdílů** (stavba a entity po `$9629`) |
| `memory.json` | ★ **paměť menu ve chvíli startu hry** (`$74F3`, M5) pro `app/bobbyLogic.js` ve workeru: 33 úseků paměti originálu (5 668 B) — proměnné, tabulky entit a sprity velké koule (M4), sprity, font a jména bratrů (sprity, font a tabulky fyziky celé), operandy samomodifikovaného kódu; co převod čte dřív, než zapíše — od nové hry (`BobbyLogic.newGame`, `$7D87`: obrazovku, buffer scény a mapu si postaví sám) přes všechny záznamy; mimo to, co už má `world.json`; z ROM jen **jeden bajt `$16A8`** (`rom`), který čte `$7E99` chybou originálu (`../sources/docs/physics.md` §10) | `tools/mkmemory.mjs` (z `build/trace/*/init.bin`, `tools/tracephysics.py`) | `tools/matchphysics.mjs --from-data` — **165 záznamů (56 bez záplaty), 83 686 průchodů, 2 919 817 933 kontrol, 0 rozdílů**; `tools/runworker.mjs` |
| `loading.json` | loading screen z kazety (obrazovka na konci nahrávání, `bblib.memory_image()`) a `order`: ★ **pořadí, v jakém ho zavaděč Alkatraz odkrývá** (offset ve videopaměti pro každý z 6714 bajtů obrázku v bloku 4) | `tools/mkscreen.py` | `tools/matchtape.mjs`, `tools/matchloading.py` |
| `tape.json` | scénář pro LOAD TAPE: čtyři bloky kazety v jejím pořadí, časování (turbo: pilot 2143 / 2144 T, sync 674/674, bity 561/1122), bajty **jak jdou po pásce**, všechny celé; `eventBytes` (u bloku 4 událost po každém bajtu), `pictureBytes` | `tools/mktape.py` | `tools/matchtape.mjs` — **79 892 kontrol, 0 rozdílů** |
| `overlay.json` | ★ **co zavaděč kreslí během bloku 4** na řádky 22–23: běžící text `FROM THE EDGE ......` a počítadlo do nuly. Po každém bajtu bloku, kde se kreslení změnilo (2735 změn od bajtu 1363), stav všech 261 bajtů těch buněk; zlib + base64 (175 KB) | `tools/traceoverlay.py` (simulované nahrání pulz po pulzu) | `tools/matchtape.mjs`: celý blok 4 = obrazovka na vstupu do hry |

## ★ Žádná obrazovka není fotka

Úvodní skládá převod rutiny originálu `$D9D8` z bajtů programu: běh nul
(16bitový počet), běh literálů (8bitový počet a bajty), dokud adresa
nedojde na `$5B00`. Herní obrazovku staví od startu hry převod `$7D87`
(M5: buffer, místnost `$00` z `world.json` převodem `$7935`, panel,
pořadí bratrů generátorem `$F260`) a od prvního průchodu kreslí převod
hlavní smyčky; `memory.json` nese jen, co ten kód čte.

## Zvuk

★ Zvuk žádná data nepotřebuje: obsluha přerušení `$FB08` běží jako převod
(`app/beeperPlayer.js`) nad touž pamětí, tabulky efektů (`$FBF3`, `$FC4D`…)
jsou v ní (`memory.json` je má jako čtené bajty). Server posílá jen soubory,
které existují (`../db/appData.php`).
