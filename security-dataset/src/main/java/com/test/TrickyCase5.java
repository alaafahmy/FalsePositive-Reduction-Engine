package com.test;

/**
 * Classification  : TRICKY — ambiguous (custom validator, possibly bypassable)
 * Vulnerability   : SQL Injection (CWE-089)
 * Why ambiguous   : A custom isValidEmail() method checks that the input
 *                   matches a regex before use.  The regex enforces basic email
 *                   structure, but the check does not prevent SQL injection
 *                   payloads that conform to email syntax, e.g.:
 *                     a@b.com' OR '1'='1
 *                   The trailing OR clause still contains a valid @ symbol so
 *                   the regex matches.  The validator is insufficient.
 * Analysis note   : A human reviewer might trust the regex; a LLM should
 *                   reason that the regex does not exclude SQL metacharacters.
 * CodeQL expected : SHOULD DETECT (custom validator not recognised as sanitiser)
 */
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class TrickyCase5 extends HttpServlet {

    /** Looks protective but regex allows SQL metacharacters after valid prefix. */
    private static boolean isValidEmail(String email) {
        return email != null && email.matches("[^@]+@[^@]+\\.[^@]+");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String email = req.getParameter("email");

        PrintWriter out = resp.getWriter();

        if (!isValidEmail(email)) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid email");
            return;
        }

        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");
            Statement stmt = conn.createStatement();

            // SINK — validator does not strip SQL metacharacters
            String sql = "SELECT id FROM users WHERE email = '" + email + "'";
            ResultSet rs = stmt.executeQuery(sql);

            while (rs.next()) {
                out.println("Found: " + rs.getInt("id"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
