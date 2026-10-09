# 8. Git, ramas, pull requests y OpenSpec

## 8.1 Política de ramas

- `main`: rama estable y desplegable; protegida.
- `feature/epic-001-bootstrap` (ejemplo): una rama principal por EPIC.
- `fix/<tema>`: correcciones independientes que no justifican una rama EPIC.
- `docs/<tema>`: documentación independiente si no pertenece a una rama EPIC activa.

No crear una rama por cada microtarea si forma parte del mismo EPIC. Las tareas del EPIC se registran en `tasks.md`; commits pequeños permiten demostrar la evolución. Cada EPIC se integra mediante PR y revisión.

## 8.2 Convención de commits

Usar Conventional Commits:

- `feat(auth): add institutional Google login`
- `feat(board): support configurable columns`
- `test(tasks): cover unauthorized task movement`
- `docs(architecture): record worker deployment decision`
- `fix(ai): enforce per-user usage limits`
- `chore(ci): add pull request checks`

Cada commit debe tener propósito claro; no mezclar grandes cambios de UI, dominio y despliegue en un único commit.

## 8.3 PR checklist

- [ ] El cambio está descrito en OpenSpec.
- [ ] Los requisitos y escenarios son verificables.
- [ ] Se implementaron pruebas unitarias y de integración apropiadas.
- [ ] Las pruebas de permisos cubren el recurso afectado.
- [ ] Se actualizaron API docs, diagramas o ADR cuando corresponde.
- [ ] No se incluyen secretos, datos reales sensibles ni artefactos generados innecesarios.
- [ ] CI está verde.
- [ ] Se explica cómo probar y cómo revertir.
- [ ] El cambio está dentro del alcance del EPIC.

## 8.4 Flujo OpenSpec recomendado

1. **Explore:** investigar el problema y alternativas sin editar código.
2. **Propose:** crear `proposal.md`, delta specs, `design.md` y `tasks.md`.
3. **Review:** el propietario revisa alcance, requisitos, seguridad, costo y tareas.
4. **Apply:** el agente implementa tareas marcándolas al completarlas.
5. **Verify:** contrastar código y pruebas contra cada escenario de aceptación.
6. **Archive:** integrar los delta specs en las specs canónicas y archivar el cambio.

Comandos generales documentados por OpenSpec incluyen `openspec list`, `openspec show`, `openspec validate`, `openspec status` y `openspec archive`. Verificar los comandos exactos de la versión instalada con `openspec --help`.

## 8.5 Instalación y Antigravity

- Requisito documentado por OpenSpec: Node.js 20.19.0 o superior.
- Instalar CLI: `npm install -g @fission-ai/openspec@latest`.
- En la raíz del repositorio: `openspec init --tools antigravity` (si la versión instalada acepta ese identificador; Antigravity aparece en la lista oficial de compatibilidad de OpenSpec).
- Revisar los archivos que `init` genere y mantenerlos en Git.
- Ejecutar `openspec validate` sobre los cambios y specs pertinentes antes de aplicar/archivar.
- Para cada cambio, iniciar el flujo OpenSpec en Antigravity y pedir al agente que lea las instrucciones generadas y las especificaciones actuales.

## 8.6 Reglas para agentes

- No modificar `main` directamente.
- No cambiar arquitectura o dependencias sin propuesta y justificación.
- No inventar comandos de CLI ni asumir que un test pasó; ejecutar y reportar salida real.
- No desactivar tests para hacer verde el pipeline sin explicar y aprobar el motivo.
- No exponer secretos ni usar credenciales productivas en pruebas.
- No modificar tareas ya marcadas como completas sin explicar el cambio.
- Antes de implementar, leer `README.md`, el contexto OpenSpec, las specs del módulo y ADR aplicables.
- Mantener una tarea por unidad de trabajo razonable y commits pequeños.

## 8.7 GitHub Actions y secretos

Secrets típicos (solo cuando se configure el pipeline): Cloudflare API token, account ID si se requiere, credenciales de despliegue, secretos OAuth y variables de acceso a base de datos. Usar permisos mínimos para el token de Cloudflare. No almacenar secretos en `.env.example`; usar valores de ejemplo sin validez.
