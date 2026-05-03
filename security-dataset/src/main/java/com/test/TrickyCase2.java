package com.test;

/**
 * Classification  : TRICKY — TRUE POSITIVE (incomplete sanitisation)
 * Vulnerability   : OS Command Injection (CWE-078)
 * Why ambiguous   : A sanitize() method strips several shell metacharacters,
 *                   giving the appearance of protection.  However, the filter
 *                   misses backticks (`cmd`), newlines (\n), redirection
 *                   operators (>, <), and tilde (~).  An attacker can use
 *                   these bypasses to execute arbitrary commands.
 * CodeQL expected : SHOULD DETECT (taint path remains; custom method is not
 *                   a recognised sanitiser, so taint is not cleared)
 */
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class TrickyCase2 extends HttpServlet {

    /**
     * Incomplete sanitiser — strips only the most obvious metacharacters.
     * Bypasses: backtick, newline, carriage-return, >, <, ~
     */
    private static String sanitize(String input) {
        if (input == null) return "";
        return input.replaceAll("[;&|$\\s'\"\\\\]", "");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String host = req.getParameter("host");

        String cleaned = sanitize(host);   // incomplete — taint not cleared

        PrintWriter out = resp.getWriter();
        try {
            // SINK — still injectable via backtick or newline-based payloads
            Process p = Runtime.getRuntime().exec("ping -c 1 " + cleaned);
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
