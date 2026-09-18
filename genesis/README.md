# GÉNESIS

Una simulación de vida artificial y civilización emergente que corre entera en tu Mac.

Decenas o cientos de seres digitales nacen en un mundo con estaciones, escasez y clima. Tienen cuerpo (sed, hambre, frío, descanso), necesidades sociales (compañía, estima) y una necesidad existencial (**sentido**) que cae cuando presencian cosas que no entienden. Recuerdan, planean, conversan, se alían, comercian, inventan, crean arte, forman pareja, tienen hijos, envejecen y mueren. Nada de lo social está programado: las tribus, los líderes, la moneda, las religiones, las leyes y las guerras **emergen** de la física del mundo, de la memoria de los seres y de lo que se dicen. El motor solo las *reconoce* y las anota en la Crónica.

Vos sos el observador: un dashboard local muestra el mapa en vivo, deja leer el diario y los pensamientos de cualquier ser, muestra las instituciones que van apareciendo y te permite intervenir (susurrar, milagros, desastres) o solo mirar.

## Cómo funciona, en dos párrafos

Cada ser tiene dos sistemas de cognición. **System 1** es reflejo puro, sin modelo de lenguaje: cada tick (10 minutos simulados) elige la acción de mayor utilidad para sobrevivir: comer, beber, dormir, abrigarse, juntar, huir, charlar, trocar. **System 2** es el cerebro: llamadas escasas y presupuestadas a un modelo (Claude, Ollama o un mock determinista) que planifican el día, reflexionan al dormir, escriben las conversaciones, reaccionan a lo que sacude, crean arte e inventos, y en los líderes, gobiernan. Cada llamada devuelve JSON validado que el motor convierte en acciones; el texto libre queda como diario y habla. La memoria es un flujo de observaciones con importancia, recuperadas por recencia, importancia y relevancia.

Todo lo que pasa es un evento en SQLite, con snapshots diarios: la historia se reproduce, se audita, se bifurca y se poda. Los hijos heredan genes (con mutación) y un *genoma cultural*: un fragmento de prompt que resume lo que sus padres aprendieron. Un Historiador escribe capítulos cada siete días y un Bardo compone epopeyas para los muertos que dejaron huella.

## Requisitos

