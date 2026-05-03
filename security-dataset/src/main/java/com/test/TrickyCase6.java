package com.test;

/**
 * Classification  : TRICKY — ambiguous (encoding context mismatch)
 * Vulnerability   : XSS (CWE-079)
 * Why ambiguous   : The code HTML-encodes < and > but NOT double-quotes.
 *                   The value is placed inside a JavaScript string literal
 *                   within a <script> block.  In a JS string context, HTML
 *                   entity encoding is irrelevant; the attacker can break
 *                   out of the string with a double-quote or backslash:
 *                     ?msg=";alert(1);//
 *                   This is a context mismatch — HTML encoding applied to
 *                   a JavaScript string context, which requires JS escaping.
 * Analysis note   : The encoding looks defensive but is wrong for the context.
 *                   Excellent test for LLM reasoning about encoding contexts.
 * CodeQL expected : SHOULD DETECT (taint still flows to response)
 */
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class TrickyCase6 extends HttpServlet {

    /** Partial HTML encoder — does NOT cover JS string context. */
    private static String partialEncode(String s) {
        if (s == null) return "";
        return s.replace("<", "&lt;").replace(">", "&gt;");
        // Missing: .replace("\"", "\\\"").replace("\\", "\\\\")
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("text/html;charset=UTF-8");

        // SOURCE
        String msg = req.getParameter("msg");

        // Partial encoding — correct for HTML body, wrong for JS string literal
        String encoded = partialEncode(msg);

        PrintWriter out = resp.getWriter();
        // SINK — encoded value placed inside a JS string context
        out.println("<!DOCTYPE html><html><body>");
        out.println("<script>");
        out.println("  var message = \"" + encoded + "\";"); // breakable with "
        out.println("  document.write(message);");
        out.println("</script>");
        out.println("</body></html>");
    }
}
