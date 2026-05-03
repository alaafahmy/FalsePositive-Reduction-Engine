package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : OS Command Injection (CWE-078) — NOT EXPLOITABLE
 * Why safe        : Uses the String-array form of Runtime.exec().  In this
 *                   form each element is a discrete argument passed directly
 *                   to execvp(); no shell is involved, so shell metacharacters
 *                   (;, &, |, $, `) have no special meaning.
 * CodeQL expected : SHOULD NOT DETECT
 */
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class CommandInjectionFP1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE — looks risky at first glance
        String host = req.getParameter("host");

        PrintWriter out = resp.getWriter();
        try {
            // SAFE — argument array bypasses shell interpretation entirely
            Process p = Runtime.getRuntime().exec(
                    new String[]{"ping", "-c", "1", host});
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