- macOS (Apple Silicon o Intel) o Linux. Node.js **22 o más nuevo** (`brew install node` o `nvm use`; hay un `.nvmrc`).
- Para el cerebro Claude: una cuenta de Anthropic con `ant auth login`, o la variable `ANTHROPIC_API_KEY`. Sin clave, el mundo corre igual con `--brain mock`.
- Opcional: [Ollama](https://ollama.com) con un modelo local (por defecto `qwen3:14b`) para el modo `ollama` o `hybrid`.

## Instalación

```bash
cd genesis
npm install
npm run doctor        # verifica Node, SQLite y la clave
```

`better-sqlite3` trae binarios precompilados para macOS; si por algún motivo no carga, el motor cae solo a `node:sqlite` (incluido en Node 22).

## Arranque rápido

```bash
# 1. crear un mundo (seed reproducible, 40 seres, grilla de 128×128)
npm run genesis -- new --name eden --seed 42 --agents 40

# 2. correrlo con dashboard (servidor + Vite) sin gastar un centavo
GENESIS_BRAIN=mock npm run dev
#    → http://localhost:5173

# 3. o con Claude (Haiku 4.5 rutinario + Fable 5.1 épico), preset "crónica"
GENESIS_BRAIN=claude npm run dev
```

Para dejarlo corriendo sin Vite, compilá el dashboard una vez y serví todo desde el mismo puerto:

```bash
npm run build
npm run serve -- --name eden --brain claude --preset cronica
#    → http://127.0.0.1:7777
```

`Ctrl-C` guarda un snapshot y cierra limpio. Si el proceso muere de golpe, el mundo reanuda desde el último snapshot diario (y los segundos posteriores se vuelven a simular).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run genesis -- new --name eden --seed 42 --agents 40 --size 128 [--config archivo.json]` | crea un mundo |
| `npm run serve -- --name eden [--brain mock\|claude\|ollama\|hybrid\|none] [--preset cronica] [--port 7777] [--paused]` | corre el mundo con API y dashboard |
| `npm run dev` | servidor + dashboard de Vite (variables `GENESIS_WORLD`, `GENESIS_BRAIN`, `GENESIS_PORT`) |
| `npm run sim -- --name eden --days 30 --brain mock` | corre N días sin interfaz, a máxima velocidad |
| `npm run genesis -- inspect --name eden --agent 3` | muestra un ser: necesidades, rasgos, mochila, memorias |
| `npm run replay -- --name eden --from 0 --verify` | reproduce la historia grabada y compara las huellas diarias |
| `npm run genesis -- fork --name eden --at 4320 --as eden-rama` | bifurca el mundo en un tick (un "¿qué hubiera pasado si…?") |
| `npm run genesis -- prune --name eden` | pliega memorias viejas y borra eventos triviales |
| `npm run brain:check [-- --epochal]` | prueba el cerebro real: JSON válido, tokens y lectura de caché |
| `npm run cost -- --name eden` | resume el gasto en tokens y dólares |
| `npm run doctor` | verifica el entorno |

Los mundos viven en `./worlds/<nombre>/` (`world.sqlite` + `snapshots/`); cambiá la carpeta con `--worlds` o `GENESIS_WORLDS`.

## Ritmo, costo y presupuesto

Con un cerebro real, el mundo no corre "a ticks por segundo": corre a **segundos reales por día simulado**, porque cada día cuesta llamadas. Los presets se cambian en vivo desde el dashboard.

| Preset | Real por día simulado | Densidad cognitiva | ≈ US$/día simulado (50 seres) |
|---|---|---|---|
| `contemplativo` | ~1 h | ~3 llamadas por ser y día | ~1.2 |
| `cronica` (por defecto) | 10 min | ~0.5 llamadas por ser y día | ~0.4 |
| `local` | 10 min | Ollama para lo rutinario, Claude solo para lo épico | ~0.3 |
| `mock` | máxima | sin modelo | 0 |

Estimaciones con Haiku 4.5 para lo rutinario (US$1/5 por millón de tokens, lectura de caché a 0.1×) y Fable 5.1 para lo épico (US$10/50, lectura de caché a 0.025×). El prefijo de cada llamada (leyes del mundo + guía + ficha del ser) supera los 4096 tokens para que Haiku lo cachee; `npm run brain:check` lo verifica con una llamada real y muestra `cache_read`.

Hay tres topes duros en `budget`: por día simulado, por hora real y total. Al superarlos el cerebro se "silencia" (los seres viven solo con System 1, una edad oscura) y el dashboard lo avisa. Además, **pensar cuesta calorías**: cada llamada descuenta un poco de hambre, así que en una hambruna se piensa menos.

## El dashboard

- **Mapa**: terreno, recursos, construcciones, territorios de las tribus, día/noche y clima. Zoom con la rueda, arrastrar para mover, clic para elegir un ser.
- **Ser**: necesidades, rasgos, mochila, plan del día, **Mente** (memorias, diario, búsqueda), **Relaciones** (grafo), **Conversaciones**, **Familia**, **Pensamientos** (las respuestas literales del modelo).
- **Sociedad**: tribus y líderes, economía (moneda detectada, precios, Gini), creencias y religiones, tecnología descubierta, textos y epopeyas, leyes y crímenes.
- **Crónica**: hitos ("el primer fuego", "la primera moneda"…), épocas y los capítulos del Historiador. Replay para ver el mundo en un día pasado.
- **Métricas**: población, nacimientos y muertes, necesidades, Gini, gasto en dólares.
- **Dios**: pausa y velocidad, susurro, profeta, abundancia, desastres (tormenta, sequía, plaga, terremoto, eclipse, diluvio), clima, sanar, resucitar, fulminar, teletransportar, aparecer seres.

## El Bloque Génesis (configuración)

Las leyes del mundo viven en `genesis.config.example.json` (copialo y pasalo con `--config` al crear el mundo; quedan grabadas dentro del mundo). Las claves importantes:

- `world`: tamaño de la grilla, población inicial, `abundance` (0.5 mundo pobre, 2 abundante).
- `time`: un día tiene 144 ticks de 10 minutos; estación de 8 días; año de 32 días.
- `life`: edades de adultez, fertilidad, vejez y máxima; gestación; enfermedad.
- `needs`: decaimiento por tick de cada necesidad y daño por hora cuando una vital llega a cero.
- `resources` y `climate`: regeneración por estación, tormentas, sequías, temperaturas.
- `brain`: modo (`mock`, `claude`, `ollama`, `hybrid`, `none`), modelos por ruta (`routine` y `epochal`), concurrencia, cupos por ser, umbral de reflexión, cada cuántos días escribe el Historiador.
- `budget` y `pacing`: topes en dólares y ritmo.
- `persistence`: cada cuántos ticks se guarda snapshot, retención y poda.

## Los poderes divinos y el replay

Cada acto de dios se graba como evento con su carga completa, así que la historia sigue siendo reproducible. `npm run replay -- --verify` vuelve a simular desde un snapshot reaplicando las decisiones grabadas de los seres y los actos de dios, y compara la huella diaria del estado con la grabada. Con el cerebro `mock` las huellas coinciden exactamente; con un modelo real las decisiones se reaplican en el tick más cercano y la reproducción es aproximada (el mundo es determinista, las mentes no).

`fork` copia el mundo en un tick a otro nombre con su propia seed derivada: dos historias que divergen desde el mismo día. `prune` pliega las observaciones viejas y poco importantes en resúmenes diarios (los seres siguen recordando lo importante) y recorta lo trivial; el servidor lo hace solo una vez por semana simulada.

## Tests

```bash
npm test          # motor, cerebro con mock, sociedad, vida, dios, replay, API y WebSocket
npm run typecheck # los cuatro paquetes
```

El test de humo del dashboard está en `packages/dashboard/smoke/smoke.mjs` (Playwright).

## Estructura

```
genesis/
  packages/protocol   tipos del cable (WebSocket y REST)
  packages/engine     mundo, System 1, cerebro (System 2), memoria, sociedad, vida, persistencia
  packages/server     runner con ritmo, API REST, WebSocket, CLI
  packages/dashboard  Vite + React + canvas (God Mode)
  worlds/             mundos guardados (ignorados por git)
```

## Límites conocidos

- Las tribus, los líderes, la moneda y las religiones se detectan con heurísticas; son señales, no verdades. Los umbrales están en `packages/engine/src/society/`.
- Con un modelo real, el replay es aproximado; con `mock` es exacto.
- Los costos de la tabla son estimaciones: `npm run cost` muestra lo real.
- Un mundo de 128×128 con 100 seres genera ~120 MB por 30 días simulados sin poda; la poda semanal lo mantiene acotado.
- Fable 5.1 puede rechazar alguna llamada por sus clasificadores de seguridad; el fallback de servidor la reenruta y, si igual falla, el ser simplemente calla ese turno.
