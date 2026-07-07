# ManualTest — Serenity Report (CI)

Proyecto Gradle/Serenity BDD que genera el reporte Serenity a partir de un
**bundle JSON** exportado desde `manual-execution` (test-plan-app), usando
**GitHub Actions** y **Maven Central** (sin Artifactory Bancolombia).

## Como funciona

```
manual-execution  ──(bundle.json)──▶  GitHub Actions
                                        │  node ci/materialize.js bundle.json
                                        │    -> src/test/resources/features/*.feature
                                        │    -> evidences/*.png
                                        │    -> webapp/data/manual-results.tsv
                                        │  ./gradlew clean test aggregate (headless)
                                        │    -> target/site/serenity/ (reporte)
                                        └─▶  artifact "target" (ZIP descargable)
```

El bundle es autocontenido: escenarios ya convertidos a Gherkin y evidencias en
base64. La conversion reutiliza la MISMA logica del Manual BDD Studio local
(`webapp/lib/importer.js`), por lo que el formato es identico.

## Ejecutar el workflow

### Opcion A — Manual (para probar)
1. Sube este repo a GitHub.
2. Actions → **Serenity Report** → **Run workflow**.
3. Sin URL usa `ci/bundle.json` (ejemplo incluido). Al terminar, descarga el
   artifact **target** (se baja como `target.zip`).

### Opcion B — Programatico (integracion)
Dispara `repository_dispatch` con `event_type: serenity-report` y
`client_payload.bundle_url` apuntando al JSON (p.ej. una signed URL de Supabase):

```bash
curl -X POST \
  -H "Authorization: token <GH_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/dispatches \
  -d '{"event_type":"serenity-report","client_payload":{"bundle_url":"https://..."}}'
```

## Maven Central vs Artifactory

- **CI (por defecto):** solo Maven Central. `ManualResults` usa API pura de
  Serenity + JDK; el JAR interno se invoca por reflexion y NO es necesario.
- **Escritorio local (opcional):** `./gradlew -PuseArtifactory clean test aggregate`
  agrega el repo de Artifactory e incluye el JAR interno.

## Estructura

- `build.gradle` — Maven Central + Artifactory condicional.
- `ci/materialize.js` — bundle JSON → feature + evidencias + TSV.
- `ci/bundle.json` — bundle de ejemplo (reemplazable).
- `webapp/lib/` — logica de conversion reutilizada (importer, gherkin, store, runner).
- `.github/workflows/serenity-report.yml` — pipeline CI.
