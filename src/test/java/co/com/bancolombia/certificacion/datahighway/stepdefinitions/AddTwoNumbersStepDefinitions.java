package co.com.bancolombia.certificacion.datahighway.stepdefinitions;


import io.cucumber.java.Before;
import io.cucumber.java.Scenario;
import io.cucumber.java.en.Given;

import java.io.IOException;


/**
 * Generic manual step definitions.
 *
 * A SINGLE catch-all definition (@Given("^(.*)$")) matches EVERY step. In Cucumber-JVM
 * the Given/When/Then/And/But annotations are interchangeable, so this one method
 * handles all steps of every scenario, in any wording or language. That is why new
 * features created from Manual BDD Studio run out of the box WITHOUT creating new
 * runner or step-definition files.
 *
 * Web / CI mode (-Dmanual.headless=true): verdict and evidence for each step come
 * from the UI results file and are applied by ManualResults (pure Serenity + JDK,
 * NO internal dependency).
 *
 * Desktop mode: the original interactive dialog from the internal
 * manualtestSerenityBDD JAR is invoked via REFLECTION, so the project compiles on
 * CI (Maven Central) WITHOUT that JAR. To use desktop mode locally, build with
 * -PuseArtifactory so the JAR is on the classpath.
 */
public class AddTwoNumbersStepDefinitions {

    private Scenario scenario;
    private int stepIndex;

    @Before
    public void getScenario(Scenario scenario) {
        this.scenario = scenario;
        this.stepIndex = 0;
    }

    @Given("^(.*)$")
    public void handleAnyStep(String step) throws IOException {
        if (ManualResults.isHeadless()) {
            // Web-driven: evidence + verdict per step from Manual BDD Studio.
            ManualResults.applyStep(scenario, stepIndex, step);
        } else {
            // Original interactive flow (desktop only), invoked once on the first step.
            if (stepIndex == 0) {
                invokeDesktopValidate(step, scenario.getName());
            }
        }
        stepIndex++;
    }

    /**
     * Invokes co.com.bancolombia.certification.manualtestlib.ManualTest.validate(step, scenario)
     * from the internal JAR via reflection. Kept out of the compile-time classpath so
     * the project builds on CI using only Maven Central. In CI we always run headless,
     * so this method is never reached.
     */
    private void invokeDesktopValidate(String step, String scenarioName) {
        try {
            Class<?> clazz = Class.forName("co.com.bancolombia.certification.manualtestlib.ManualTest");
            clazz.getMethod("validate", String.class, String.class).invoke(null, step, scenarioName);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException(
                    "Modo escritorio requiere el JAR interno 'manualtestSerenityBDD'. " +
                    "Compila con -PuseArtifactory, o ejecuta en modo headless con -Dmanual.headless=true.", e);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException("No se pudo invocar ManualTest.validate: " + e.getMessage(), e);
        }
    }
}
