package com.test;

/**
 * Classification  : TRICKY — TRUE POSITIVE (regex sanitiser with bypass)
 * Vulnerability   : SQL Injection (CWE-089)
 * Why ambiguous   : The code uses replaceAll() to strip single quotes,
 *                   appearing to prevent string-based SQL injection.
 *                   However, the query uses a numeric column (age) with no
 *                   quotes around the value, so the injected payload
 *                   does not require quotes:  ?age=0 OR 1=1--
 *                   Additionally, replaceAll only removes ', not --, OR, =.
 * CodeQL expected : SHOULD DETECT (taint still reaches SQL sink)
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

public class TrickyCase3 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String age = req.getParameter("age");

        // Partial mitigation — only strips single quotes; injections without
        // quotes (numeric context) still work: "0 OR 1=1--"
        String sanitised = (age != null) ? age.replaceAll("'", "") : "0";

        PrintWriter out = resp.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");
            Statement stmt = conn.createStatement();

            // SINK — numeric context, no surrounding quotes — still injectable
            String sql = "SELECT username FROM users WHERE age > " + sanitised;
            ResultSet rs = stmt.executeQuery(sql);

            while (rs.next()) {
                out.println(rs.getString("username"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
