package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : Reflected XSS (CWE-079)
 * Why vulnerable  : The "name" parameter is reflected directly into the HTML
 *                   response without any HTML encoding.  An attacker can
 *                   inject <script> tags or event handlers.
 * CodeQL expected : SHOULD DETECT  (java/xss)
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class XSSTP1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("text/html;charset=UTF-8");

        // SOURCE
        String name = req.getParameter("name");

        PrintWriter out = resp.getWriter();
        // SINK — raw user input written into HTML context
        out.println("<!DOCTYPE html><html><body>");
        out.println("<h2>Hello, " + name + "!</h2>");
        out.println("</body></html>");
    }
}
