package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : OS Command Injection — multi-step flow (CWE-078)
 * Why vulnerable  : User input flows through a helper method buildCommand()
 *                   that constructs the shell string.  The indirection may
 *                   obscure the taint path, but no sanitisation occurs.
 * CodeQL expected : SHOULD DETECT  (java/command-line-injection)
 */
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class CommandInjectionTP2 extends HttpServlet {

    // Helper that builds the shell command — taint is NOT cleared here
    private static String buildCommand(String target, String options) {
        return "nslookup " + options + " " + target;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String target  = req.getParameter("target");
        String options = req.getParameter("options");   // second tainted param

        // Taint flows into helper — result is still dangerous
        String command = buildCommand(target, options);

        PrintWriter out = resp.getWriter();
        try {
            // SINK
            Process p = Runtime.getRuntime().exec(command);
            BufferedReader br = new BufferedReader(
                    new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = br.readLine()) != null) {
                out.println(line);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
