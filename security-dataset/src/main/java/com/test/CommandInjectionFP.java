package com.test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.util.Arrays;
import java.util.List;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;

/**
 * FALSE POSITIVE: Whitelist validation prevents Command Injection.
 * User input is validated against an allowed list before execution.
 * Expected: CodeQL MIGHT still flag this — good LLM FP reduction test case.
 */
public class CommandInjectionFP extends HttpServlet {

    private static final List<String> ALLOWED_HOSTS = Arrays.asList(
            "google.com", "github.com", "stackoverflow.com");

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        // SOURCE: user-controlled input from HTTP request
        String host = request.getParameter("host");

        PrintWriter out = response.getWriter();

        // VALIDATION: strict whitelist check before execution
        if (host == null || !ALLOWED_HOSTS.contains(host)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid host");
            return;
        }

        try {
            // After whitelist validation, only known-safe values reach exec()
            Process process = Runtime.getRuntime().exec(
                    new String[]{"ping", "-c", "1", host});
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                out.println(line);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
