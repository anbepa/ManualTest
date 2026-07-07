package co.com.bancolombia.certificacion.datahighway.stepdefinitions;

import io.cucumber.java.Scenario;
import net.serenitybdd.core.Serenity;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads the manual results produced by the web UI (Manual BDD Studio) and applies
 * them to the running Serenity/Cucumber scenario, EVIDENCE PER STEP: for the step
 * currently being executed it records its evidence image, logs the note and, if the
 * step was marked as failed, throws so Serenity reports that step as failed (and the
 * remaining steps as skipped).
 *
 * IMPORTANT: evidence is attached with the SERENITY API (not Cucumber's
 * scenario.attach, which Serenity does not render in its report). This mirrors the
 * exact chain used by the official manualtestSerenityBDD JAR:
 *
 *   Serenity.recordReportData().asEvidence().withTitle(name).downloadable().fromFile(path);
 *
 * and additionally, for images, Serenity.recordScreenshot(name, bytes) so the picture
 * is previewed inline under the step.
 *
 * Enabled only when the JVM is started with -Dmanual.headless=true (done by the web
 * runner). When that flag is absent, the original interactive desktop flow is kept.
 *
 * Zero external dependencies beyond the JDK + Serenity. The results file has one line
 * PER STEP, text fields Base64-encoded so any character travels safely:
 *   base64(scenario) \t stepIndex \t status \t base64(evidence) \t base64(notes)
 *
 * The evidence field may contain SEVERAL file names separated by ';' so a single
 * step can attach multiple evidences in the Serenity report.
 */
public final class ManualResults {

    public static final class StepResult {
        public String status = "passed";
        public String evidence = "";
        public String notes = "";
    }

    // scenarioName -> (stepIndex -> StepResult)
    private static Map<String, Map<Integer, StepResult>> cache;

    private ManualResults() {
    }

    public static boolean isHeadless() {
        return "true".equalsIgnoreCase(System.getProperty("manual.headless"));
    }

    private static synchronized Map<String, Map<Integer, StepResult>> load() {
        if (cache != null) {
            return cache;
        }
        cache = new HashMap<>();
        String path = System.getProperty("manual.results.file");
        if (path == null || path.isEmpty()) {
            return cache;
        }
        File file = new File(path);
        if (!file.exists()) {
            return cache;
        }
        Base64.Decoder dec = Base64.getDecoder();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.trim().isEmpty()) {
                    continue;
                }
                String[] p = line.split("\t", -1);
                if (p.length < 3) {
                    continue;
                }
                String scenarioName = new String(dec.decode(p[0]), StandardCharsets.UTF_8);
                int stepIndex;
                try {
                    stepIndex = Integer.parseInt(p[1].trim());
                } catch (NumberFormatException e) {
                    continue;
                }
                StepResult r = new StepResult();
                r.status = p[2];
                if (p.length > 3 && !p[3].isEmpty()) {
                    r.evidence = new String(dec.decode(p[3]), StandardCharsets.UTF_8);
                }
                if (p.length > 4 && !p[4].isEmpty()) {
                    r.notes = new String(dec.decode(p[4]), StandardCharsets.UTF_8);
                }
                cache.computeIfAbsent(scenarioName, k -> new HashMap<>()).put(stepIndex, r);
            }
        } catch (Exception e) {
            System.err.println("[ManualResults] Could not read results file: " + e.getMessage());
        }
        return cache;
    }

    private static File evidencesDir() {
        String dir = System.getProperty("manual.evidences.dir");
        if (dir != null && !dir.isEmpty()) {
            return new File(dir);
        }
        return new File(System.getProperty("user.dir"), "evidences");
    }

    private static String guessMime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    /**
     * Records the evidence file into the Serenity report for the CURRENT step, using
     * the same API the official manualtest JAR uses so it is actually rendered.
     */
    private static void recordEvidence(Scenario scenario, File file, String name) {
        String mime = guessMime(name);

        // 1) Downloadable evidence entry (proven API from the official JAR bytecode).
        try {
            Serenity.recordReportData()
                    .asEvidence()
                    .withTitle(name)
                    .downloadable()
                    .fromFile(file.toPath());
        } catch (Throwable t) {
            scenario.log("No se pudo adjuntar la evidencia '" + name + "': " + t.getMessage());
        }

        // 2) For images, also preview them inline under the step.
        if (mime.startsWith("image/")) {
            try {
                byte[] bytes = Files.readAllBytes(file.toPath());
                Serenity.recordScreenshot(name, bytes);
            } catch (Throwable t) {
                System.err.println("[ManualResults] recordScreenshot fallo para '" + name + "': " + t.getMessage());
            }
        }
    }

    /**
     * Applies the manual result for a SINGLE step of the scenario. The evidence is
     * recorded while this step is the active one, so Serenity associates it with the
     * step in the report. Throws AssertionError when the step was marked as failed.
     *
     * @param scenario  the running Cucumber scenario
     * @param stepIndex zero-based index of the step within the scenario
     * @param stepText  the step text (for logging)
     */
    public static void applyStep(Scenario scenario, int stepIndex, String stepText) {
        Map<Integer, StepResult> steps = load().get(scenario.getName());
        StepResult r = steps != null ? steps.get(stepIndex) : null;
        if (r == null) {
            // No manual data for this step -> treat as passed with no evidence.
            r = new StepResult();
        }

        if (r.evidence != null && !r.evidence.isEmpty()) {
            for (String evName : r.evidence.split(";")) {
                evName = evName.trim();
                if (evName.isEmpty()) {
                    continue;
                }
                File img = new File(evidencesDir(), evName);
                if (img.exists()) {
                    recordEvidence(scenario, img, evName);
                } else {
                    scenario.log("Evidencia no encontrada: " + img.getAbsolutePath());
                }
            }
        }

        if (r.notes != null && !r.notes.isEmpty()) {
            scenario.log("Nota: " + r.notes);
        }

        if ("failed".equalsIgnoreCase(r.status)) {
            throw new AssertionError("Paso marcado como FALLIDO desde Manual BDD Studio: \"" + stepText + "\"");
        }
        if ("pending".equalsIgnoreCase(r.status)) {
            scenario.log("PENDIENTE: el paso \"" + stepText + "\" aun no fue evaluado.");
        }
    }
}
