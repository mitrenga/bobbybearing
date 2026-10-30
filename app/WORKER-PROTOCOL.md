# Protokol mezi `gameModel.js` a `gameWorker.js`

Worker drží hru a tiká. Model do něj posílá jen vstupy a kreslí to, co
dostane zpátky (R-037: kreslí se na zprávu `frame`, smyčka modelu je
záloha).

## Stav: M3 rozpracovaná

**Worker hraje hru originálu**: drží jeho paměť, 64 KB rozložených jako
ve stroji (`data/world.json` a `data/memory.json` nad nulami,
`BobbyLogic.composeMemory`), a každý průchod pustí převod hlavní smyčky
`$751E` (`bobbyLogic.js`, `../sources/docs/physics.md`). Hra startuje
z paměti originálu na začátku prvního průchodu: místnost `$00` s panelem.
`../tools/matchphysics.mjs --from-data` pustí záznamy originálu z týchž
dat a po každém průchodu najde tutéž paměť; `../tools/runworker.mjs`
porovná obrazovku workeru se záznamem originálu bez kláves po každém
z 200 průchodů.

? Co ještě převedené není (pauza originálu a konec času M5, zařízení typů
3 a 7, která žádná místnost nemá), hru zastaví: worker pošle `stopped`
a model to napíše do spodku rámečku.

## ★ Jedny hodiny: průchod hlavní smyčky

`../sources/docs/disasm_notes.md` §4: hlavní smyčka originálu **na snímek
nečeká** — práce, zpoždění `$7648` podle počtu valících se koulí
(2× / 1× / 0×) a zvukové efekty v obsluze přerušení. Průchod trvá 1,5–2,2
snímku, v celé partii průměrně 39,24 ms. **Remake to nesimuluje**
(rozhodnutí operátora 2026-10-29, jako Booty): průchod každých
**`PASS_MS`** ms, konstantně (nejdřív 40 ms; **35 ms rozhodnuté 2026-10-30** — operátorovi nejlépe srovnatelné s originálem, 30 ms zkoušeno). Čas na panelu v originálu ubývá jednou
za průchod (`$7404`), takže délka hry vyjde jako průměr originálu.

