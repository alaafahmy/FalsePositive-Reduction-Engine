package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : OS Command Injection (CWE-078) — NOT EXPLOITABLE
 * Why safe        : The "tool" parameter is validated against a strict
 *                   enum-style whitelist.  Only the exact string "nmap" or
 *                   "curl" can reach exec(); any other value causes a 400.
 *                   Additionally, the argument array form is used, removing
 *                   shell interpretation as a second layer of defence.
 * CodeQL expected : MIGHT DETECT (taint flow exists; whitelist may not be
 *                   fully modelled as a sanitiser)
 */
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class CommandInjectionFP2 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String tool   = req.getParameter("tool");
        String target = req.getParameter("target");

        PrintWriter out = resp.getWriter();

        // SAFE — strict whitelist: only two exact values allowed
        if (!"nmap".equals(tool) && !"curl".equals(tool)) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Unknown tool");
            return;
        }

        try {
            // SAFE — argument array (no shell); tool is whitelist-verified
            Process p = Runtime.getRuntime().exec(
                    new String[]{tool, target});
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
