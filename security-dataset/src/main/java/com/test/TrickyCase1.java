package com.test;

/**
 * Classification  : TRICKY — likely FALSE POSITIVE (numeric type constraint)
 * Vulnerability   : SQL Injection (CWE-089)
 * Why ambiguous   : Integer.parseInt() is called on the user input before it
 *                   is concatenated into SQL.  If parseInt() succeeds, only a
 *                   valid Java int (no SQL metacharacters) can reach the query.
 *                   However, an int is still concatenated as a string into SQL,
 *                   so the pattern looks syntactically identical to injection.
 * Analysis note   : CodeQL models parseInt as a taint sanitiser for SQL sinks,
 *                   so it likely will NOT flag this.  The LLM should reason that
 *                   integer-only injection is not feasible → FP.
 * CodeQL expected : MIGHT NOT DETECT (parseInt treated as sanitiser)
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

public class TrickyCase1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String raw = req.getParameter("id");

        PrintWriter out = resp.getWriter();
        try {
            // Type constraint — throws NumberFormatException for non-integers
            int userId = Integer.parseInt(raw);

            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");
            Statement stmt = conn.createStatement();

            // Concatenation is safe IF parseInt succeeded (only digits reach here)
            String sql = "SELECT * FROM users WHERE id = " + userId;
            ResultSet rs = stmt.executeQuery(sql);

            while (rs.next()) {
                out.println(rs.getString("username"));
            }
        } catch (NumberFormatException e) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "id must be numeric");
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
