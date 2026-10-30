# Preparación local de validación remota del producto

D-P y D-S implementados localmente; no se ha ejecutado validación remota ni cerrado EPIC-002. Las configuraciones A/B conservan IDs/issuer/audience/actores pendientes y no deben desplegarse. Maps sigue siendo el predeterminado del producto fuera del modo de validación remoto.

## Prerrequisitos pendientes de ejecución real

Cuenta/zona/dominio, CA y destino exactos, cuotas reales US$0, Access Service Auth, cinco tokens sintéticos y permisos mínimos se revisan solo bajo una autorización futura. No usar dev-auth ni NODE_ENV=test/development remotamente. La identidad del actor procede de common_name de JWT verificado y configuración servidor; no de roles enviados por cliente. Esto no es autenticación académica final ni resuelve la fuente institucional de asignaciones.

## Herramientas y comprobaciones locales

Desde raíz:

```powershell
npm.cmd run typecheck:preparation -w @is488/api
npm.cmd run test:preparation -w @is488/api
```

Los tests usan transporte, perfiles, claves y respuestas sintéticos. No abren cuentas, bases o HTTP remotos. Las pruebas SQL D-S son opt-in en otro script y requieren cluster exclusivo, variables/guardas y permiso propios; una omisión no acredita SQL.

## Uso posterior del harness (requiere permisos remotos independientes)

runner.ts exporta ProductHarness y runMinimal; no hay ejecución automática por importarlo. target.ts exige metadata de destino aprobada, UUIDs sintéticos, bundle SHA y dos orígenes HTTPS distintos de la misma zona, sin workers.dev ni placeholders. El constructor recibe consentimiento técnico por runId/digest de ese destino y credenciales por actor separadas; estos campos no sustituyen aprobación humana ni validación de cuotas.

El archivo de evidencia debe estar en directorio seguro existente y ser NUEVO: creación exclusiva, plan saneado y fsync antes del primer efecto. Se rechaza una corrida existente tras reinicio; no borrar/cambiar el archivo para eludir incertidumbre. Nuevos intentos requieren revisión/consentimiento independiente. Nunca poner Client Secrets, tokens, contraseñas o URIs con credenciales en target o logs.

runMinimal ejecuta 25 peticiones de producto: tres proyectos aislados, consulta A/B, ajeno/docente sin asignación, listado filtrado, asignación explícita de operador, gestión de integrantes denegada al docente solo asignado, alta, retiro condicionado, 400/404/422, revocación y reincorporación con identidad nueva. Requiere callbacks de operador para observar proyecto+owner en snapshot independiente y aprovisionar asignación sintética: no implementa ni autoriza credenciales administrativas o SQL remoto por sí solo. Esos callbacks tienen deadline 12s, evidencia previa y presupuesto reservado; un deadline no demuestra cancelación del servidor.

Capas de control:

- Una operación en vuelo, incluyendo callbacks operador; si llega otra se rechaza y se recoge la primera con su plazo original.
- Máximo 95 solicitudes, 1200 sentencias y 30 min. Reserva inicial conservadora de 36 solicitudes de setup/auth/control y 500 sentencias. Cada petición producto reserva además dos solicitudes (HTTP más posible JWKS) y un mínimo de sentencias por ruta; lo incierto no devuelve presupuesto. El recorrido simulado cabe: 86 solicitudes y 1141 sentencias reservadas. No se afirma que esos sean consumos remotos medidos; el preflight real debe cotejar el peor caso de setup con las cuotas y detenerse si no cabe.
- HTTP/cuerpo 12s y 64 KiB; redirects rechazados; no retries de mutaciones, ni após pérdida HTTP de creación con IDs servidor desconocidos.
- Evidencia saneada antes del despacho y observaciones con status/IDs, sin cuerpos o secretos. Un 201 con cierre no confirmado conserva status/IDs y cierre separado, deteniendo efectos siguientes.
- Claim JWT mal firmado/issuer/audience/algoritmo/exp/nbf/actor incorrecto deniega antes de SQL. JWKS HTTPS fijo, 2s incluyendo cuerpo, 64 KiB y caché 5min; kid no disponible falla cerrado, sin bucles de refresco. Claves públicas cacheadas no comparten promesas de I/O entre requests.

Ninguna respuesta HTTP sola certifica atomicidad, TLS de Hyperdrive, privilegios efectivos remotos, coste Free o isolates distintos. Esas observaciones siguen pendientes. Kanban permanece volátil. No usar el harness WIP /probe ni repetir experimentos históricos.

Ver informe de preparación (evidencia histórica local excluida de esta publicación; no acredita aceptación remota) y SQL D-S (evidencia histórica local excluida de esta publicación; no acredita aceptación remota).


## Evidencia HTTP del harness (correcci?n local posterior a la corrida parcial)

`response_headers` persiste el status HTTP y comprobaciones booleanas de las cabeceras esperadas antes de leer el cuerpo. El cierre de persistencia reportado se distingue como confirmed/unconfirmed/not_reported, sin registrar cabeceras arbitrarias. Si fallan JSON, tama?o o lectura, el evento final conserva cualquier status ya recibido. Si el cuerpo JSON contiene UUIDs id/projectId, se conservan antes de rechazar status/deployment/cache incorrectos. `httpObservation=status_received` no confirma una escritura: los fallos de POST/DELETE conservan `writeOutcome=unconfirmed` y detienen nuevos efectos sin reintento. No se registran cuerpos, cookies, secretos ni mensajes arbitrarios de transporte. Los l?mites y guardas de presupuesto/plazo existentes permanecen.

La correcci?n tiene pruebas locales con transporte simulado; no recupera el status HTTP ausente en evidencia hist?rica ni acredita la ejecuci?n remota pendiente.


## Preparaci?n DNS antes de cualquier HTTP

Validar la respuesta REAL de Custom Domain con verifyCustomDomainResponse (hostname, service, zone_id, zone_name y enabled), y conservar el resultado saneado. No confundir el hostname copiado de la solicitud con uno confirmado por la respuesta. Una ruta tradicional requiere DNS preexistente; Custom Domain administra DNS autom?ticamente, pero su respuesta HTTP no acredita disponibilidad DNS desde el cliente.

ProductHarness espera DNS antes de cada primer acceso a un hostname, usando lookup del sistema como el transporte Node, con hasta 30 s totales, diez intentos y 3 s por intento; cach? de ?xito 30 s. La espera de un lookup colgado termina sin lanzar consultas paralelas ni afirmar que se cancel? la consulta del sistema. Fallo o agotamiento impide despachar HTTP. Los reintentos son ?nicamente de resoluci?n, nunca de escrituras.

Para que el diagn?stico sin credenciales tampoco omita la guarda, envolver su transporte con createDnsGatedTransport([hostnameA, hostnameB], record, diagnosticFetch) y pasar el mismo transporte a ProductHarness. Este envoltorio limita destinos HTTPS, comprueba DNS antes de fetch y no reintenta HTTP. DNS simulado debe inyectarse expl?citamente en pruebas locales. Las consultas futuras deben cargarse al presupuesto que corresponda antes de despacharse; esta correcci?n local no ejecut? DNS ni alter? los contadores hist?ricos.

La evidencia run3 solo demuestra ENOTFOUND desde aquel cliente, no la causa autoritativa/propagaci?n. No reutilizar ni ejecutar los scripts hist?ricos de evidencia para repetir una corrida.
