package com.test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;

/**
 * TRUE POSITIVE: OS Command Injection via HttpServletRequest.getParameter()
 * User input flows directly into Runtime.exec() without sanitization.
 * Expected: CodeQL should flag java/command-line-injection
 */
public class CommandInjectionTP extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        // SOURCE: user-controlled input from HTTP request
        String host = request.getParameter("host");

        PrintWriter out = response.getWriter();
        try {
            // SINK: user input passed directly to OS command (Command Injection)
            Process process = Runtime.getRuntime().exec("ping -c 1 " + host);
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
