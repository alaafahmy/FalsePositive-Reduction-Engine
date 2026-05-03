package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : XSS (CWE-079) — NOT EXPLOITABLE
 * Why safe        : All HTML special characters in the user value are replaced
 *                   with their named HTML entities before being written into
 *                   the response.  This neutralises < > " ' & so that no
 *                   browser-executable markup can be injected.
 * CodeQL expected : SHOULD NOT DETECT
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class XSSFP1 extends HttpServlet {

    /** Minimal but correct HTML-entity encoder for untrusted content. */
    private static String htmlEncode(String raw) {
        if (raw == null) return "";
        return raw.replace("&",  "&amp;")
                  .replace("<",  "&lt;")
                  .replace(">",  "&gt;")
                  .replace("\"", "&quot;")
                  .replace("'",  "&#x27;");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("text/html;charset=UTF-8");

        // SOURCE
        String name = req.getParameter("name");

        PrintWriter out = resp.getWriter();
        // SAFE — encoded before insertion into HTML
        out.println("<!DOCTYPE html><html><body>");
        out.println("<h2>Hello, " + htmlEncode(name) + "!</h2>");
        out.println("</body></html>");
    }
}
