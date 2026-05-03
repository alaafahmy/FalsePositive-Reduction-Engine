package com.test;

/**
 * Classification  : TRICKY — TRUE POSITIVE (multi-method taint flow)
 * Vulnerability   : XSS (CWE-079)
 * Why ambiguous   : User input travels through two helper methods before
 *                   reaching the sink.  formatGreeting() and toHtmlRow()
 *                   do not encode HTML; they only perform string formatting.
 *                   The multi-hop path may defeat scanners with shallow depth.
 * CodeQL expected : SHOULD DETECT (taint tracked across method boundaries)
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class TrickyCase4 extends HttpServlet {

    // Hop 1 — cosmetic transformation, taint preserved
    private static String formatGreeting(String name) {
        return "Hello, " + name + "!";
    }

    // Hop 2 — wraps in HTML table row, taint still preserved
    private static String toHtmlRow(String content) {
        return "<tr><td>" + content + "</td></tr>";
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("text/html;charset=UTF-8");

        // SOURCE
        String name = req.getParameter("name");

        // Multi-step — taint flows through both helpers without sanitisation
        String greeting = formatGreeting(name);
        String row      = toHtmlRow(greeting);

        PrintWriter out = resp.getWriter();
        // SINK — tainted HTML written to response
        out.println("<html><body><table>" + row + "</table></body></html>");
    }
}