Worker tiká **rekurzivním `setTimeout` s akumulátorem** (R-046,
`setInterval` nikde), nejvýš čtyři průchody naráz po výpadku.

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, world, memory, seed, hiScore}` | start nové hry: ★ paměť menu z dat a `BobbyLogic.newGame` (`$D969` → `$7D87`, M5) — pořadí bratrů losuje generátor originálu nad `$EE7F`/`$EE80`; `seed` (číslo, 16 bitů) se do něj zapíše před losováním, bez něj losuje z dat (vždy stejně). `world` = obsah `data/world.json`, `memory` = obsah `data/memory.json` (bez nich odpoví `error`). `headless: true` tiká jen na vyžádání zprávou `tick` (pro `tools/runworker.mjs`). |
| `controls` | `left`, `right`, `up`, `down`, `cheat` (boolean) | úplný stav ovládání; posílá se při každé změně a **celý**; neznámé klíče se zahodí. |
| `pause` | – | zastaví hodiny. |
| `continue` | – | rozjede je; bez předchozí `pause` neudělá nic (dvoje hodiny naráz by tikaly dvakrát rychleji). |
| `tick` | – | jeden průchod v režimu `headless`. |
| `reset` | – | zahodí stav a zastaví hodiny. |

★ **Ovládání originálu jsou čtyři směry** — bity Kempstonu vpravo, nahoru,
dolů, vlevo, na které se převede každá volba ovládání (`$FDF6`,
`../sources/docs/hw_notes.md`) — a `Q` CHEAT. Fire originál nečte. Pauza
(`SPACE` v originálu) a ztlumení do workeru nechodí.

★ **Do převodu jdou jako hodnoty portů klávesnice** (`BobbyLogic.keyboardPort`):
paměť na startu má ovládání KEYBOARD (`$FEE7` = 0), takže nahoru je klávesa
horní řady `P`, dolů prostřední `L`, vlevo a vpravo spodní `Z` a `X`, CHEAT
je `Q` (a tím i klávesa horní řady, jako v originálu). Port bez stisku dává
`$BF` jako v záznamech.

### ★ Náhoda

Průchod hlavní smyčky **žádný zdroj náhody nemá** (bez `LD A,R`, `FRAMES`
a tabulek z ROM, `../sources/docs/hw_notes.md`). ★ Start hry losuje pořadí
bratrů generátorem `$F260` nad `$EE7F`/`$EE80` (`physics.md` §12); v originálu
je jeho stav, co tam minulá partie nechala — v paměti přežívá, worker ale
paměť staví pro každou hru znovu z dat. **Rozhodnuto 2026-10-30
(operátor, varianta 2):** `seed` v `init` se zapíše do `$EE7F`/`$EE80` před
losováním; model dává první hře po načtení stránky `Date.now() & 0xFFFF`
(mimo simulaci) a každé další stav, se kterým minulá partie skončila
(`generator` v každém snímku), jako by to byla paměť originálu. Stejný
`seed` = stejná partie (`runworker`). `Math.random()` se nepoužívá.

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `frame`, `pass`, `outcome`, `controls`, `sounds[]`, `score`, `generator`, `screen` | jeden průchod. Posílá se po každém průchodu a jako odpověď na `init`. ★ `outcome` je `pass`, nebo jak hra skončila (M5): `won` (všichni doma, `$7CE5`), `lost` (doma s jedním ztraceným), `timeout` (konec času `$7494`), `quit` (`1`+`4` v pauze originálu); poslední snímek nese koncovou obrazovku `$7D06` a hodiny stojí — model ji nechá ≈ 7 s jako originál (`$7D3D`) a jde do menu, které stojí za obrazovkou ovládání originálu (`$71BB`). |
| `stopped` | `pass`, `message` | ? hra došla na místo originálu, které ještě není převedené (`unported $8F6E: …`); hodiny stojí, poslední obrazovka zůstává. |
| `error` | `message` | chybějící data. |

- `frame` = `pass` — průchody od startu; čítač, ze kterého model odečítá
  třetí číslo FPS (R-045)
- `generator` — ★ stav generátoru pořadí bratrů `$EE7F | $EE80 << 8` po
  průchodu: model si ho nechá jako `seed` další hry
- `score` — **skóre remaku** (M7, operátor 2026-10-30; originál žádné
  nemá): `{brothers, rooms, time}` odečtené z paměti originálu po každém
  průchodu, do paměti se nic nezapisuje (`score()` ve workeru,
  `app/gameScore.js`). `brothers` = bratři doma (`5 − $FE35` bez
  ztracených, `$FF` v `$FEF0`–`$FEF4`), `rooms` = jedinečné místnosti
  (`$FE4F`) bez startovní `$00`, `time` = uplynulý herní čas
  jako vlastní počítadlo tiků hodin originálu (`BobbyLogic.timeTicks`:
  +1 za každý tik `$7404`, osm na jednotku poslední číslice panelu; +1000
  za bratra doma `$7E8F` se nepočítá) ve chvíli **posledního pokroku**
  (nová místnost nebo bratr doma); obrazovky ukazují `time / 8` zaokrouhlené na pět míst. Řazení síně
  slávy: bratři ↓, místnosti ↓, čas ↑.
- `screen` — **6912 bajtů videopaměti** (base64) z paměti hry, po každém
  průchodu
- `sounds` — ★ **celé efekty** (M6, M7, `physics.md` §13): worker pustí
  obsluhu přerušení originálu jednou za snímek stroje (`FRAME_MS`, při
  `PASS_MS` 30 jednou až dvakrát za průchod) a za každý požadavek, který
  obsluha převezme ze slotu `$F061`/`$F062`, pošle
  `{id: 'effect', bus, value, outs: [[T, bit], …], length}` — efekt
  vyrenderovaný celý (`renderEffect`: scratch obsluha nad tabulkami efektů,
  přerušení po přerušení včetně ztracených po dlouhé obsluze, dokud kanály
  nedohrají; hrany na portu `$FE` s T od začátku efektu, délka v celých
  snímcích). `bus` je podle toho, kdo požádal (`BobbyLogic.soundRequest`):
  `game` (přechod místnosti 5, `Q` CHEAT a konec 6 — nikdy naráz), `ball`
  (dopad, náraz koulí), `brothers` (1, 4), `blocks` (výtah, drtič, průduch,
  blok 7), `bearings`. `audioManager.playFrame` každý spustí jednou zprávou
  `playSound` na jeho sběrnici (připravený zvuk jako v Manic Mineru,
  operátor 2026-10-30) — zvuk hraje vedle hry, worker ani smyčka kreslení
  do jeho časování nezasahují, a sběrnice po druzích se nepřerušují; kde
  originál střídá dva kanály v jedné obsluze, remake hraje oba celé vedle
  sebe
