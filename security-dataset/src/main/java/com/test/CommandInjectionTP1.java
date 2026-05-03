package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : OS Command Injection (CWE-078)
 * Why vulnerable  : HTTP parameter "host" is concatenated directly into a
 *                   shell command string passed to Runtime.exec(String).
 *                   The single-string form invokes a shell, so metacharacters
 *                   like ; && | allow arbitrary command execution.
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

public class CommandInjectionTP1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String host = req.getParameter("host");

        PrintWriter out = resp.getWriter();
        try {
            // SINK — single-string exec, user input injected into shell command
            Process p = Runtime.getRuntime().exec("ping -c 1 " + host);
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
