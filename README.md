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

---

## Configuración desde test-plan-app

Desde el panel **Configuración → Integración Serenity** en test-plan-app
cada usuario registra sus propios datos de GitHub. El token **nunca** se
expone en el frontend; se guarda cifrado en Supabase Vault y el backend lo
lee en tiempo de ejecución.

### Campos del formulario y valores esperados

| Campo | Descripción | Ejemplo |
|---|---|---|
| **GitHub Username** | Tu nombre de usuario en GitHub (quien posee el token) | `anbepa` |
| **Repository Owner** | Dueño del repositorio que contiene este workflow (puede ser tu usuario u organización) | `anbepa` |
| **Repository Name** | Nombre exacto de este repositorio en GitHub | `ManualTest` |
| **Workflow File Name** | Nombre del archivo `.yml` del workflow (no la ruta completa) | `serenity-report.yml` |
| **Branch** | Rama del repositorio desde la que se disparará el workflow | `main` |
| **Nombre del Workflow Serenity** | Nombre visible del workflow (campo `name:` en el YML) | `Serenity Report` |
| **URL del repositorio** | URL pública del repositorio (opcional; se autogenera si está vacío) | `https://github.com/anbepa/ManualTest` |
| **GitHub Personal Access Token** | Token con los scopes `repo` y `workflow` — se guarda cifrado, no se muestra después | `ghp_xxxxxxxxxxxxxxxxxxxx` |

### Scopes requeridos en el Personal Access Token

El token debe tener habilitados los siguientes permisos:

- `repo` — para leer y disparar workflows en el repositorio
- `workflow` — para disparar `workflow_dispatch`
- `gist` — para crear y eliminar Gists (usado como almacenamiento temporal del bundle)

Puedes crearlo en: **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**.

### Verificar la configuración

Una vez guardado, el botón **Guardar configuración Serenity** valida
automáticamente el acceso al repositorio y al workflow. Si el token o el
repositorio son incorrectos verás el error específico.

---

## Ejecutar el workflow

### Opcion A — Manual (para probar)
1. Sube este repo a GitHub.
2. Actions → **Serenity Report** → **Run workflow**.
3. Sin URL usa `ci/bundle.json` (ejemplo incluido). Al terminar, descarga el
   artifact **target** (se baja como `target.zip`).

### Opcion B — Automatico desde test-plan-app
El botón **Serenity** en la pantalla de ejecución manual:
1. Construye el bundle de la ejecución.
2. Crea un Gist privado temporal con el bundle.
3. Dispara el workflow via `workflow_dispatch` con el `bundle_url`.
4. Hace polling del estado hasta que el artifact esté listo.
5. Descarga automáticamente el `.zip` con el reporte.

### Opcion C — Programatico via curl

```bash
# workflow_dispatch (recomendado)
curl -X POST \
  -H "Authorization: Bearer <GH_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/ManualTest/actions/workflows/serenity-report.yml/dispatches \
  -d '{"ref":"main","inputs":{"job_id":"mi-job","bundle_url":"https://..."}}'  

# repository_dispatch (alternativo)
curl -X POST \
  -H "Authorization: Bearer <GH_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/ManualTest/dispatches \
  -d '{"event_type":"serenity-report","client_payload":{"job_id":"mi-job","bundle_url":"https://..."}}'
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
