package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : XSS (CWE-079) — NOT EXPLOITABLE
 * Why safe        : The response Content-Type is set to "application/json".
 *                   Browsers refuse to execute scripts in JSON responses;
 *                   they will never parse the body as HTML.  Additionally,
 *                   the value is JSON-string-escaped, preventing JSON-breaking
 *                   injections.  No HTML rendering context exists.
 * CodeQL expected : MIGHT DETECT (taint still flows into response body, but
 *                   JSON context makes XSS exploitation impossible)
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class XSSFP2 extends HttpServlet {

    /** Minimal JSON string escaper. */
    private static String jsonEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SAFE — JSON content type: browsers won't render this as HTML
        resp.setContentType("application/json;charset=UTF-8");

        // SOURCE
        String query = req.getParameter("q");

        PrintWriter out = resp.getWriter();
        // JSON-escaped value in a JSON response — no HTML execution context
        out.println("{\"echo\":\"" + jsonEscape(query) + "\"}");
    }
}
