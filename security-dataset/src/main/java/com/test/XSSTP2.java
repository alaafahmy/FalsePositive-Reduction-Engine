package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : Attribute-based Reflected XSS (CWE-079)
 * Why vulnerable  : User input is placed inside an HTML attribute value with
 *                   only double-quote wrapping.  An attacker can close the
 *                   attribute and inject an event handler, e.g.:
 *                   ?color=" onmouseover="alert(1)
 * CodeQL expected : SHOULD DETECT  (java/xss)
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class XSSTP2 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("text/html;charset=UTF-8");

        // SOURCE
        String color = req.getParameter("color");

        PrintWriter out = resp.getWriter();
        // SINK — user input injected into an HTML attribute — attribute injection
        out.println("<!DOCTYPE html><html><body>");
        out.println("<div style=\"color:" + color + "\">Welcome!</div>");
        out.println("</body></html>");
    }
}
