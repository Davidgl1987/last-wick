## Modelo y delegación (ahorro de tokens)

Por defecto en este proyecto: **un modelo superior (Opus) orquesta y modelos más baratos (Sonnet) implementan**.

- La sesión principal (orquestador) planifica, revisa y verifica con un modelo superior.
- Cada tarea concreta de implementación se delega a un **sub-agente con `model: "sonnet"`** (vía la herramienta Agent). Para tareas muy mecánicas vale `haiku`.
- **`opus` en sub-agente: permitido pero excepcional** (actualizado 2026-07-05 por David; antes estaba prohibido): solo cuando aporte de verdad — algoritmos delicados con garantías que probar (p. ej. generadores de patrones con propiedades formales) o diagnóstico de un bug enrevesado que un sonnet no haya cerrado en un intento. La mayor parte sigue siendo sonnet; justifica cada uso de opus en una línea. Sigue evitando `subagent_type: fork` (heredaría el modelo del orquestador, superior a opus).
- El orquestador solo implementa directamente cambios triviales (1-2 líneas, edición de docs); lo demás se delega.
- Todo prompt de sub-agente que vaya a tocar `src/` debe decirle que lea `AGENTS.md` primero y lo cumpla (protocolo de proceso + trampas conocidas del código) — este fichero (`.claude/CLAUDE.md`) se carga solo, `AGENTS.md` no.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
