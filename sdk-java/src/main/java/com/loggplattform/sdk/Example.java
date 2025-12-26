package com.loggplattform.sdk;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public class Example {
    public static void main(String[] args) {
        // Create SDK instance
        LoggplattformSDK logger = new LoggplattformSDK.Builder()
            .apiUrl(System.getenv().getOrDefault("LOGGPLATTFORM_API_URL", "http://localhost:3000"))
            .apiKey(System.getenv().getOrDefault("LOGGPLATTFORM_API_KEY", "test-api-key-123"))
            .service("test-service")
            .environment("test")
            .build();

        System.out.println("Testing Loggplattform Java SDK...\n");

        // Set correlation ID
        String correlationId = UUID.randomUUID().toString();
        logger.setCorrelationId(correlationId);
        System.out.println("Correlation ID: " + correlationId + "\n");

        // Send different log levels
        logger.info("Test info message");
        System.out.println("✓ Sent info log");

        Map<String, Object> context = new HashMap<>();
        context.put("test", true);
        context.put("step", 2);
        logger.warn("Test warning message", context);
        System.out.println("✓ Sent warn log");

        Map<String, Object> errorContext = new HashMap<>();
        errorContext.put("test", true);
        errorContext.put("step", 3);
        errorContext.put("errorCode", "TEST_ERROR");
        logger.error("Test error message", errorContext);
        System.out.println("✓ Sent error log");

        Map<String, Object> debugContext = new HashMap<>();
        debugContext.put("test", true);
        debugContext.put("step", 4);
        debugContext.put("details", "Debug information");
        logger.debug("Test debug message", debugContext);
        System.out.println("✓ Sent debug log");

        // Wait a bit for async sending
        try {
            Thread.sleep(2000);
            System.out.println("\n✅ All logs sent! Check the web UI at http://localhost:8080");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        logger.shutdown();
    }
}
