# `server/pruebas` — baterías de aserciones del backend

**32 archivos.** No son pruebas unitarias con un framework: son scripts de Node que ejecutan los
**controladores reales** contra la base de datos y van imprimiendo `OK` / `FALLA`. Cada uno termina
con una línea `=== N OK · M FALLAS ===`.

Se escribieron entre agosto y septiembre de 2026 mientras se construían las rutas de reparto, el
módulo de ventas y el trabajo de campo sin internet. Vivían en una carpeta temporal; se trajeron
aquí el **2026-09-11** porque esa carpeta se borra sola.

---

## 🔴 Antes de correr nada

> **Estas pruebas ESCRIBEN en la base de datos.** Borran y reconstruyen la jornada de HOY, crean
> ventas, mueven stock y limpian lo que crean. **Jamás** contra una base que alguien esté usando:
> ya destruyeron jornadas reales dos veces.

Por eso **las 32** empiezan con `require('./_guardia-bd')`, que **se niega a arrancar**
si `server/.env` no apunta a `localhost`, o si la base se llama `postgres` (el nombre de la de
producción). No quites esa línea.

El riesgo no es teórico: la instancia `fabriapp-db-dev` de Cloud SQL acepta conexiones **desde
cualquier IP**. Un `.env` mal apuntado y una de estas pruebas borra la jornada de vendedores de
verdad.

**Para probar con datos de producción:** expórtalos, restaura la copia en local y apunta el `.env`
ahí. Nunca al revés. La receta está en `PENDING-IMPLEMENTATION.md` §4.

---

## Cómo se corren

```bash
cd server
node pruebas/prueba-venta-apartada.js      # una
npm run pruebas                            # todas, con el resumen al final
npm run pruebas -- venta                   # solo las que lleven "venta" en el nombre
```

El corredor **distingue "0 fallas" de "no arrancó"**. Es una distinción que costó caro: una prueba
que revienta al cargar no imprime total, y un bucle ingenuo la sumaba como 0 fallas — o sea, en
verde.

## Qué necesitan

- `server/.env` apuntando a una copia local y desechable.
- `server/node_modules` instalado.
- La base migrada al día (`npx sequelize-cli db:migrate`).

## Estado conocido — 3 en rojo, y ninguna es una regresión

**Última corrida completa (2026-09-11): 29 de 32 en verde, 523 aserciones.** Las tres que fallan
llevan fallando desde antes; **no se arreglaron al traerlas** para no mezclar una mudanza con un
cambio de comportamiento.

| Archivo | Qué le pasa |
|---|---|
| `prueba-paso2-venta.js` | 4 aserciones esperan que una venta se **rechace** (403/409) donde ahora se **aparta** (200 + `REGISTRADA_CON_CONFLICTO`). Es la decisión del 2026-09-09: una venta que ya no cabe se guarda apartada en vez de perderse. **Comprobado revirtiendo los controladores: falla igual.** |
| `prueba-venta-sin-inventario.js` | 4 aserciones afirman el comportamiento **anterior** (un producto inactivo ahora se aparta en vez de rechazarse, y `descuenta_central` ya está implementado) |
| `prueba-tres-modos.js` | revienta al arrancar porque la bodega de desarrollo tiene **0 existencias** y ningún usuario con bodega asignada; hay que sembrarla |

> ⚠️ **Tres baterías en rojo de serie son una deuda, no un estado aceptable.** Una suite que
> siempre tiene algo rojo enseña a no mirarla, y entonces el día que se rompa algo de verdad nadie
> lo ve. Hay que actualizar las dos primeras a lo que el sistema hace hoy y sembrar la bodega para
> la tercera.

## Cosas que costaron caro y conviene no repetir

- **⚠️ El número de aserciones de algunas baterías DEPENDE DE LOS DATOS.** `prueba-cuadre.js`
  recorre `por_vendedor` y se salta bloques cuando no hay días de relevo o visitas fuera de ruta
  (lo dice por pantalla: *"(sin dias de relevo en los datos)"*). Pasó de 39 a 34 el 2026-09-12 sin
  que nada se rompiera, solo porque el resto de la suite había cambiado la jornada de hoy.
  **Un total que baja no es necesariamente una regresión, pero tampoco es "todo bien": es menos
  comprobado.** Si baja mucho, mira qué bloque dejó de ejercerse.

- **🔴 Si matas una batería a medias, deja transacciones abiertas en Postgres** (`idle in
  transaction`) que **bloquean a las siguientes**. El síntoma es una prueba que se queda muda para
  siempre, y parece un cuelgue suyo. Para verlo:
  `SELECT pid, state, wait_event_type, query FROM pg_stat_activity WHERE datname = current_database()`.
  Se limpia con `pg_terminate_backend(pid)` sobre las que estén `idle in transaction`.
- **El corredor tiene un tope de 5 minutos por batería**, justo para que una colgada no congele la
  suite entera. Si una lo supera, sale como `NO ARRANCÓ`, que es la verdad: no llegó a dar un
  resultado.
- **Hay CUATRO formatos de línea de resumen** distintos en esta carpeta. `correr.js` los conoce
  todos; si escribes una batería nueva usa `=== N OK · M FALLAS ===`, y si usas otro, añádelo a
  `FORMATOS` — o el corredor la dará por no arrancada aunque haya pasado entera.

## Las que más pesan

| Archivo | Qué demuestra |
|---|---|
| `prueba-venta-apartada.js` | una venta que ya no cabe se guarda apartada, no se pierde; y el endpoint del supervisor la enseña aunque tenga 60 días |
| `prueba-fase1a.js` | idempotencia por `client_operation_id`, horas, día de negocio y compatibilidad con el cliente viejo |
| `prueba-cuadre.js` | el Cuadre cuadra: visitas contra ventas, por vendedor y por día |
| `prueba-dos-ventas-una-tienda.js` | una tienda puede recibir **dos ventas** en la misma parada y las dos llegan enteras al sincronizar |
| `prueba-carrera-startroute.js` | dos peticiones simultáneas de iniciar ruta dejan **una sola** jornada. ⏱️ Abre dos transacciones a la vez y **una se queda esperando a propósito**: tarda, no está colgada |
